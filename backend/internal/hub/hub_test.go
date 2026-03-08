package hub

import "testing"

func newTestHub() *Hub {
	return New(nil) // nil redis is fine for non-Redis methods
}

func TestBroadcastToHost(t *testing.T) {
	h := newTestHub()

	hostSend := make(chan []byte, 4)
	playerSend := make(chan []byte, 4)

	host := &Client{ID: "host-1", IsHost: true, Send: hostSend}
	player := &Client{ID: "player-1", IsHost: false, Send: playerSend}

	h.JoinRoom("ROOM1", host)
	h.JoinRoom("ROOM1", player)

	h.BroadcastToHost("ROOM1", Message{Type: MsgQuestion, Payload: map[string]any{"q": 1}})

	if len(hostSend) != 1 {
		t.Errorf("host should receive 1 message, got %d", len(hostSend))
	}
	if len(playerSend) != 0 {
		t.Errorf("player should receive 0 messages, got %d", len(playerSend))
	}
}

func TestBroadcastToPlayers(t *testing.T) {
	h := newTestHub()

	hostSend := make(chan []byte, 4)
	p1Send := make(chan []byte, 4)
	p2Send := make(chan []byte, 4)

	host := &Client{ID: "host-1", IsHost: true, Send: hostSend}
	p1 := &Client{ID: "player-1", IsHost: false, Send: p1Send}
	p2 := &Client{ID: "player-2", IsHost: false, Send: p2Send}

	h.JoinRoom("ROOM2", host)
	h.JoinRoom("ROOM2", p1)
	h.JoinRoom("ROOM2", p2)

	h.BroadcastToPlayers("ROOM2", Message{Type: MsgQuestion, Payload: map[string]any{"q": 1}})

	if len(hostSend) != 0 {
		t.Errorf("host should receive 0 messages, got %d", len(hostSend))
	}
	if len(p1Send) != 1 {
		t.Errorf("player1 should receive 1 message, got %d", len(p1Send))
	}
	if len(p2Send) != 1 {
		t.Errorf("player2 should receive 1 message, got %d", len(p2Send))
	}
}

func TestBroadcastToHostEmptyRoom(t *testing.T) {
	h := newTestHub()
	// Should not panic on empty/unknown room.
	h.BroadcastToHost("NOROOM", Message{Type: MsgQuestion, Payload: nil})
}

func TestAnswerCountMessageType(t *testing.T) {
	if MsgAnswerCount != "answer_count" {
		t.Errorf("MsgAnswerCount = %q, want \"answer_count\"", MsgAnswerCount)
	}
}

func TestBroadcastAnswerCountToHostOnly(t *testing.T) {
	h := newTestHub()

	hostSend := make(chan []byte, 4)
	playerSend := make(chan []byte, 4)

	host := &Client{ID: "host-1", IsHost: true, Send: hostSend}
	player := &Client{ID: "player-1", IsHost: false, Send: playerSend}

	h.JoinRoom("ROOM4", host)
	h.JoinRoom("ROOM4", player)

	h.BroadcastToHost("ROOM4", Message{
		Type:    MsgAnswerCount,
		Payload: map[string]any{"answered": 1, "total": 3},
	})

	if len(hostSend) != 1 {
		t.Errorf("host should receive answer_count message, got %d messages", len(hostSend))
	}
	if len(playerSend) != 0 {
		t.Errorf("player should not receive answer_count message, got %d messages", len(playerSend))
	}
}

func TestKickPlayer_Success(t *testing.T) {
	h := newTestHub()

	hostSend := make(chan []byte, 4)
	playerSend := make(chan []byte, 4)

	host := &Client{ID: "host-1", IsHost: true, Send: hostSend}
	player := &Client{ID: "player-1", IsHost: false, Send: playerSend}

	h.JoinRoom("KICK1", host)
	h.JoinRoom("KICK1", player)

	kicked := h.KickPlayer("KICK1", "player-1")
	if kicked == nil {
		t.Fatal("expected kicked client, got nil")
	}
	if kicked.ID != "player-1" {
		t.Errorf("kicked client ID = %q, want %q", kicked.ID, "player-1")
	}

	// The kicked player should have received a player_kicked message.
	if len(playerSend) != 1 {
		t.Errorf("kicked player should receive 1 message, got %d", len(playerSend))
	}

	// The player should be removed from the room; only host remains.
	if h.RoomPlayerCount("KICK1") != 0 {
		t.Errorf("room should have 0 players after kick, got %d", h.RoomPlayerCount("KICK1"))
	}
}

func TestKickPlayer_CannotKickHost(t *testing.T) {
	h := newTestHub()

	hostSend := make(chan []byte, 4)
	host := &Client{ID: "host-1", IsHost: true, Send: hostSend}

	h.JoinRoom("KICK2", host)

	kicked := h.KickPlayer("KICK2", "host-1")
	if kicked != nil {
		t.Errorf("should not be able to kick host, got %+v", kicked)
	}

	// Host should still be in the room.
	if len(hostSend) != 0 {
		t.Errorf("host should not receive any message, got %d", len(hostSend))
	}
}

func TestKickPlayer_NonexistentPlayer(t *testing.T) {
	h := newTestHub()

	hostSend := make(chan []byte, 4)
	host := &Client{ID: "host-1", IsHost: true, Send: hostSend}

	h.JoinRoom("KICK3", host)

	kicked := h.KickPlayer("KICK3", "ghost-player")
	if kicked != nil {
		t.Errorf("should return nil for nonexistent player, got %+v", kicked)
	}

	// Also test with a completely unknown room.
	kicked = h.KickPlayer("NOROOM", "ghost-player")
	if kicked != nil {
		t.Errorf("should return nil for unknown room, got %+v", kicked)
	}
}

func TestBroadcastToPlayersNoPlayers(t *testing.T) {
	h := newTestHub()

	hostSend := make(chan []byte, 4)
	host := &Client{ID: "host-1", IsHost: true, Send: hostSend}
	h.JoinRoom("ROOM3", host)

	h.BroadcastToPlayers("ROOM3", Message{Type: MsgQuestion, Payload: nil})

	if len(hostSend) != 0 {
		t.Errorf("host should not receive player broadcast, got %d", len(hostSend))
	}
}
