package hub

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"

	"github.com/redis/go-redis/v9"
)

// MessageType defines the type of a WebSocket message.
type MessageType string

const (
	MsgPlayerJoined    MessageType = "player_joined"
	MsgPlayerLeft      MessageType = "player_left"
	MsgGameStarted     MessageType = "game_started"
	MsgQuestion        MessageType = "question"
	MsgAnswerSubmitted MessageType = "answer_submitted"
	MsgAnswerReveal    MessageType = "answer_reveal"
	MsgLeaderboard     MessageType = "leaderboard"
	MsgNextQuestion    MessageType = "next_question"
	MsgGameOver        MessageType = "game_over"
	MsgPodium          MessageType = "podium"
	MsgError           MessageType = "error"
	MsgPing            MessageType = "ping"
	MsgAnswerCount     MessageType = "answer_count"
	MsgPlayerKicked    MessageType = "player_kicked"
	MsgKickPlayer      MessageType = "kick_player"
)

// Message is the envelope for all WebSocket communication.
type Message struct {
	Type    MessageType `json:"type"`
	Payload any         `json:"payload"`
}

// Client represents a connected WebSocket client.
type Client struct {
	ID        string
	SessionID string
	IsHost    bool
	Send      chan []byte
}

// Hub maintains active game rooms and broadcasts messages.
type Hub struct {
	mu    sync.RWMutex
	rooms map[string]map[*Client]bool // sessionCode -> clients
	redis *redis.Client
}

func New(redisClient *redis.Client) *Hub {
	return &Hub{
		rooms: make(map[string]map[*Client]bool),
		redis: redisClient,
	}
}

func (h *Hub) Run() {
	slog.Info("hub running")
}

// JoinRoom adds a client to a room.
func (h *Hub) JoinRoom(roomCode string, client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.rooms[roomCode] == nil {
		h.rooms[roomCode] = make(map[*Client]bool)
	}
	h.rooms[roomCode][client] = true
}

// LeaveRoom removes a client from a room.
func (h *Hub) LeaveRoom(roomCode string, client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if room, ok := h.rooms[roomCode]; ok {
		delete(room, client)
		if len(room) == 0 {
			delete(h.rooms, roomCode)
		}
	}
}

// Broadcast sends a message to all clients in a room.
func (h *Hub) Broadcast(roomCode string, msg Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		slog.Error("broadcast marshal error", "error", err, "room", roomCode)
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for client := range h.rooms[roomCode] {
		select {
		case client.Send <- data:
		default:
			close(client.Send)
			delete(h.rooms[roomCode], client)
		}
	}
}

// BroadcastToPlayer sends a message to a specific player by client ID.
func (h *Hub) BroadcastToPlayer(roomCode, clientID string, msg Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for client := range h.rooms[roomCode] {
		if client.ID == clientID {
			select {
			case client.Send <- data:
			default:
			}
			break
		}
	}
}

// BroadcastToHost sends a message only to the host of a room.
func (h *Hub) BroadcastToHost(roomCode string, msg Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		slog.Error("broadcast marshal error", "error", err, "room", roomCode, "target", "host")
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for client := range h.rooms[roomCode] {
		if client.IsHost {
			select {
			case client.Send <- data:
			default:
			}
		}
	}
}

// BroadcastToPlayers sends a message to all non-host clients in a room.
func (h *Hub) BroadcastToPlayers(roomCode string, msg Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		slog.Error("broadcast marshal error", "error", err, "room", roomCode, "target", "players")
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for client := range h.rooms[roomCode] {
		if !client.IsHost {
			select {
			case client.Send <- data:
			default:
			}
		}
	}
}

// KickPlayer removes a non-host player from a room by player ID.
// It sends a player_kicked message, closes the Send channel, and removes
// the client from the room. Returns the kicked client or nil if not found.
func (h *Hub) KickPlayer(roomCode, playerID string) *Client {
	h.mu.Lock()
	defer h.mu.Unlock()
	room, ok := h.rooms[roomCode]
	if !ok {
		return nil
	}
	for client := range room {
		if client.ID == playerID && !client.IsHost {
			// Send kicked message before closing
			data, _ := json.Marshal(Message{
				Type:    MsgPlayerKicked,
				Payload: map[string]string{"reason": "Removed by host"},
			})
			select {
			case client.Send <- data:
			default:
			}
			close(client.Send)
			delete(room, client)
			if len(room) == 0 {
				delete(h.rooms, roomCode)
			}
			return client
		}
	}
	return nil
}

// RoomPlayerCount returns the number of non-host clients in a room.
func (h *Hub) RoomPlayerCount(roomCode string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	count := 0
	for c := range h.rooms[roomCode] {
		if !c.IsHost {
			count++
		}
	}
	return count
}

// StoreGameState saves game state to Redis.
func (h *Hub) StoreGameState(ctx context.Context, key string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return h.redis.Set(ctx, key, data, 0).Err()
}

// GetGameState retrieves game state from Redis.
func (h *Hub) GetGameState(ctx context.Context, key string, dest any) error {
	data, err := h.redis.Get(ctx, key).Bytes()
	if err != nil {
		return err
	}
	return json.Unmarshal(data, dest)
}

// DeleteGameState removes game state from Redis.
func (h *Hub) DeleteGameState(ctx context.Context, key string) error {
	return h.redis.Del(ctx, key).Err()
}
