package handlers

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"github.com/HassanA01/Hilal/backend/internal/game"
	"github.com/HassanA01/Hilal/backend/internal/hub"
	"github.com/HassanA01/Hilal/backend/internal/metrics"
	"github.com/HassanA01/Hilal/backend/internal/models"
)

func newUpgrader(allowedOrigins []string) *websocket.Upgrader {
	return &websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			for _, o := range allowedOrigins {
				if origin == o {
					return true
				}
			}
			return false
		},
	}
}

const (
	writeWait      = 10 * time.Second
	pongWait       = 5 * time.Second // fast disconnect detection; frontend sends close on pagehide
	pingPeriod     = 3 * time.Second // must be < pongWait
	maxMessageSize = 512
)

func (h *Handler) HostWebSocket(w http.ResponseWriter, r *http.Request) {
	sessionCode := chi.URLParam(r, "sessionCode")

	conn, err := newUpgrader(h.config.AllowedOrigins).Upgrade(w, r, nil)
	if err != nil {
		slog.Error("ws upgrade error", "error", err)
		return
	}

	client := &hub.Client{
		ID:        uuid.New().String(),
		SessionID: sessionCode,
		IsHost:    true,
		Send:      make(chan []byte, 256),
	}
	h.hub.JoinRoom(sessionCode, client)
	metrics.ActiveWSConnections.Add(1)
	defer func() {
		h.hub.LeaveRoom(sessionCode, client)
		metrics.ActiveWSConnections.Add(-1)
		conn.Close()
	}()

	// Send current game state if a game is already in progress.
	go h.sendInitialState(r.Context(), sessionCode, client, true)

	go writePump(conn, client)
	readPump(conn, client, h, sessionCode, true)
}

func (h *Handler) PlayerWebSocket(w http.ResponseWriter, r *http.Request) {
	sessionCode := chi.URLParam(r, "sessionCode")
	playerID := r.URL.Query().Get("player_id")
	playerName := r.URL.Query().Get("name")

	conn, err := newUpgrader(h.config.AllowedOrigins).Upgrade(w, r, nil)
	if err != nil {
		slog.Error("ws upgrade error", "error", err)
		return
	}

	client := &hub.Client{
		ID:        playerID,
		SessionID: sessionCode,
		IsHost:    false,
		Send:      make(chan []byte, 256),
	}
	h.hub.JoinRoom(sessionCode, client)
	metrics.ActiveWSConnections.Add(1)
	defer func() {
		h.hub.LeaveRoom(sessionCode, client)
		metrics.ActiveWSConnections.Add(-1)
		conn.Close()
		// Notify host that player left
		h.hub.Broadcast(sessionCode, hub.Message{
			Type: hub.MsgPlayerLeft,
			Payload: map[string]string{
				"player_id": playerID,
				"name":      playerName,
			},
		})
		// If the session is still waiting, remove the player row so a
		// rejoin doesn't create a duplicate entry in the DB.
		var status string
		if err := h.db.QueryRow(context.Background(),
			`SELECT status FROM game_sessions WHERE code = $1`, sessionCode,
		).Scan(&status); err == nil && status == string(models.GameStatusWaiting) {
			_, _ = h.db.Exec(context.Background(),
				`DELETE FROM game_players WHERE id = $1`, playerID)
		}
	}()

	// Notify room of new player
	h.hub.Broadcast(sessionCode, hub.Message{
		Type: hub.MsgPlayerJoined,
		Payload: map[string]string{
			"player_id": playerID,
			"name":      playerName,
		},
	})

	go h.sendInitialState(r.Context(), sessionCode, client, false)

	go writePump(conn, client)
	readPump(conn, client, h, sessionCode, false)
}

func readPump(conn *websocket.Conn, client *hub.Client, h *Handler, sessionCode string, isHost bool) {
	defer conn.Close()
	conn.SetReadLimit(maxMessageSize)
	_ = conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				slog.Error("ws read error", "error", err, "session", sessionCode)
			}
			break
		}

		var msg hub.Message
		if err := json.Unmarshal(message, &msg); err != nil {
			slog.Error("ws unmarshal error", "error", err, "session", sessionCode)
			continue
		}

		handleMessage(h, client, sessionCode, isHost, msg)
	}
}

func writePump(conn *websocket.Conn, client *hub.Client) {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		conn.Close()
	}()
	for {
		select {
		case message, ok := <-client.Send:
			_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			w, err := conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			_, _ = w.Write(message)
			// Flush queued messages
			n := len(client.Send)
			for i := 0; i < n; i++ {
				_, _ = w.Write([]byte("\n"))
				_, _ = w.Write(<-client.Send)
			}
			if err := w.Close(); err != nil {
				return
			}
		case <-ticker.C:
			_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func handleMessage(h *Handler, client *hub.Client, sessionCode string, isHost bool, msg hub.Message) {
	ctx := context.Background()
	switch msg.Type {
	case hub.MsgPing:
		data, _ := json.Marshal(hub.Message{Type: hub.MsgPing, Payload: "pong"})
		select {
		case client.Send <- data:
		default:
		}

	case hub.MsgAnswerSubmitted:
		if isHost {
			return
		}
		payload, ok := msg.Payload.(map[string]any)
		if !ok {
			return
		}
		questionID, _ := payload["question_id"].(string)
		if questionID == "" {
			return
		}

		// Check for multi-option answer (option_ids array) vs single answer (option_id string).
		if rawIDs, ok := payload["option_ids"]; ok {
			// Multi-option answer (ordering or multi-select MC)
			idSlice, ok := rawIDs.([]any)
			if !ok || len(idSlice) == 0 {
				return
			}
			optionIDs := make([]string, 0, len(idSlice))
			for _, id := range idSlice {
				s, ok := id.(string)
				if !ok || s == "" {
					return
				}
				optionIDs = append(optionIDs, s)
			}
			// SubmitOrderingAnswer stores OptionIDs — works for both ordering and multi-select MC.
			// The evaluation logic in triggerReveal distinguishes by question type.
			if err := h.engine.SubmitOrderingAnswer(ctx, sessionCode, client.ID, questionID, optionIDs); err != nil {
				slog.Error("engine.SubmitOrderingAnswer failed", "error", err, "session", sessionCode, "player", client.ID)
			}
		} else {
			// Single-option answer (MC, TF, Image)
			optionID, _ := payload["option_id"].(string)
			if optionID == "" {
				return
			}
			if err := h.engine.SubmitAnswer(ctx, sessionCode, client.ID, questionID, optionID); err != nil {
				slog.Error("engine.SubmitAnswer failed", "error", err, "session", sessionCode, "player", client.ID)
			}
		}

	case hub.MsgNextQuestion:
		if !isHost {
			return
		}
		if err := h.engine.NextQuestion(ctx, sessionCode); err != nil {
			slog.Error("engine.NextQuestion failed", "error", err, "session", sessionCode)
		}

	case hub.MsgKickPlayer:
		if !isHost {
			return
		}
		payload, ok := msg.Payload.(map[string]any)
		if !ok {
			return
		}
		playerID, _ := payload["player_id"].(string)
		if playerID == "" {
			return
		}
		kicked := h.hub.KickPlayer(sessionCode, playerID)
		if kicked != nil {
			// Broadcast player_left to remaining clients so lobby updates
			h.hub.Broadcast(sessionCode, hub.Message{
				Type: hub.MsgPlayerLeft,
				Payload: map[string]string{
					"player_id": playerID,
				},
			})
			slog.Info("player kicked", "session", sessionCode, "player", playerID)
		}

	default:
		slog.Warn("unhandled message type", "type", msg.Type, "isHost", isHost, "session", sessionCode)
	}
}

// sendInitialState sends the current game state to a newly connected client.
func (h *Handler) sendInitialState(ctx context.Context, sessionCode string, client *hub.Client, isHost bool) {
	// Small delay to ensure writePump goroutine is running.
	time.Sleep(100 * time.Millisecond)

	state, err := h.engine.GetCurrentState(ctx, sessionCode)
	if err != nil {
		return // no active game — lobby connection, nothing to send
	}

	var msg *hub.Message
	switch state.Phase {
	case game.PhaseQuestion:
		if isHost {
			msg, _ = h.engine.GetHostQuestion(ctx, sessionCode)
		} else {
			msg, _ = h.engine.GetCurrentQuestion(ctx, sessionCode)
		}
	}

	if msg != nil {
		data, err := json.Marshal(msg)
		if err != nil {
			return
		}
		select {
		case client.Send <- data:
		default:
		}
	}
}
