package handlers

import (
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	appMiddleware "github.com/HassanA01/Hilal/backend/internal/middleware"
)

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

type overviewResponse struct {
	TotalQuizzes      int     `json:"total_quizzes"`
	TotalGames        int     `json:"total_games"`
	TotalPlayers      int     `json:"total_players"`
	TotalAnswers      int     `json:"total_answers"`
	AvgPlayersPerGame float64 `json:"avg_players_per_game"`
	AvgScore          float64 `json:"avg_score"`
}

type timeSeriesPoint struct {
	Date    string `json:"date"`
	Games   int    `json:"games"`
	Players int    `json:"players"`
}

type quizStatsResponse struct {
	ID            string  `json:"id"`
	Title         string  `json:"title"`
	Plays         int     `json:"plays"`
	AvgScore      float64 `json:"avg_score"`
	PlayerCount   int     `json:"player_count"`
	QuestionCount int     `json:"question_count"`
	CreatedAt     string  `json:"created_at"`
}

type optionDistribution struct {
	Text  string  `json:"text"`
	Count int     `json:"count"`
	Pct   float64 `json:"pct"`
}

type questionStatsResponse struct {
	ID           string               `json:"id"`
	Text         string               `json:"text"`
	Type         string               `json:"type"`
	Order        int                  `json:"order"`
	CorrectPct   float64              `json:"correct_pct"`
	AvgPoints    float64              `json:"avg_points"`
	TotalAnswers int                  `json:"total_answers"`
	Options      []optionDistribution `json:"options"`
}

type playerStatsResponse struct {
	Name        string  `json:"name"`
	TotalScore  int     `json:"total_score"`
	GamesPlayed int     `json:"games_played"`
	AvgScore    float64 `json:"avg_score"`
	AvgSpeedMs  float64 `json:"avg_speed_ms"`
}

type peakHourBucket struct {
	DayOfWeek int `json:"day_of_week"`
	Hour      int `json:"hour"`
	Count     int `json:"count"`
}

type engagementResponse struct {
	PeakHours       []peakHourBucket `json:"peak_hours"`
	AvgGameDuration float64          `json:"avg_game_duration_seconds"`
}

// ---------------------------------------------------------------------------
// 1. AnalyticsOverview — GET /analytics/overview
// ---------------------------------------------------------------------------

func (h *Handler) AnalyticsOverview(w http.ResponseWriter, r *http.Request) {
	adminID := appMiddleware.GetAdminID(r.Context())

	query := `
		WITH admin_quizzes AS (
			SELECT id FROM quizzes WHERE admin_id = $1
		),
		admin_sessions AS (
			SELECT gs.id
			FROM game_sessions gs
			JOIN admin_quizzes aq ON aq.id = gs.quiz_id
		),
		admin_players AS (
			SELECT gp.id, gp.score
			FROM game_players gp
			JOIN admin_sessions asess ON asess.id = gp.session_id
		),
		admin_answers AS (
			SELECT ga.id
			FROM game_answers ga
			JOIN admin_sessions asess ON asess.id = ga.session_id
		)
		SELECT
			(SELECT COUNT(*) FROM admin_quizzes),
			(SELECT COUNT(*) FROM admin_sessions),
			(SELECT COUNT(*) FROM admin_players),
			(SELECT COUNT(*) FROM admin_answers),
			COALESCE((SELECT COUNT(*)::float FROM admin_players) /
				NULLIF((SELECT COUNT(*) FROM admin_sessions), 0), 0),
			COALESCE((SELECT AVG(score)::float FROM admin_players), 0)
	`

	var resp overviewResponse
	err := h.db.QueryRow(r.Context(), query, adminID).Scan(
		&resp.TotalQuizzes,
		&resp.TotalGames,
		&resp.TotalPlayers,
		&resp.TotalAnswers,
		&resp.AvgPlayersPerGame,
		&resp.AvgScore,
	)
	if err != nil {
		slog.Error("analytics overview query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load analytics overview")
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

// ---------------------------------------------------------------------------
// 2. AnalyticsGamesOverTime — GET /analytics/games-over-time?period=day|week|month&range=7d|30d|90d|all
// ---------------------------------------------------------------------------

func (h *Handler) AnalyticsGamesOverTime(w http.ResponseWriter, r *http.Request) {
	adminID := appMiddleware.GetAdminID(r.Context())

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
		// "all" or anything else — no lower bound
		dateFilter = ""
	}

	query := `
		SELECT
			TO_CHAR(DATE_TRUNC('` + period + `', gs.created_at), 'YYYY-MM-DD') AS date,
			COUNT(DISTINCT gs.id) AS games,
			COUNT(DISTINCT gp.id) AS players
		FROM game_sessions gs
		JOIN quizzes q ON q.id = gs.quiz_id
		LEFT JOIN game_players gp ON gp.session_id = gs.id
		WHERE q.admin_id = $1
	`
	args := []any{adminID}

	if dateFilter != "" {
		query += ` AND gs.created_at >= $2`
		args = append(args, dateFilter)
	}

	query += `
		GROUP BY DATE_TRUNC('` + period + `', gs.created_at)
		ORDER BY date ASC
	`

	rows, err := h.db.Query(r.Context(), query, args...)
	if err != nil {
		slog.Error("analytics games-over-time query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load games over time")
		return
	}
	defer rows.Close()

	result := []timeSeriesPoint{}
	for rows.Next() {
		var p timeSeriesPoint
		if err := rows.Scan(&p.Date, &p.Games, &p.Players); err != nil {
			slog.Error("analytics games-over-time scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to read games over time")
			return
		}
		result = append(result, p)
	}
	if err := rows.Err(); err != nil {
		slog.Error("analytics games-over-time rows error", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to read games over time")
		return
	}

	writeJSON(w, http.StatusOK, result)
}

// ---------------------------------------------------------------------------
// 3. AnalyticsQuizzes — GET /analytics/quizzes?sort=plays|avg_score|completion&order=asc|desc
// ---------------------------------------------------------------------------

func (h *Handler) AnalyticsQuizzes(w http.ResponseWriter, r *http.Request) {
	adminID := appMiddleware.GetAdminID(r.Context())

	// Whitelist sort columns
	sortColumns := map[string]string{
		"plays":      "plays",
		"avg_score":  "avg_score",
		"completion": "plays", // alias — no explicit completion rate column
	}
	sortParam := r.URL.Query().Get("sort")
	sortCol, ok := sortColumns[sortParam]
	if !ok {
		sortCol = "plays"
	}

	orderParam := r.URL.Query().Get("order")
	if orderParam != "asc" {
		orderParam = "desc"
	}

	query := `
		SELECT
			q.id,
			q.title,
			COUNT(DISTINCT gs.id) AS plays,
			COALESCE(AVG(gp.score)::float, 0) AS avg_score,
			COUNT(DISTINCT gp.id) AS player_count,
			(SELECT COUNT(*) FROM questions WHERE quiz_id = q.id) AS question_count,
			TO_CHAR(q.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
		FROM quizzes q
		LEFT JOIN game_sessions gs ON gs.quiz_id = q.id
		LEFT JOIN game_players gp ON gp.session_id = gs.id
		WHERE q.admin_id = $1
		GROUP BY q.id, q.title, q.created_at
		ORDER BY ` + sortCol + ` ` + orderParam + `
	`

	rows, err := h.db.Query(r.Context(), query, adminID)
	if err != nil {
		slog.Error("analytics quizzes query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load quiz analytics")
		return
	}
	defer rows.Close()

	result := []quizStatsResponse{}
	for rows.Next() {
		var qs quizStatsResponse
		if err := rows.Scan(&qs.ID, &qs.Title, &qs.Plays, &qs.AvgScore,
			&qs.PlayerCount, &qs.QuestionCount, &qs.CreatedAt); err != nil {
			slog.Error("analytics quizzes scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to read quiz analytics")
			return
		}
		result = append(result, qs)
	}
	if err := rows.Err(); err != nil {
		slog.Error("analytics quizzes rows error", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to read quiz analytics")
		return
	}

	writeJSON(w, http.StatusOK, result)
}

// ---------------------------------------------------------------------------
// 4. AnalyticsQuizQuestions — GET /analytics/quizzes/{quizID}/questions
// ---------------------------------------------------------------------------

func (h *Handler) AnalyticsQuizQuestions(w http.ResponseWriter, r *http.Request) {
	adminID := appMiddleware.GetAdminID(r.Context())
	quizID := chi.URLParam(r, "quizID")

	// Verify quiz belongs to admin
	var exists bool
	err := h.db.QueryRow(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM quizzes WHERE id = $1 AND admin_id = $2)`,
		quizID, adminID,
	).Scan(&exists)
	if err != nil || !exists {
		writeError(w, http.StatusNotFound, "quiz not found")
		return
	}

	// Fetch questions with answer stats
	qRows, err := h.db.Query(r.Context(), `
		SELECT
			qu.id,
			qu.text,
			qu.type,
			qu."order",
			COALESCE(
				SUM(CASE WHEN ga.is_correct THEN 1 ELSE 0 END)::float /
				NULLIF(COUNT(ga.id), 0) * 100,
			0) AS correct_pct,
			COALESCE(AVG(ga.points)::float, 0) AS avg_points,
			COUNT(ga.id) AS total_answers
		FROM questions qu
		LEFT JOIN game_answers ga ON ga.question_id = qu.id
		WHERE qu.quiz_id = $1
		GROUP BY qu.id, qu.text, qu.type, qu."order"
		ORDER BY qu."order" ASC
	`, quizID)
	if err != nil {
		slog.Error("analytics quiz questions query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load question analytics")
		return
	}
	defer qRows.Close()

	result := []questionStatsResponse{}
	for qRows.Next() {
		var qs questionStatsResponse
		if err := qRows.Scan(&qs.ID, &qs.Text, &qs.Type, &qs.Order,
			&qs.CorrectPct, &qs.AvgPoints, &qs.TotalAnswers); err != nil {
			slog.Error("analytics quiz questions scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to read question analytics")
			return
		}

		// Fetch option distribution for this question
		optRows, err := h.db.Query(r.Context(), `
			SELECT
				o.text,
				COUNT(ga.id) AS count,
				COALESCE(
					COUNT(ga.id)::float /
					NULLIF((SELECT COUNT(*) FROM game_answers WHERE question_id = $1), 0) * 100,
				0) AS pct
			FROM options o
			LEFT JOIN game_answers ga ON ga.option_id = o.id AND ga.question_id = $1
			WHERE o.question_id = $1
			GROUP BY o.id, o.text, o.sort_order
			ORDER BY o.sort_order ASC
		`, qs.ID)
		if err != nil {
			slog.Error("analytics option distribution query failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to load option distribution")
			return
		}

		qs.Options = []optionDistribution{}
		for optRows.Next() {
			var od optionDistribution
			if err := optRows.Scan(&od.Text, &od.Count, &od.Pct); err != nil {
				optRows.Close()
				slog.Error("analytics option distribution scan failed", "error", err)
				writeError(w, http.StatusInternalServerError, "failed to read option distribution")
				return
			}
			qs.Options = append(qs.Options, od)
		}
		optRows.Close()
		if err := optRows.Err(); err != nil {
			slog.Error("analytics option distribution rows error", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to read option distribution")
			return
		}

		result = append(result, qs)
	}
	if err := qRows.Err(); err != nil {
		slog.Error("analytics quiz questions rows error", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to read question analytics")
		return
	}

	writeJSON(w, http.StatusOK, result)
}

// ---------------------------------------------------------------------------
// 5. AnalyticsTopPlayers — GET /analytics/players?sort=score|games|speed&limit=20
// ---------------------------------------------------------------------------

func (h *Handler) AnalyticsTopPlayers(w http.ResponseWriter, r *http.Request) {
	adminID := appMiddleware.GetAdminID(r.Context())

	// Whitelist sort columns
	sortColumns := map[string]string{
		"score": "total_score",
		"games": "games_played",
		"speed": "avg_speed_ms",
	}
	sortParam := r.URL.Query().Get("sort")
	sortCol, ok := sortColumns[sortParam]
	if !ok {
		sortCol = "total_score"
	}

	// Parse limit
	limit := 20
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	if limit > 100 {
		limit = 100
	}

	query := `
		SELECT
			gp.name,
			COALESCE(SUM(gp.score), 0) AS total_score,
			COUNT(DISTINCT gp.session_id) AS games_played,
			COALESCE(AVG(gp.score)::float, 0) AS avg_score,
			0::float AS avg_speed_ms
		FROM game_players gp
		JOIN game_sessions gs ON gs.id = gp.session_id
		JOIN quizzes q ON q.id = gs.quiz_id
		WHERE q.admin_id = $1
		GROUP BY gp.name
		ORDER BY ` + sortCol + ` DESC
		LIMIT $2
	`

	rows, err := h.db.Query(r.Context(), query, adminID, limit)
	if err != nil {
		slog.Error("analytics top players query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load player analytics")
		return
	}
	defer rows.Close()

	result := []playerStatsResponse{}
	for rows.Next() {
		var ps playerStatsResponse
		if err := rows.Scan(&ps.Name, &ps.TotalScore, &ps.GamesPlayed,
			&ps.AvgScore, &ps.AvgSpeedMs); err != nil {
			slog.Error("analytics top players scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to read player analytics")
			return
		}
		result = append(result, ps)
	}
	if err := rows.Err(); err != nil {
		slog.Error("analytics top players rows error", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to read player analytics")
		return
	}

	writeJSON(w, http.StatusOK, result)
}

// ---------------------------------------------------------------------------
// 6. AnalyticsEngagement — GET /analytics/engagement
// ---------------------------------------------------------------------------

func (h *Handler) AnalyticsEngagement(w http.ResponseWriter, r *http.Request) {
	adminID := appMiddleware.GetAdminID(r.Context())

	// Peak hours
	peakRows, err := h.db.Query(r.Context(), `
		SELECT
			EXTRACT(dow FROM gs.started_at)::int AS day_of_week,
			EXTRACT(hour FROM gs.started_at)::int AS hour,
			COUNT(*) AS count
		FROM game_sessions gs
		JOIN quizzes q ON q.id = gs.quiz_id
		WHERE q.admin_id = $1 AND gs.started_at IS NOT NULL
		GROUP BY day_of_week, hour
		ORDER BY count DESC
	`, adminID)
	if err != nil {
		slog.Error("analytics engagement peak hours query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load engagement analytics")
		return
	}
	defer peakRows.Close()

	peakHours := []peakHourBucket{}
	for peakRows.Next() {
		var b peakHourBucket
		if err := peakRows.Scan(&b.DayOfWeek, &b.Hour, &b.Count); err != nil {
			slog.Error("analytics engagement peak hours scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to read engagement analytics")
			return
		}
		peakHours = append(peakHours, b)
	}
	if err := peakRows.Err(); err != nil {
		slog.Error("analytics engagement peak hours rows error", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to read engagement analytics")
		return
	}

	// Avg game duration
	var avgDuration float64
	err = h.db.QueryRow(r.Context(), `
		SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (gs.ended_at - gs.started_at))), 0)
		FROM game_sessions gs
		JOIN quizzes q ON q.id = gs.quiz_id
		WHERE q.admin_id = $1 AND gs.started_at IS NOT NULL AND gs.ended_at IS NOT NULL
	`, adminID).Scan(&avgDuration)
	if err != nil {
		slog.Error("analytics engagement avg duration query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load engagement analytics")
		return
	}

	resp := engagementResponse{
		PeakHours:       peakHours,
		AvgGameDuration: avgDuration,
	}

	writeJSON(w, http.StatusOK, resp)
}
