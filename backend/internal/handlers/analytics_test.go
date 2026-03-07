package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"

	appMiddleware "github.com/HassanA01/Hilal/backend/internal/middleware"
)

// analyticsRouter returns a chi router with Recoverer middleware and a single
// route wired to the given handler method. Recoverer catches nil-DB panics and
// turns them into 500 responses, matching production behavior.
func analyticsRouter(method, pattern string, handlerFn http.HandlerFunc) *chi.Mux {
	r := chi.NewRouter()
	r.Use(chimw.Recoverer)
	r.MethodFunc(method, pattern, handlerFn)
	return r
}

// analyticsRequest builds a GET request to the given URL with admin ID in context.
func analyticsRequest(url, adminID string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, url, nil)
	ctx := appMiddleware.ContextWithAdminID(req.Context(), adminID)
	return req.WithContext(ctx)
}

// ---------------------------------------------------------------------------
// AnalyticsOverview
// ---------------------------------------------------------------------------

func TestAnalyticsOverview_NilDB(t *testing.T) {
	h := newTestHandler()
	r := analyticsRouter(http.MethodGet, "/analytics/overview", h.AnalyticsOverview)

	req := analyticsRequest("/analytics/overview", "test-admin-id")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d — body: %s", w.Code, w.Body.String())
	}
}

// ---------------------------------------------------------------------------
// AnalyticsGamesOverTime
// ---------------------------------------------------------------------------

func TestAnalyticsGamesOverTime_NilDB(t *testing.T) {
	h := newTestHandler()
	r := analyticsRouter(http.MethodGet, "/analytics/games-over-time", h.AnalyticsGamesOverTime)

	req := analyticsRequest("/analytics/games-over-time", "test-admin-id")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d — body: %s", w.Code, w.Body.String())
	}
}

func TestAnalyticsGamesOverTime_Params(t *testing.T) {
	h := newTestHandler()
	r := analyticsRouter(http.MethodGet, "/analytics/games-over-time", h.AnalyticsGamesOverTime)

	tests := []struct {
		name string
		url  string
	}{
		{"defaults", "/analytics/games-over-time"},
		{"period day", "/analytics/games-over-time?period=day"},
		{"period week", "/analytics/games-over-time?period=week"},
		{"period month", "/analytics/games-over-time?period=month"},
		{"range 7d", "/analytics/games-over-time?range=7d"},
		{"range 30d", "/analytics/games-over-time?range=30d"},
		{"range 90d", "/analytics/games-over-time?range=90d"},
		{"range all", "/analytics/games-over-time?range=all"},
		{"invalid period defaults", "/analytics/games-over-time?period=invalid"},
		{"combined params", "/analytics/games-over-time?period=week&range=30d"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := analyticsRequest(tc.url, "test-admin-id")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			// All should reach the DB call (nil) and get 500 via Recoverer — not panic.
			if w.Code != http.StatusInternalServerError {
				t.Errorf("expected 500, got %d — body: %s", w.Code, w.Body.String())
			}
		})
	}
}

// ---------------------------------------------------------------------------
// AnalyticsQuizzes
// ---------------------------------------------------------------------------

func TestAnalyticsQuizzes_NilDB(t *testing.T) {
	h := newTestHandler()
	r := analyticsRouter(http.MethodGet, "/analytics/quizzes-stats", h.AnalyticsQuizzes)

	req := analyticsRequest("/analytics/quizzes-stats", "test-admin-id")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d — body: %s", w.Code, w.Body.String())
	}
}

func TestAnalyticsQuizzes_SortAndOrder(t *testing.T) {
	h := newTestHandler()
	r := analyticsRouter(http.MethodGet, "/analytics/quizzes-stats", h.AnalyticsQuizzes)

	tests := []struct {
		name string
		url  string
	}{
		{"default sort", "/analytics/quizzes-stats"},
		{"sort by plays", "/analytics/quizzes-stats?sort=plays"},
		{"sort by avg_score", "/analytics/quizzes-stats?sort=avg_score"},
		{"sort by completion", "/analytics/quizzes-stats?sort=completion"},
		{"invalid sort defaults", "/analytics/quizzes-stats?sort=invalid"},
		{"order asc", "/analytics/quizzes-stats?order=asc"},
		{"order desc", "/analytics/quizzes-stats?order=desc"},
		{"invalid order defaults to desc", "/analytics/quizzes-stats?order=invalid"},
		{"combined sort and order", "/analytics/quizzes-stats?sort=avg_score&order=asc"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := analyticsRequest(tc.url, "test-admin-id")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != http.StatusInternalServerError {
				t.Errorf("expected 500, got %d — body: %s", w.Code, w.Body.String())
			}
		})
	}
}

// ---------------------------------------------------------------------------
// AnalyticsQuizQuestions
// ---------------------------------------------------------------------------

func TestAnalyticsQuizQuestions_NilDB(t *testing.T) {
	h := newTestHandler()

	r := chi.NewRouter()
	r.Use(chimw.Recoverer)
	r.Get("/analytics/quizzes/{quizID}/questions", h.AnalyticsQuizQuestions)

	req := analyticsRequest(
		"/analytics/quizzes/00000000-0000-0000-0000-000000000001/questions",
		"test-admin-id",
	)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// The handler calls h.db.QueryRow on the ownership check — nil DB → 500 via Recoverer.
	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d — body: %s", w.Code, w.Body.String())
	}
}

func TestAnalyticsQuizQuestions_URLParamParsed(t *testing.T) {
	h := newTestHandler()

	r := chi.NewRouter()
	r.Use(chimw.Recoverer)
	r.Get("/analytics/quizzes/{quizID}/questions", h.AnalyticsQuizQuestions)

	uuids := []string{
		"00000000-0000-0000-0000-000000000001",
		"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
	}
	for _, id := range uuids {
		t.Run(id, func(t *testing.T) {
			req := analyticsRequest(
				"/analytics/quizzes/"+id+"/questions",
				"test-admin-id",
			)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			// Regardless of UUID value, nil DB means 500.
			if w.Code != http.StatusInternalServerError {
				t.Errorf("expected 500, got %d — body: %s", w.Code, w.Body.String())
			}
		})
	}
}

// ---------------------------------------------------------------------------
// AnalyticsTopPlayers
// ---------------------------------------------------------------------------

func TestAnalyticsTopPlayers_NilDB(t *testing.T) {
	h := newTestHandler()
	r := analyticsRouter(http.MethodGet, "/analytics/players", h.AnalyticsTopPlayers)

	req := analyticsRequest("/analytics/players", "test-admin-id")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d — body: %s", w.Code, w.Body.String())
	}
}

func TestAnalyticsTopPlayers_LimitParams(t *testing.T) {
	h := newTestHandler()
	r := analyticsRouter(http.MethodGet, "/analytics/players", h.AnalyticsTopPlayers)

	tests := []struct {
		name string
		url  string
	}{
		{"default limit", "/analytics/players"},
		{"limit 10", "/analytics/players?limit=10"},
		{"limit 1", "/analytics/players?limit=1"},
		{"limit 100", "/analytics/players?limit=100"},
		{"limit exceeds max clamped to 100", "/analytics/players?limit=999"},
		{"negative limit defaults to 20", "/analytics/players?limit=-1"},
		{"zero limit defaults to 20", "/analytics/players?limit=0"},
		{"non-numeric limit defaults to 20", "/analytics/players?limit=abc"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := analyticsRequest(tc.url, "test-admin-id")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			// All reach DB → nil DB → 500.
			if w.Code != http.StatusInternalServerError {
				t.Errorf("expected 500, got %d — body: %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestAnalyticsTopPlayers_SortParams(t *testing.T) {
	h := newTestHandler()
	r := analyticsRouter(http.MethodGet, "/analytics/players", h.AnalyticsTopPlayers)

	tests := []struct {
		name string
		url  string
	}{
		{"default sort", "/analytics/players"},
		{"sort by score", "/analytics/players?sort=score"},
		{"sort by games", "/analytics/players?sort=games"},
		{"sort by speed", "/analytics/players?sort=speed"},
		{"invalid sort defaults", "/analytics/players?sort=invalid"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := analyticsRequest(tc.url, "test-admin-id")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != http.StatusInternalServerError {
				t.Errorf("expected 500, got %d — body: %s", w.Code, w.Body.String())
			}
		})
	}
}

// ---------------------------------------------------------------------------
// AnalyticsEngagement
// ---------------------------------------------------------------------------

func TestAnalyticsEngagement_NilDB(t *testing.T) {
	h := newTestHandler()
	r := analyticsRouter(http.MethodGet, "/analytics/engagement", h.AnalyticsEngagement)

	req := analyticsRequest("/analytics/engagement", "test-admin-id")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d — body: %s", w.Code, w.Body.String())
	}
}

// ---------------------------------------------------------------------------
// Response type JSON marshalling
// ---------------------------------------------------------------------------

func TestAnalyticsResponseTypes_JSONShape(t *testing.T) {
	t.Run("overviewResponse", func(t *testing.T) {
		resp := overviewResponse{
			TotalQuizzes:      5,
			TotalGames:        20,
			TotalPlayers:      100,
			TotalAnswers:      400,
			AvgPlayersPerGame: 5.0,
			AvgScore:          750.5,
		}
		data, err := json.Marshal(resp)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		var m map[string]any
		if err := json.Unmarshal(data, &m); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		expectedKeys := []string{
			"total_quizzes", "total_games", "total_players",
			"total_answers", "avg_players_per_game", "avg_score",
		}
		for _, k := range expectedKeys {
			if _, ok := m[k]; !ok {
				t.Errorf("missing JSON key %q", k)
			}
		}
	})

	t.Run("timeSeriesPoint", func(t *testing.T) {
		p := timeSeriesPoint{Date: "2025-01-01", Games: 3, Players: 12}
		data, err := json.Marshal(p)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		var m map[string]any
		if err := json.Unmarshal(data, &m); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		for _, k := range []string{"date", "games", "players"} {
			if _, ok := m[k]; !ok {
				t.Errorf("missing JSON key %q", k)
			}
		}
	})

	t.Run("quizStatsResponse", func(t *testing.T) {
		qs := quizStatsResponse{
			ID: "abc", Title: "Test", Plays: 10,
			AvgScore: 800, PlayerCount: 50, QuestionCount: 5,
			CreatedAt: "2025-01-01T00:00:00Z",
		}
		data, err := json.Marshal(qs)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		var m map[string]any
		if err := json.Unmarshal(data, &m); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		expectedKeys := []string{
			"id", "title", "plays", "avg_score",
			"player_count", "question_count", "created_at",
		}
		for _, k := range expectedKeys {
			if _, ok := m[k]; !ok {
				t.Errorf("missing JSON key %q", k)
			}
		}
	})

	t.Run("questionStatsResponse", func(t *testing.T) {
		qs := questionStatsResponse{
			ID: "q1", Text: "What?", Type: "multiple_choice",
			Order: 1, CorrectPct: 75.0, AvgPoints: 800,
			TotalAnswers: 20,
			Options: []optionDistribution{
				{Text: "A", Count: 15, Pct: 75.0},
				{Text: "B", Count: 5, Pct: 25.0},
			},
		}
		data, err := json.Marshal(qs)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		var m map[string]any
		if err := json.Unmarshal(data, &m); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		expectedKeys := []string{
			"id", "text", "type", "order",
			"correct_pct", "avg_points", "total_answers", "options",
		}
		for _, k := range expectedKeys {
			if _, ok := m[k]; !ok {
				t.Errorf("missing JSON key %q", k)
			}
		}
		opts, ok := m["options"].([]any)
		if !ok || len(opts) != 2 {
			t.Errorf("expected options array with 2 items, got %v", m["options"])
		}
	})

	t.Run("playerStatsResponse", func(t *testing.T) {
		ps := playerStatsResponse{
			Name: "Alice", TotalScore: 5000, GamesPlayed: 3,
			AvgScore: 1666.67, AvgSpeedMs: 1200.5,
		}
		data, err := json.Marshal(ps)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		var m map[string]any
		if err := json.Unmarshal(data, &m); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		expectedKeys := []string{
			"name", "total_score", "games_played", "avg_score", "avg_speed_ms",
		}
		for _, k := range expectedKeys {
			if _, ok := m[k]; !ok {
				t.Errorf("missing JSON key %q", k)
			}
		}
	})

	t.Run("engagementResponse", func(t *testing.T) {
		resp := engagementResponse{
			PeakHours: []peakHourBucket{
				{DayOfWeek: 1, Hour: 14, Count: 5},
			},
			AvgGameDuration: 120.5,
		}
		data, err := json.Marshal(resp)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		var m map[string]any
		if err := json.Unmarshal(data, &m); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		for _, k := range []string{"peak_hours", "avg_game_duration_seconds"} {
			if _, ok := m[k]; !ok {
				t.Errorf("missing JSON key %q", k)
			}
		}
	})
}
