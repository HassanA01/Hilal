package metrics

import (
	"encoding/json"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

// Counters tracks application-level metrics using atomic operations.
var (
	ActiveWSConnections atomic.Int64
	ActiveGames         atomic.Int64

	// Latency tracking (thread-safe rolling window).
	answerLatency latencyTracker
	aiGenLatency  latencyTracker
)

// RecordAnswerLatency records a single answer submission latency.
func RecordAnswerLatency(d time.Duration) { answerLatency.record(d) }

// RecordAIGenerationLatency records a single AI quiz generation latency.
func RecordAIGenerationLatency(d time.Duration) { aiGenLatency.record(d) }

// Snapshot returns a point-in-time view of all metrics.
func Snapshot() map[string]any {
	return map[string]any{
		"active_ws_connections":     ActiveWSConnections.Load(),
		"active_games":              ActiveGames.Load(),
		"answer_submission_latency": answerLatency.snapshot(),
		"ai_generation_latency":     aiGenLatency.snapshot(),
	}
}

// Handler exposes metrics as JSON at /metrics.
func Handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(Snapshot())
	}
}

// latencyTracker keeps the last N durations for percentile-like stats.
type latencyTracker struct {
	mu      sync.Mutex
	samples []time.Duration
	count   int64
	sum     time.Duration
}

const maxSamples = 1000

func (lt *latencyTracker) record(d time.Duration) {
	lt.mu.Lock()
	defer lt.mu.Unlock()
	lt.count++
	lt.sum += d
	if len(lt.samples) < maxSamples {
		lt.samples = append(lt.samples, d)
	} else {
		// Circular overwrite.
		lt.samples[lt.count%int64(maxSamples)] = d
	}
}

func (lt *latencyTracker) snapshot() map[string]any {
	lt.mu.Lock()
	defer lt.mu.Unlock()
	if lt.count == 0 {
		return map[string]any{
			"count":  int64(0),
			"avg_ms": int64(0),
		}
	}
	avg := lt.sum / time.Duration(lt.count)
	return map[string]any{
		"count":  lt.count,
		"avg_ms": avg.Milliseconds(),
	}
}
