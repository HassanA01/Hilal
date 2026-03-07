package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/HassanA01/Hilal/backend/internal/config"
)

// newTestHandlerWithSuperadmin returns a Handler with nil DB and a
// configured superadmin email. Because DB is nil, isSuperAdmin always
// returns false — so these tests verify the 403 guard and parameter
// parsing without needing a real database.
func newTestHandlerWithSuperadmin() *Handler {
	return &Handler{
		config: &config.Config{
			JWTSecret:       "test-secret-that-is-long-enough",
			SuperadminEmail: "admin@example.com",
		},
	}
}

func TestPlatformOverview_Forbidden(t *testing.T) {
	h := newTestHandlerWithSuperadmin()
	req := httptest.NewRequest(http.MethodGet, "/platform/overview", nil)
	req = withAdminID(req, "test-admin-id")
	w := httptest.NewRecorder()
	h.PlatformOverview(w, req)
	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d — body: %s", w.Code, w.Body.String())
	}
}

func TestPlatformGrowth_Forbidden(t *testing.T) {
	h := newTestHandlerWithSuperadmin()
	req := httptest.NewRequest(http.MethodGet, "/platform/growth", nil)
	req = withAdminID(req, "test-admin-id")
	w := httptest.NewRecorder()
	h.PlatformGrowth(w, req)
	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d — body: %s", w.Code, w.Body.String())
	}
}

func TestPlatformAdmins_Forbidden(t *testing.T) {
	h := newTestHandlerWithSuperadmin()
	req := httptest.NewRequest(http.MethodGet, "/platform/admins", nil)
	req = withAdminID(req, "test-admin-id")
	w := httptest.NewRecorder()
	h.PlatformAdmins(w, req)
	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d — body: %s", w.Code, w.Body.String())
	}
}

func TestPlatformAIStats_Forbidden(t *testing.T) {
	h := newTestHandlerWithSuperadmin()
	req := httptest.NewRequest(http.MethodGet, "/platform/ai-stats", nil)
	req = withAdminID(req, "test-admin-id")
	w := httptest.NewRecorder()
	h.PlatformAIStats(w, req)
	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d — body: %s", w.Code, w.Body.String())
	}
}

func TestPlatformEngagement_Forbidden(t *testing.T) {
	h := newTestHandlerWithSuperadmin()
	req := httptest.NewRequest(http.MethodGet, "/platform/engagement", nil)
	req = withAdminID(req, "test-admin-id")
	w := httptest.NewRecorder()
	h.PlatformEngagement(w, req)
	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d — body: %s", w.Code, w.Body.String())
	}
}

func TestPlatformKPIs_Forbidden(t *testing.T) {
	h := newTestHandlerWithSuperadmin()
	req := httptest.NewRequest(http.MethodGet, "/platform/kpis", nil)
	req = withAdminID(req, "test-admin-id")
	w := httptest.NewRecorder()
	h.PlatformKPIs(w, req)
	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d — body: %s", w.Code, w.Body.String())
	}
}

func TestPlatformEndpoints_NoSuperadminConfigured(t *testing.T) {
	// When SUPERADMIN_EMAIL is empty, all platform endpoints should return 403
	h := newTestHandler()
	endpoints := []struct {
		name    string
		handler http.HandlerFunc
	}{
		{"overview", h.PlatformOverview},
		{"growth", h.PlatformGrowth},
		{"admins", h.PlatformAdmins},
		{"ai-stats", h.PlatformAIStats},
		{"engagement", h.PlatformEngagement},
		{"kpis", h.PlatformKPIs},
	}

	for _, ep := range endpoints {
		t.Run(ep.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req = withAdminID(req, "test-admin-id")
			w := httptest.NewRecorder()
			ep.handler(w, req)
			if w.Code != http.StatusForbidden {
				t.Errorf("expected 403, got %d — body: %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestPlatformForbidden_ErrorFormat(t *testing.T) {
	h := newTestHandlerWithSuperadmin()
	req := httptest.NewRequest(http.MethodGet, "/platform/overview", nil)
	req = withAdminID(req, "test-admin-id")
	w := httptest.NewRecorder()
	h.PlatformOverview(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}

	var body map[string]string
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if body["error"] != "superadmin access required" {
		t.Errorf("unexpected error message: %s", body["error"])
	}
}

func TestPlatformResponseTypes_JSONShape(t *testing.T) {
	// Verify response types serialize to expected JSON keys
	tests := []struct {
		name string
		v    any
		keys []string
	}{
		{"overview", platformOverviewResponse{}, []string{
			"total_admins", "total_quizzes", "total_games",
			"total_players", "total_answers", "avg_players_per_game",
		}},
		{"growth point", platformGrowthPoint{}, []string{
			"date", "admins", "quizzes", "games",
		}},
		{"admin stats", platformAdminStats{}, []string{
			"id", "email", "quiz_count", "game_count",
			"player_count", "last_active", "created_at",
		}},
		{"ai stats", platformAIStatsResponse{}, []string{"total_quizzes"}},
		{"engagement", platformEngagementResponse{PeakHours: []peakHourBucket{}}, []string{
			"peak_hours", "avg_game_duration_seconds", "total_active_days",
		}},
		{"overview extended", platformOverviewResponse{}, []string{
			"avg_game_duration_seconds", "avg_questions_per_quiz",
			"game_completion_rate", "games_this_week", "games_last_week",
			"games_wow_change", "players_this_week", "players_last_week",
			"players_wow_change",
		}},
		{"funnel stage", funnelStage{}, []string{"label", "count", "pct"}},
		{"distribution bucket", distributionBucket{}, []string{"label", "count"}},
		{"kpi response", platformKPIResponse{
			Funnel:          []funnelStage{},
			PlayerCountDist: []distributionBucket{},
		}, []string{
			"funnel", "player_count_distribution",
			"admin_retention_7d", "admin_retention_30d",
		}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			data, err := json.Marshal(tc.v)
			if err != nil {
				t.Fatalf("marshal failed: %v", err)
			}
			var m map[string]any
			if err := json.Unmarshal(data, &m); err != nil {
				t.Fatalf("unmarshal failed: %v", err)
			}
			for _, key := range tc.keys {
				if _, ok := m[key]; !ok {
					t.Errorf("missing key %q in JSON output", key)
				}
			}
		})
	}
}
