package handlers

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/HassanA01/Hilal/backend/internal/hub"
	"github.com/HassanA01/Hilal/backend/internal/metrics"
	appMiddleware "github.com/HassanA01/Hilal/backend/internal/middleware"
	"github.com/HassanA01/Hilal/backend/internal/models"
)

func (h *Handler) ListSessions(w http.ResponseWriter, r *http.Request) {
	adminID := appMiddleware.GetAdminID(r.Context())
	quizID := r.URL.Query().Get("quiz_id")

	query := `
		SELECT gs.id, gs.quiz_id, q.title, gs.code, gs.status,
		       COUNT(gp.id) AS player_count,
		       gs.started_at, gs.ended_at, gs.created_at
		FROM game_sessions gs
		JOIN quizzes q ON q.id = gs.quiz_id
		LEFT JOIN game_players gp ON gp.session_id = gs.id
		WHERE q.admin_id = $1`
	args := []any{adminID}

	if quizID != "" {
		query += ` AND gs.quiz_id = $2`
		args = append(args, quizID)
	}
	query += ` GROUP BY gs.id, q.title ORDER BY gs.created_at DESC`

	rows, err := h.db.Query(r.Context(), query, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list sessions")
		return
	}
	defer rows.Close()

	sessions := make([]models.SessionSummary, 0)
	for rows.Next() {
		var s models.SessionSummary
		if err := rows.Scan(&s.ID, &s.QuizID, &s.QuizTitle, &s.Code, &s.Status,
			&s.PlayerCount, &s.StartedAt, &s.EndedAt, &s.CreatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read sessions")
			return
		}
		sessions = append(sessions, s)
	}
	writeJSON(w, http.StatusOK, sessions)
}

func (h *Handler) CreateSession(w http.ResponseWriter, r *http.Request) {
	adminID := appMiddleware.GetAdminID(r.Context())

	var req struct {
		QuizID string `json:"quiz_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.QuizID == "" {
		writeError(w, http.StatusBadRequest, "quiz_id is required")
		return
	}

	// Verify quiz exists and belongs to this admin
	var exists bool
	err := h.db.QueryRow(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM quizzes WHERE id = $1 AND admin_id = $2)`,
		req.QuizID, adminID,
	).Scan(&exists)
	if err != nil || !exists {
		writeError(w, http.StatusNotFound, "quiz not found")
		return
	}

	// If a waiting session already exists for this quiz, return it rather than
	// creating a new orphan. This prevents zombie "waiting" rows accumulating.
	var existingCode string
	var existingID uuid.UUID
	_ = h.db.QueryRow(r.Context(),
		`SELECT id, code FROM game_sessions WHERE quiz_id = $1 AND status = $2 LIMIT 1`,
		req.QuizID, models.GameStatusWaiting,
	).Scan(&existingID, &existingCode)

	if existingCode != "" {
		writeJSON(w, http.StatusOK, map[string]string{
			"session_id": existingID.String(),
			"code":       existingCode,
		})
		return
	}

	code, err := generateCode()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate session code")
		return
	}
	sessionID := uuid.New()

	_, err = h.db.Exec(r.Context(),
		`INSERT INTO game_sessions (id, quiz_id, code, status) VALUES ($1, $2, $3, $4)`,
		sessionID, req.QuizID, code, models.GameStatusWaiting,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create session")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{
		"session_id": sessionID.String(),
		"code":       code,
	})
}

func (h *Handler) GetSession(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionID")
	var session models.GameSession
	err := h.db.QueryRow(r.Context(),
		`SELECT id, quiz_id, code, status, started_at, ended_at, created_at FROM game_sessions WHERE id = $1`,
		sessionID,
	).Scan(&session.ID, &session.QuizID, &session.Code, &session.Status,
		&session.StartedAt, &session.EndedAt, &session.CreatedAt)
	if err != nil {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	writeJSON(w, http.StatusOK, session)
}

func (h *Handler) EndSession(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionID")

	// Fetch current status and code together.
	var code string
	var status models.GameStatus
	err := h.db.QueryRow(r.Context(),
		`SELECT code, status FROM game_sessions WHERE id = $1`, sessionID,
	).Scan(&code, &status)
	if err != nil {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}

	// Waiting sessions were never played — hard-delete them instead of leaving
	// a finished ghost row in history.
	if status == models.GameStatusWaiting {
		_, err = h.db.Exec(r.Context(), `DELETE FROM game_sessions WHERE id = $1`, sessionID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to delete session")
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}

	now := time.Now()
	_, err = h.db.Exec(r.Context(),
		`UPDATE game_sessions SET status = $1, ended_at = $2 WHERE id = $3`,
		models.GameStatusFinished, now, sessionID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to end session")
		return
	}

	// Notify all WebSocket clients and clean up Redis.
	h.engine.EndGame(context.Background(), code)
	metrics.ActiveGames.Add(-1)

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) JoinSession(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Code string `json:"code"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Code == "" || req.Name == "" {
		writeError(w, http.StatusBadRequest, "code and name are required")
		return
	}

	var session models.GameSession
	err := h.db.QueryRow(r.Context(),
		`SELECT id, quiz_id, code, status FROM game_sessions WHERE code = $1 AND status = $2`,
		req.Code, models.GameStatusWaiting,
	).Scan(&session.ID, &session.QuizID, &session.Code, &session.Status)
	if err != nil {
		writeError(w, http.StatusNotFound, "game not found or already started")
		return
	}

	playerID := uuid.New()
	_, err = h.db.Exec(r.Context(),
		`INSERT INTO game_players (id, session_id, name, score) VALUES ($1, $2, $3, 0)`,
		playerID, session.ID, req.Name,
	)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			writeError(w, http.StatusConflict, "name already taken in this game")
		} else {
			writeError(w, http.StatusInternalServerError, "failed to join game")
		}
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"player_id":  playerID.String(),
		"session_id": session.ID.String(),
		"code":       session.Code,
		"name":       req.Name,
	})
}

func (h *Handler) GetSessionByCode(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	var session models.GameSession
	err := h.db.QueryRow(r.Context(),
		`SELECT id, quiz_id, code, status, started_at, ended_at, created_at FROM game_sessions WHERE code = $1`,
		code,
	).Scan(&session.ID, &session.QuizID, &session.Code, &session.Status,
		&session.StartedAt, &session.EndedAt, &session.CreatedAt)
	if err != nil {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	writeJSON(w, http.StatusOK, session)
}

func (h *Handler) ListSessionPlayers(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionID")
	rows, err := h.db.Query(r.Context(),
		`SELECT id, session_id, name, score, joined_at FROM game_players WHERE session_id = $1 ORDER BY joined_at ASC`,
		sessionID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list players")
		return
	}
	defer rows.Close()

	players := make([]models.GamePlayer, 0)
	for rows.Next() {
		var p models.GamePlayer
		if err := rows.Scan(&p.ID, &p.SessionID, &p.Name, &p.Score, &p.JoinedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read players")
			return
		}
		players = append(players, p)
	}
	writeJSON(w, http.StatusOK, players)
}

func (h *Handler) StartSession(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionID")
	now := time.Now()

	var session models.GameSession
	err := h.db.QueryRow(r.Context(),
		`UPDATE game_sessions SET status = $1, started_at = $2 WHERE id = $3 AND status = $4
		 RETURNING id, quiz_id, code, status, started_at, ended_at, created_at`,
		models.GameStatusActive, now, sessionID, models.GameStatusWaiting,
	).Scan(&session.ID, &session.QuizID, &session.Code, &session.Status,
		&session.StartedAt, &session.EndedAt, &session.CreatedAt)
	if err != nil {
		writeError(w, http.StatusNotFound, "session not found or already started")
		return
	}

	metrics.ActiveGames.Add(1)

	h.hub.Broadcast(session.Code, hub.Message{
		Type:    hub.MsgGameStarted,
		Payload: map[string]string{"session_id": session.ID.String()},
	})

	// Kick off the game engine in a goroutine with a background context.
	// r.Context() is cancelled when the HTTP response is sent, so we must not use it here.
	go func() {
		if err := h.engine.StartGame(context.Background(), session.Code, session.ID.String(), session.QuizID.String()); err != nil {
			slog.Error("engine.StartGame failed", "error", err, "session", session.Code)
		}
	}()

	writeJSON(w, http.StatusOK, session)
}

func (h *Handler) GetPlayerResults(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionID")
	playerID := chi.URLParam(r, "playerID")

	// Validate IDs are valid UUIDs
	if _, err := uuid.Parse(sessionID); err != nil {
		writeError(w, http.StatusBadRequest, "invalid session ID")
		return
	}
	if _, err := uuid.Parse(playerID); err != nil {
		writeError(w, http.StatusBadRequest, "invalid player ID")
		return
	}

	// Fetch player name and score
	var results models.PlayerResults
	err := h.db.QueryRow(r.Context(),
		`SELECT id, name, score FROM game_players WHERE id = $1 AND session_id = $2`,
		playerID, sessionID,
	).Scan(&results.PlayerID, &results.Name, &results.Score)
	if err != nil {
		writeError(w, http.StatusNotFound, "player not found")
		return
	}

	// Calculate rank: number of players with a higher score + 1
	err = h.db.QueryRow(r.Context(),
		`SELECT COUNT(*) + 1 FROM game_players WHERE session_id = $1 AND score > $2`,
		sessionID, results.Score,
	).Scan(&results.Rank)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to compute rank")
		return
	}

	// Fetch per-question breakdown.
	// Use a lateral subquery to aggregate all correct options into arrays,
	// avoiding duplicate rows for multi_select questions.
	rows, err := h.db.Query(r.Context(), `
		SELECT
			q.id,
			q.text,
			q.type,
			q."order",
			ga.option_id,
			COALESCE(sel.text, ''),
			ga.is_correct,
			ga.points,
			COALESCE(corr.ids, ARRAY[]::UUID[]),
			COALESCE(corr.texts, ARRAY[]::TEXT[]),
			ga.answer_data
		FROM game_answers ga
		JOIN questions q ON q.id = ga.question_id
		LEFT JOIN options sel ON sel.id = ga.option_id
		LEFT JOIN LATERAL (
			SELECT array_agg(o.id) AS ids, array_agg(o.text) AS texts
			FROM options o WHERE o.question_id = q.id AND o.is_correct = TRUE
		) corr ON TRUE
		WHERE ga.session_id = $1 AND ga.player_id = $2
		ORDER BY q."order" ASC
	`, sessionID, playerID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to fetch results")
		return
	}
	defer rows.Close()

	results.Questions = make([]models.PlayerResultQuestion, 0)
	for rows.Next() {
		var q models.PlayerResultQuestion
		if err := rows.Scan(
			&q.QuestionID, &q.QuestionText, &q.QuestionType, &q.QuestionOrder,
			&q.SelectedOptionID, &q.SelectedOptionText,
			&q.IsCorrect, &q.Points,
			&q.CorrectOptionIDs, &q.CorrectOptionTexts,
			&q.AnswerData,
		); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read results")
			return
		}
		// Backward compat: populate single correct fields from arrays.
		if len(q.CorrectOptionIDs) > 0 {
			q.CorrectOptionID = &q.CorrectOptionIDs[0]
			q.CorrectOptionText = q.CorrectOptionTexts[0]
		}
		results.Questions = append(results.Questions, q)
	}

	writeJSON(w, http.StatusOK, results)
}

func generateCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}
