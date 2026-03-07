package handlers

import (
	"context"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"time"

	appMiddleware "github.com/HassanA01/Hilal/backend/internal/middleware"
)

// ---------------------------------------------------------------------------
// Helper — superadmin check
// ---------------------------------------------------------------------------

func (h *Handler) isSuperAdmin(ctx context.Context) bool {
	adminID := appMiddleware.GetAdminID(ctx)
	if adminID == "" || h.config.SuperadminEmail == "" || h.db == nil {
		return false
	}
	var email string
	err := h.db.QueryRow(ctx, "SELECT email FROM admins WHERE id = $1", adminID).Scan(&email)
	if err != nil {
		return false
	}
	return strings.EqualFold(email, h.config.SuperadminEmail)
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

type platformOverviewResponse struct {
	TotalAdmins         int     `json:"total_admins"`
	TotalQuizzes        int     `json:"total_quizzes"`
	TotalGames          int     `json:"total_games"`
	TotalPlayers        int     `json:"total_players"`
	TotalAnswers        int     `json:"total_answers"`
	AvgPlayersPerGame   float64 `json:"avg_players_per_game"`
	AvgGameDurationSec  float64 `json:"avg_game_duration_seconds"`
	AvgQuestionsPerQuiz float64 `json:"avg_questions_per_quiz"`
	GameCompletionRate  float64 `json:"game_completion_rate"`
	GamesThisWeek       int     `json:"games_this_week"`
	GamesLastWeek       int     `json:"games_last_week"`
	GamesWoWChange      float64 `json:"games_wow_change"`
	PlayersThisWeek     int     `json:"players_this_week"`
	PlayersLastWeek     int     `json:"players_last_week"`
	PlayersWoWChange    float64 `json:"players_wow_change"`
}

type platformGrowthPoint struct {
	Date    string `json:"date"`
	Admins  int    `json:"admins"`
	Quizzes int    `json:"quizzes"`
	Games   int    `json:"games"`
}

type platformAdminStats struct {
	ID          string  `json:"id"`
	Email       string  `json:"email"`
	QuizCount   int     `json:"quiz_count"`
	GameCount   int     `json:"game_count"`
	PlayerCount int     `json:"player_count"`
	LastActive  *string `json:"last_active"`
	CreatedAt   string  `json:"created_at"`
}

type platformAIStatsResponse struct {
	TotalQuizzes int `json:"total_quizzes"`
}

type platformEngagementResponse struct {
	PeakHours       []peakHourBucket `json:"peak_hours"`
	AvgGameDuration float64          `json:"avg_game_duration_seconds"`
	TotalActiveDays int              `json:"total_active_days"`
}

type funnelStage struct {
	Label string  `json:"label"`
	Count int     `json:"count"`
	Pct   float64 `json:"pct"`
}

type distributionBucket struct {
	Label string `json:"label"`
	Count int    `json:"count"`
}

type platformKPIResponse struct {
	Funnel            []funnelStage        `json:"funnel"`
	PlayerCountDist   []distributionBucket `json:"player_count_distribution"`
	AdminRetention7d  float64              `json:"admin_retention_7d"`
	AdminRetention30d float64              `json:"admin_retention_30d"`
}

// ---------------------------------------------------------------------------
// 1. PlatformOverview — GET /platform/overview
// ---------------------------------------------------------------------------

func (h *Handler) PlatformOverview(w http.ResponseWriter, r *http.Request) {
	if !h.isSuperAdmin(r.Context()) {
		writeError(w, http.StatusForbidden, "superadmin access required")
		return
	}

	query := `
		SELECT
			(SELECT COUNT(*) FROM admins),
			(SELECT COUNT(*) FROM quizzes),
			(SELECT COUNT(*) FROM game_sessions),
			(SELECT COUNT(*) FROM game_players),
			(SELECT COUNT(*) FROM game_answers),
			COALESCE(
				(SELECT COUNT(*)::float FROM game_players) /
				NULLIF((SELECT COUNT(*) FROM game_sessions), 0),
			0)
	`

	var resp platformOverviewResponse
	err := h.db.QueryRow(r.Context(), query).Scan(
		&resp.TotalAdmins,
		&resp.TotalQuizzes,
		&resp.TotalGames,
		&resp.TotalPlayers,
		&resp.TotalAnswers,
		&resp.AvgPlayersPerGame,
	)
	if err != nil {
		slog.Error("platform overview query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load platform overview")
		return
	}

	// Avg game duration (non-fatal)
	if err := h.db.QueryRow(r.Context(), `
		SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (gs.ended_at - gs.started_at))), 0)
		FROM game_sessions gs
		WHERE gs.started_at IS NOT NULL AND gs.ended_at IS NOT NULL
	`).Scan(&resp.AvgGameDurationSec); err != nil {
		slog.Error("platform overview avg duration query failed", "error", err)
	}

	// Avg questions per quiz (non-fatal)
	if err := h.db.QueryRow(r.Context(), `
		SELECT COALESCE(AVG(qc.cnt)::float, 0)
		FROM (SELECT quiz_id, COUNT(*) AS cnt FROM questions GROUP BY quiz_id) qc
	`).Scan(&resp.AvgQuestionsPerQuiz); err != nil {
		slog.Error("platform overview avg questions query failed", "error", err)
	}

	// Game completion rate (finished / total where started) (non-fatal)
	var finished, started int
	if err := h.db.QueryRow(r.Context(), `SELECT COUNT(*) FROM game_sessions WHERE status = 'finished'`).Scan(&finished); err != nil {
		slog.Error("platform overview finished games query failed", "error", err)
	}
	if err := h.db.QueryRow(r.Context(), `SELECT COUNT(*) FROM game_sessions WHERE started_at IS NOT NULL`).Scan(&started); err != nil {
		slog.Error("platform overview started games query failed", "error", err)
	}
	if started > 0 {
		resp.GameCompletionRate = float64(finished) / float64(started)
	}

	// WoW stats (non-fatal)
	now := time.Now()
	thisWeekStart := now.AddDate(0, 0, -7)
	lastWeekStart := now.AddDate(0, 0, -14)

	if err := h.db.QueryRow(r.Context(), `SELECT COUNT(*) FROM game_sessions WHERE created_at >= $1`, thisWeekStart).Scan(&resp.GamesThisWeek); err != nil {
		slog.Error("platform overview games this week query failed", "error", err)
	}
	if err := h.db.QueryRow(r.Context(), `SELECT COUNT(*) FROM game_sessions WHERE created_at >= $1 AND created_at < $2`, lastWeekStart, thisWeekStart).Scan(&resp.GamesLastWeek); err != nil {
		slog.Error("platform overview games last week query failed", "error", err)
	}
	if resp.GamesLastWeek > 0 {
		resp.GamesWoWChange = (float64(resp.GamesThisWeek) - float64(resp.GamesLastWeek)) / float64(resp.GamesLastWeek) * 100
	}

	if err := h.db.QueryRow(r.Context(), `SELECT COUNT(*) FROM game_players gp JOIN game_sessions gs ON gs.id = gp.session_id WHERE gs.created_at >= $1`, thisWeekStart).Scan(&resp.PlayersThisWeek); err != nil {
		slog.Error("platform overview players this week query failed", "error", err)
	}
	if err := h.db.QueryRow(r.Context(), `SELECT COUNT(*) FROM game_players gp JOIN game_sessions gs ON gs.id = gp.session_id WHERE gs.created_at >= $1 AND gs.created_at < $2`, lastWeekStart, thisWeekStart).Scan(&resp.PlayersLastWeek); err != nil {
		slog.Error("platform overview players last week query failed", "error", err)
	}
	if resp.PlayersLastWeek > 0 {
		resp.PlayersWoWChange = (float64(resp.PlayersThisWeek) - float64(resp.PlayersLastWeek)) / float64(resp.PlayersLastWeek) * 100
	}

	writeJSON(w, http.StatusOK, resp)
}

// ---------------------------------------------------------------------------
// 2. PlatformGrowth — GET /platform/growth?period=day|week|month&range=7d|30d|90d|all
// ---------------------------------------------------------------------------

func (h *Handler) PlatformGrowth(w http.ResponseWriter, r *http.Request) {
	if !h.isSuperAdmin(r.Context()) {
		writeError(w, http.StatusForbidden, "superadmin access required")
		return
	}

	// Validate period
	period := r.URL.Query().Get("period")
	allowedPeriods := map[string]bool{"day": true, "week": true, "month": true}
	if !allowedPeriods[period] {
		period = "day"
	}

	// Parse range to a date filter
	rangeParam := r.URL.Query().Get("range")
	var dateFilter string
	switch rangeParam {
	case "7d":
		dateFilter = time.Now().AddDate(0, 0, -7).Format(time.RFC3339)
	case "30d":
		dateFilter = time.Now().AddDate(0, 0, -30).Format(time.RFC3339)
	case "90d":
		dateFilter = time.Now().AddDate(0, 0, -90).Format(time.RFC3339)
	default:
		dateFilter = ""
	}

	// Build date condition for each query
	dateCondition := ""
	if dateFilter != "" {
		dateCondition = " AND created_at >= '" + dateFilter + "'"
	}

	// Collect data points into a map keyed by date
	points := map[string]*platformGrowthPoint{}

	// --- Admins ---
	adminQuery := `
		SELECT TO_CHAR(DATE_TRUNC('` + period + `', created_at), 'YYYY-MM-DD') AS date,
		       COUNT(*) AS count
		FROM admins
		WHERE 1=1` + dateCondition + `
		GROUP BY DATE_TRUNC('` + period + `', created_at)
		ORDER BY date ASC
	`
	rows, err := h.db.Query(r.Context(), adminQuery)
	if err != nil {
		slog.Error("platform growth admins query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load platform growth")
		return
	}
	for rows.Next() {
		var date string
		var count int
		if err := rows.Scan(&date, &count); err != nil {
			rows.Close()
			slog.Error("platform growth admins scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to read platform growth")
			return
		}
		points[date] = &platformGrowthPoint{Date: date, Admins: count}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		slog.Error("platform growth admins rows error", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to read platform growth")
		return
	}

	// --- Quizzes ---
	quizQuery := `
		SELECT TO_CHAR(DATE_TRUNC('` + period + `', created_at), 'YYYY-MM-DD') AS date,
		       COUNT(*) AS count
		FROM quizzes
		WHERE 1=1` + dateCondition + `
		GROUP BY DATE_TRUNC('` + period + `', created_at)
		ORDER BY date ASC
	`
	rows, err = h.db.Query(r.Context(), quizQuery)
	if err != nil {
		slog.Error("platform growth quizzes query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load platform growth")
		return
	}
	for rows.Next() {
		var date string
		var count int
		if err := rows.Scan(&date, &count); err != nil {
			rows.Close()
			slog.Error("platform growth quizzes scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to read platform growth")
			return
		}
		if p, ok := points[date]; ok {
			p.Quizzes = count
		} else {
			points[date] = &platformGrowthPoint{Date: date, Quizzes: count}
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		slog.Error("platform growth quizzes rows error", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to read platform growth")
		return
	}

	// --- Games ---
	gameQuery := `
		SELECT TO_CHAR(DATE_TRUNC('` + period + `', created_at), 'YYYY-MM-DD') AS date,
		       COUNT(*) AS count
		FROM game_sessions
		WHERE 1=1` + dateCondition + `
		GROUP BY DATE_TRUNC('` + period + `', created_at)
		ORDER BY date ASC
	`
	rows, err = h.db.Query(r.Context(), gameQuery)
	if err != nil {
		slog.Error("platform growth games query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load platform growth")
		return
	}
	for rows.Next() {
		var date string
		var count int
		if err := rows.Scan(&date, &count); err != nil {
			rows.Close()
			slog.Error("platform growth games scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to read platform growth")
			return
		}
		if p, ok := points[date]; ok {
			p.Games = count
		} else {
			points[date] = &platformGrowthPoint{Date: date, Games: count}
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		slog.Error("platform growth games rows error", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to read platform growth")
		return
	}

	// Sort by date and return
	result := make([]platformGrowthPoint, 0, len(points))
	for _, p := range points {
		result = append(result, *p)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Date < result[j].Date
	})

	writeJSON(w, http.StatusOK, result)
}

// ---------------------------------------------------------------------------
// 3. PlatformAdmins — GET /platform/admins?sort=quizzes|games|last_active&order=asc|desc
// ---------------------------------------------------------------------------

func (h *Handler) PlatformAdmins(w http.ResponseWriter, r *http.Request) {
	if !h.isSuperAdmin(r.Context()) {
		writeError(w, http.StatusForbidden, "superadmin access required")
		return
	}

	// Whitelist sort columns
	sortColumns := map[string]string{
		"quizzes":     "quiz_count",
		"games":       "game_count",
		"last_active": "last_active",
	}
	sortParam := r.URL.Query().Get("sort")
	sortCol, ok := sortColumns[sortParam]
	if !ok {
		sortCol = "quiz_count"
	}

	orderParam := r.URL.Query().Get("order")
	if orderParam != "asc" {
		orderParam = "desc"
	}

	// Handle NULLS for last_active sorting
	nullsOrder := "NULLS LAST"
	if orderParam == "asc" {
		nullsOrder = "NULLS FIRST"
	}

	query := `
		SELECT
			a.id,
			a.email,
			COALESCE(q_counts.quiz_count, 0) AS quiz_count,
			COALESCE(g_counts.game_count, 0) AS game_count,
			COALESCE(p_counts.player_count, 0) AS player_count,
			GREATEST(q_counts.last_quiz, g_counts.last_game) AS last_active,
			TO_CHAR(a.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
		FROM admins a
		LEFT JOIN (
			SELECT admin_id, COUNT(*) AS quiz_count,
			       MAX(created_at) AS last_quiz
			FROM quizzes GROUP BY admin_id
		) q_counts ON q_counts.admin_id = a.id
		LEFT JOIN (
			SELECT q.admin_id, COUNT(DISTINCT gs.id) AS game_count,
			       MAX(gs.created_at) AS last_game
			FROM game_sessions gs
			JOIN quizzes q ON q.id = gs.quiz_id
			GROUP BY q.admin_id
		) g_counts ON g_counts.admin_id = a.id
		LEFT JOIN (
			SELECT q.admin_id, COUNT(DISTINCT gp.id) AS player_count
			FROM game_players gp
			JOIN game_sessions gs ON gs.id = gp.session_id
			JOIN quizzes q ON q.id = gs.quiz_id
			GROUP BY q.admin_id
		) p_counts ON p_counts.admin_id = a.id
		ORDER BY ` + sortCol + ` ` + orderParam + ` ` + nullsOrder + `
	`

	rows, err := h.db.Query(r.Context(), query)
	if err != nil {
		slog.Error("platform admins query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load platform admins")
		return
	}
	defer rows.Close()

	result := []platformAdminStats{}
	for rows.Next() {
		var as platformAdminStats
		var lastActive *time.Time
		if err := rows.Scan(&as.ID, &as.Email, &as.QuizCount, &as.GameCount,
			&as.PlayerCount, &lastActive, &as.CreatedAt); err != nil {
			slog.Error("platform admins scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to read platform admins")
			return
		}
		if lastActive != nil {
			formatted := lastActive.Format("2006-01-02T15:04:05Z")
			as.LastActive = &formatted
		}
		result = append(result, as)
	}
	if err := rows.Err(); err != nil {
		slog.Error("platform admins rows error", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to read platform admins")
		return
	}

	writeJSON(w, http.StatusOK, result)
}

// ---------------------------------------------------------------------------
// 4. PlatformAIStats — GET /platform/ai-stats
// ---------------------------------------------------------------------------

func (h *Handler) PlatformAIStats(w http.ResponseWriter, r *http.Request) {
	if !h.isSuperAdmin(r.Context()) {
		writeError(w, http.StatusForbidden, "superadmin access required")
		return
	}

	var totalQuizzes int
	err := h.db.QueryRow(r.Context(), "SELECT COUNT(*) FROM quizzes").Scan(&totalQuizzes)
	if err != nil {
		slog.Error("platform ai stats query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load platform AI stats")
		return
	}

	// Placeholder: we don't yet distinguish AI vs manual quizzes.
	// Enhance when an ai_generated column is added.
	writeJSON(w, http.StatusOK, platformAIStatsResponse{TotalQuizzes: totalQuizzes})
}

// ---------------------------------------------------------------------------
// 5. PlatformEngagement — GET /platform/engagement
// ---------------------------------------------------------------------------

func (h *Handler) PlatformEngagement(w http.ResponseWriter, r *http.Request) {
	if !h.isSuperAdmin(r.Context()) {
		writeError(w, http.StatusForbidden, "superadmin access required")
		return
	}

	// Peak hours (platform-wide, no admin_id filter)
	peakRows, err := h.db.Query(r.Context(), `
		SELECT
			EXTRACT(dow FROM gs.started_at)::int AS day_of_week,
			EXTRACT(hour FROM gs.started_at)::int AS hour,
			COUNT(*) AS count
		FROM game_sessions gs
		WHERE gs.started_at IS NOT NULL
		GROUP BY day_of_week, hour
		ORDER BY count DESC
	`)
	if err != nil {
		slog.Error("platform engagement peak hours query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load platform engagement")
		return
	}
	defer peakRows.Close()

	peakHours := []peakHourBucket{}
	for peakRows.Next() {
		var b peakHourBucket
		if err := peakRows.Scan(&b.DayOfWeek, &b.Hour, &b.Count); err != nil {
			slog.Error("platform engagement peak hours scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to read platform engagement")
			return
		}
		peakHours = append(peakHours, b)
	}
	if err := peakRows.Err(); err != nil {
		slog.Error("platform engagement peak hours rows error", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to read platform engagement")
		return
	}

	// Avg game duration (platform-wide)
	var avgDuration float64
	err = h.db.QueryRow(r.Context(), `
		SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (gs.ended_at - gs.started_at))), 0)
		FROM game_sessions gs
		WHERE gs.started_at IS NOT NULL AND gs.ended_at IS NOT NULL
	`).Scan(&avgDuration)
	if err != nil {
		slog.Error("platform engagement avg duration query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load platform engagement")
		return
	}

	// Total active days (platform-wide)
	var totalActiveDays int
	err = h.db.QueryRow(r.Context(), `
		SELECT COUNT(DISTINCT DATE(gs.created_at))
		FROM game_sessions gs
	`).Scan(&totalActiveDays)
	if err != nil {
		slog.Error("platform engagement active days query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load platform engagement")
		return
	}

	resp := platformEngagementResponse{
		PeakHours:       peakHours,
		AvgGameDuration: avgDuration,
		TotalActiveDays: totalActiveDays,
	}

	writeJSON(w, http.StatusOK, resp)
}

// ---------------------------------------------------------------------------
// 6. PlatformKPIs — GET /platform/kpis
// ---------------------------------------------------------------------------

func (h *Handler) PlatformKPIs(w http.ResponseWriter, r *http.Request) {
	if !h.isSuperAdmin(r.Context()) {
		writeError(w, http.StatusForbidden, "superadmin access required")
		return
	}

	var resp platformKPIResponse

	// --- Conversion Funnel ---
	var totalAdmins, adminsWithQuiz, adminsWithGame, adminsWithPlayers int

	if err := h.db.QueryRow(r.Context(), "SELECT COUNT(*) FROM admins").Scan(&totalAdmins); err != nil {
		slog.Error("platform funnel: count admins", "error", err)
	}
	if err := h.db.QueryRow(r.Context(), "SELECT COUNT(DISTINCT admin_id) FROM quizzes").Scan(&adminsWithQuiz); err != nil {
		slog.Error("platform funnel: admins with quiz", "error", err)
	}
	if err := h.db.QueryRow(r.Context(), `
		SELECT COUNT(DISTINCT q.admin_id)
		FROM game_sessions gs JOIN quizzes q ON q.id = gs.quiz_id
	`).Scan(&adminsWithGame); err != nil {
		slog.Error("platform funnel: admins with game", "error", err)
	}
	if err := h.db.QueryRow(r.Context(), `
		SELECT COUNT(DISTINCT q.admin_id)
		FROM game_sessions gs
		JOIN quizzes q ON q.id = gs.quiz_id
		WHERE (SELECT COUNT(*) FROM game_players gp WHERE gp.session_id = gs.id) >= 2
	`).Scan(&adminsWithPlayers); err != nil {
		slog.Error("platform funnel: admins with players", "error", err)
	}

	pct := func(n, total int) float64 {
		if total == 0 {
			return 0
		}
		return float64(n) / float64(total) * 100
	}

	resp.Funnel = []funnelStage{
		{Label: "Signed Up", Count: totalAdmins, Pct: 100},
		{Label: "Created Quiz", Count: adminsWithQuiz, Pct: pct(adminsWithQuiz, totalAdmins)},
		{Label: "Hosted Game", Count: adminsWithGame, Pct: pct(adminsWithGame, totalAdmins)},
		{Label: "Got 2+ Players", Count: adminsWithPlayers, Pct: pct(adminsWithPlayers, totalAdmins)},
	}

	// --- Player Count Distribution ---
	// Buckets: 1, 2-3, 4-6, 7-10, 10+
	distQuery := `
		SELECT
			CASE
				WHEN pc = 1 THEN '1'
				WHEN pc BETWEEN 2 AND 3 THEN '2-3'
				WHEN pc BETWEEN 4 AND 6 THEN '4-6'
				WHEN pc BETWEEN 7 AND 10 THEN '7-10'
				ELSE '10+'
			END AS bucket,
			COUNT(*) AS cnt
		FROM (
			SELECT gs.id, COUNT(gp.id) AS pc
			FROM game_sessions gs
			LEFT JOIN game_players gp ON gp.session_id = gs.id
			GROUP BY gs.id
		) sub
		GROUP BY bucket
		ORDER BY MIN(pc)
	`
	rows, err := h.db.Query(r.Context(), distQuery)
	if err != nil {
		slog.Error("platform kpis distribution query failed", "error", err)
		resp.PlayerCountDist = []distributionBucket{}
	} else {
		resp.PlayerCountDist = []distributionBucket{}
		for rows.Next() {
			var b distributionBucket
			if err := rows.Scan(&b.Label, &b.Count); err != nil {
				break
			}
			resp.PlayerCountDist = append(resp.PlayerCountDist, b)
		}
		rows.Close()
	}

	// --- Admin Retention ---
	now := time.Now()

	// Active in last 7 days = hosted a game or created a quiz
	var active7d int
	if err := h.db.QueryRow(r.Context(), `
		SELECT COUNT(DISTINCT a.id) FROM admins a
		WHERE EXISTS (
			SELECT 1 FROM quizzes q
			JOIN game_sessions gs ON gs.quiz_id = q.id
			WHERE q.admin_id = a.id AND gs.created_at >= $1
		)
	`, now.AddDate(0, 0, -7)).Scan(&active7d); err != nil {
		slog.Error("platform kpis: 7d retention query", "error", err)
	}
	if totalAdmins > 0 {
		resp.AdminRetention7d = float64(active7d) / float64(totalAdmins) * 100
	}

	var active30d int
	if err := h.db.QueryRow(r.Context(), `
		SELECT COUNT(DISTINCT a.id) FROM admins a
		WHERE EXISTS (
			SELECT 1 FROM quizzes q
			JOIN game_sessions gs ON gs.quiz_id = q.id
			WHERE q.admin_id = a.id AND gs.created_at >= $1
		)
	`, now.AddDate(0, 0, -30)).Scan(&active30d); err != nil {
		slog.Error("platform kpis: 30d retention query", "error", err)
	}
	if totalAdmins > 0 {
		resp.AdminRetention30d = float64(active30d) / float64(totalAdmins) * 100
	}

	writeJSON(w, http.StatusOK, resp)
}
