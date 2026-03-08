package metrics

import (
	"testing"
	"time"
)

func TestLatencyTracker_Empty(t *testing.T) {
	var lt latencyTracker
	snap := lt.snapshot()
	if snap["count"] != int64(0) {
		t.Errorf("expected count 0, got %v", snap["count"])
	}
	if snap["avg_ms"] != int64(0) {
		t.Errorf("expected avg_ms 0, got %v", snap["avg_ms"])
	}
}

func TestLatencyTracker_SingleSample(t *testing.T) {
	var lt latencyTracker
	lt.record(100 * time.Millisecond)

	snap := lt.snapshot()
	if snap["count"] != int64(1) {
		t.Errorf("expected count 1, got %v", snap["count"])
	}
	if snap["avg_ms"] != int64(100) {
		t.Errorf("expected avg_ms 100, got %v", snap["avg_ms"])
	}
}

func TestLatencyTracker_MultipleSamples(t *testing.T) {
	var lt latencyTracker
	lt.record(100 * time.Millisecond)
	lt.record(200 * time.Millisecond)
	lt.record(300 * time.Millisecond)

	snap := lt.snapshot()
	if snap["count"] != int64(3) {
		t.Errorf("expected count 3, got %v", snap["count"])
	}
	// Average of 100+200+300 = 600/3 = 200ms
	if snap["avg_ms"] != int64(200) {
		t.Errorf("expected avg_ms 200, got %v", snap["avg_ms"])
	}
}

func TestSnapshot_DefaultValues(t *testing.T) {
	snap := Snapshot()
	if snap["active_ws_connections"] != int64(0) {
		t.Errorf("expected 0 active ws connections, got %v", snap["active_ws_connections"])
	}
	if snap["active_games"] != int64(0) {
		t.Errorf("expected 0 active games, got %v", snap["active_games"])
	}
}

func TestAtomicCounters(t *testing.T) {
	ActiveWSConnections.Store(0)
	ActiveGames.Store(0)

	ActiveWSConnections.Add(5)
	ActiveGames.Add(2)

	if ActiveWSConnections.Load() != 5 {
		t.Errorf("expected 5 ws connections, got %d", ActiveWSConnections.Load())
	}
	if ActiveGames.Load() != 2 {
		t.Errorf("expected 2 active games, got %d", ActiveGames.Load())
	}

	ActiveWSConnections.Add(-3)
	ActiveGames.Add(-1)

	if ActiveWSConnections.Load() != 2 {
		t.Errorf("expected 2 ws connections, got %d", ActiveWSConnections.Load())
	}
	if ActiveGames.Load() != 1 {
		t.Errorf("expected 1 active game, got %d", ActiveGames.Load())
	}

	// Reset for other tests
	ActiveWSConnections.Store(0)
	ActiveGames.Store(0)
}
