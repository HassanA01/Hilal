package game

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/HassanA01/Hilal/backend/internal/hub"
	"github.com/HassanA01/Hilal/backend/internal/metrics"
	"github.com/HassanA01/Hilal/backend/internal/models"
)

// GamePhase represents the current phase of the game.
type GamePhase string

const (
	PhaseStarting    GamePhase = "starting"      // post-start, waiting for host to reconnect
	PhaseQuestion    GamePhase = "question_open" // question active, accepting answers
	PhaseReveal      GamePhase = "answer_reveal" // showing correct answer
	PhaseLeaderboard GamePhase = "leaderboard"   // leaderboard between questions
	PhaseGameOver    GamePhase = "game_over"     // final podium
)

// GameState is persisted in Redis for session recovery.
type GameState struct {
	SessionCode     string    `json:"session_code"`
	SessionID       string    `json:"session_id"`
	CurrentIndex    int       `json:"current_index"`
	TotalQuestions  int       `json:"total_questions"`
	Phase           GamePhase `json:"phase"`
	QuestionStarted time.Time `json:"question_started"`
}

// storedQuestion is the full question (including correct answers) cached in Redis.
type storedQuestion struct {
	ID        string         `json:"id"`
	Text      string         `json:"text"`
	Type      string         `json:"type"`
	TimeLimit int            `json:"time_limit"`
	Order     int            `json:"order"`
	ImageURL  string         `json:"image_url,omitempty"`
	Options   []storedOption `json:"options"`
}

type storedOption struct {
	ID        string `json:"id"`
	Text      string `json:"text"`
	IsCorrect bool   `json:"is_correct"`
	ImageURL  string `json:"image_url,omitempty"`
	SortOrder int    `json:"sort_order"`
}

// playerAnswer tracks a single player's answer in Redis.
type playerAnswer struct {
	OptionID   string    `json:"option_id,omitempty"`
	OptionIDs  []string  `json:"option_ids,omitempty"` // for ordering questions
	AnsweredAt time.Time `json:"answered_at"`
}

// revealScoreEntry is the per-player score included in answer_reveal.
type revealScoreEntry struct {
	IsCorrect  bool `json:"is_correct"`
	Points     int  `json:"points"`
	TotalScore int  `json:"total_score"`
}

// Engine orchestrates the game loop: question broadcast, answer collection, reveal, leaderboard.
type Engine struct {
	hub    *hub.Hub
	db     *pgxpool.Pool
	redis  *redis.Client
	mu     sync.Mutex
	timers map[string]chan struct{} // sessionCode -> cancel channel
}

// New creates a new Engine.
func NewEngine(h *hub.Hub, db *pgxpool.Pool, redisClient *redis.Client) *Engine {
	return &Engine{
		hub:    h,
		db:     db,
		redis:  redisClient,
		timers: make(map[string]chan struct{}),
	}
}

// redisKeyState returns the Redis key for game state.
func redisKeyState(code string) string { return fmt.Sprintf("game:%s:state", code) }

// redisKeyQuestions returns the Redis key for cached questions.
func redisKeyQuestions(code string) string { return fmt.Sprintf("game:%s:questions", code) }

// redisKeyAnswers returns the Redis key for answers for a question index.
func redisKeyAnswers(code string, idx int) string {
	return fmt.Sprintf("game:%s:q%d:answers", code, idx)
}

// StartGame loads questions from DB, stores them in Redis, and starts a 3-second
// countdown before broadcasting the first question. This gives clients time to
// navigate from the lobby to the game page.
func (e *Engine) StartGame(ctx context.Context, sessionCode, sessionID, quizID string) error {
	questions, err := e.loadQuestions(ctx, quizID)
	if err != nil {
		return fmt.Errorf("load questions: %w", err)
	}
	if len(questions) == 0 {
		return fmt.Errorf("quiz has no questions")
	}

	// Cache questions in Redis (TTL 24h).
	data, err := json.Marshal(questions)
	if err != nil {
		return err
	}
	if err := e.redis.Set(ctx, redisKeyQuestions(sessionCode), data, 24*time.Hour).Err(); err != nil {
		return err
	}

	state := &GameState{
		SessionCode:    sessionCode,
		SessionID:      sessionID,
		CurrentIndex:   0,
		TotalQuestions: len(questions),
		Phase:          PhaseStarting,
	}
	if err := e.saveState(ctx, sessionCode, state); err != nil {
		return err
	}

	// Broadcast first question after a short delay so clients can navigate.
	go func() {
		time.Sleep(3 * time.Second)
		bgCtx := context.Background()
		if err := e.broadcastQuestion(bgCtx, sessionCode, 0); err != nil {
			slog.Error("engine: broadcastQuestion failed", "error", err, "session", sessionCode)
		}
	}()

	return nil
}

// GetCurrentState retrieves the current GameState from Redis.
func (e *Engine) GetCurrentState(ctx context.Context, sessionCode string) (*GameState, error) {
	return e.loadState(ctx, sessionCode)
}

// GetCurrentQuestion returns the question at the current index for sending to a late-joining client.
func (e *Engine) GetCurrentQuestion(ctx context.Context, sessionCode string) (*hub.Message, error) {
	state, err := e.loadState(ctx, sessionCode)
	if err != nil {
		return nil, err
	}
	if state.Phase != PhaseQuestion {
		return nil, nil
	}
	questions, err := e.loadCachedQuestions(ctx, sessionCode)
	if err != nil {
		return nil, err
	}
	q := questions[state.CurrentIndex]
	msg := hub.Message{
		Type:    hub.MsgQuestion,
		Payload: buildQuestionPayload(q, state.CurrentIndex, state.TotalQuestions),
	}
	return &msg, nil
}

// SubmitAnswer records a player's answer and triggers reveal if all players have answered.
func (e *Engine) SubmitAnswer(ctx context.Context, sessionCode, playerID, questionIDStr, optionIDStr string) error {
	state, err := e.loadState(ctx, sessionCode)
	if err != nil {
		return fmt.Errorf("load state: %w", err)
	}
	if state.Phase != PhaseQuestion {
		return fmt.Errorf("not in question phase (current: %s)", state.Phase)
	}

	questions, err := e.loadCachedQuestions(ctx, sessionCode)
	if err != nil {
		return err
	}
	q := questions[state.CurrentIndex]
	if q.ID != questionIDStr {
		return fmt.Errorf("question_id mismatch")
	}

	// Store answer in Redis (idempotent — first answer wins).
	answerKey := redisKeyAnswers(sessionCode, state.CurrentIndex)
	existing, err := e.redis.HGet(ctx, answerKey, playerID).Result()
	if err == nil && existing != "" {
		return nil // already answered
	}

	now := time.Now()
	metrics.RecordAnswerLatency(now.Sub(state.QuestionStarted))

	ans := playerAnswer{
		OptionID:   optionIDStr,
		AnsweredAt: now,
	}
	ansData, _ := json.Marshal(ans)
	e.redis.HSet(ctx, answerKey, playerID, string(ansData))
	e.redis.Expire(ctx, answerKey, 24*time.Hour)

	// Check if all connected players have answered.
	playerCount := e.hub.RoomPlayerCount(sessionCode)
	answeredCount, _ := e.redis.HLen(ctx, answerKey).Result()

	// Notify the host of the updated answer tally.
	e.hub.BroadcastToHost(sessionCode, hub.Message{
		Type: hub.MsgAnswerCount,
		Payload: map[string]any{
			"answered": int(answeredCount),
			"total":    playerCount,
		},
	})

	if playerCount > 0 && int(answeredCount) >= playerCount {
		// Cancel the timer and reveal immediately.
		e.cancelTimer(sessionCode)
		go func() {
			bgCtx := context.Background()
			if err := e.triggerReveal(bgCtx, sessionCode); err != nil {
				slog.Error("engine: triggerReveal failed", "error", err, "session", sessionCode)
			}
		}()
	}

	return nil
}

// SubmitOrderingAnswer records a player's ordering answer.
func (e *Engine) SubmitOrderingAnswer(ctx context.Context, sessionCode, playerID, questionIDStr string, optionIDs []string) error {
	state, err := e.loadState(ctx, sessionCode)
	if err != nil {
		return fmt.Errorf("load state: %w", err)
	}
	if state.Phase != PhaseQuestion {
		return fmt.Errorf("not in question phase (current: %s)", state.Phase)
	}

	questions, err := e.loadCachedQuestions(ctx, sessionCode)
	if err != nil {
		return err
	}
	q := questions[state.CurrentIndex]
	if q.ID != questionIDStr {
		return fmt.Errorf("question_id mismatch")
	}

	// Store answer in Redis (idempotent — first answer wins).
	answerKey := redisKeyAnswers(sessionCode, state.CurrentIndex)
	existing, err := e.redis.HGet(ctx, answerKey, playerID).Result()
	if err == nil && existing != "" {
		return nil // already answered
	}

	now := time.Now()
	metrics.RecordAnswerLatency(now.Sub(state.QuestionStarted))

	ans := playerAnswer{
		OptionIDs:  optionIDs,
		AnsweredAt: now,
	}
	ansData, _ := json.Marshal(ans)
	e.redis.HSet(ctx, answerKey, playerID, string(ansData))
	e.redis.Expire(ctx, answerKey, 24*time.Hour)

	// Check if all connected players have answered.
	playerCount := e.hub.RoomPlayerCount(sessionCode)
	answeredCount, _ := e.redis.HLen(ctx, answerKey).Result()

	e.hub.BroadcastToHost(sessionCode, hub.Message{
		Type: hub.MsgAnswerCount,
		Payload: map[string]any{
			"answered": int(answeredCount),
			"total":    playerCount,
		},
	})

	if playerCount > 0 && int(answeredCount) >= playerCount {
		e.cancelTimer(sessionCode)
		go func() {
			bgCtx := context.Background()
			if err := e.triggerReveal(bgCtx, sessionCode); err != nil {
				slog.Error("engine: triggerReveal failed", "error", err, "session", sessionCode)
			}
		}()
	}

	return nil
}

// NextQuestion advances the game to the next question or to game_over.
// Called by the host from the leaderboard screen.
func (e *Engine) NextQuestion(ctx context.Context, sessionCode string) error {
	state, err := e.loadState(ctx, sessionCode)
	if err != nil {
		return err
	}
	if state.Phase != PhaseLeaderboard {
		return fmt.Errorf("can only advance from leaderboard phase (current: %s)", state.Phase)
	}

	next := state.CurrentIndex + 1
	if next >= state.TotalQuestions {
		return e.triggerGameOver(ctx, sessionCode)
	}
	return e.broadcastQuestion(ctx, sessionCode, next)
}

// broadcastQuestion sends the question at idx to all clients and starts the timer.
func (e *Engine) broadcastQuestion(ctx context.Context, sessionCode string, idx int) error {
	questions, err := e.loadCachedQuestions(ctx, sessionCode)
	if err != nil {
		return err
	}
	q := questions[idx]

	state, err := e.loadState(ctx, sessionCode)
	if err != nil {
		return err
	}
	state.CurrentIndex = idx
	state.Phase = PhaseQuestion
	state.QuestionStarted = time.Now()
	if err := e.saveState(ctx, sessionCode, state); err != nil {
		return err
	}

	// Players receive the question without is_correct; host receives it with is_correct.
	e.hub.BroadcastToPlayers(sessionCode, hub.Message{
		Type:    hub.MsgQuestion,
		Payload: buildQuestionPayload(q, idx, state.TotalQuestions),
	})
	e.hub.BroadcastToHost(sessionCode, hub.Message{
		Type:    hub.MsgQuestion,
		Payload: BuildHostQuestionPayload(q, idx, state.TotalQuestions),
	})

	// Tell host the initial answered count (0 / N players).
	playerCount := e.hub.RoomPlayerCount(sessionCode)
	e.hub.BroadcastToHost(sessionCode, hub.Message{
		Type: hub.MsgAnswerCount,
		Payload: map[string]any{
			"answered": 0,
			"total":    playerCount,
		},
	})

	// Start question timer.
	timeLimit := time.Duration(q.TimeLimit) * time.Second
	cancel := make(chan struct{})
	e.mu.Lock()
	// Cancel any existing timer.
	if old, ok := e.timers[sessionCode]; ok {
		close(old)
	}
	e.timers[sessionCode] = cancel
	e.mu.Unlock()

	go func(code string, questionIdx int, cancelCh chan struct{}) {
		select {
		case <-time.After(timeLimit):
			// Verify state is still this question before triggering.
			bgCtx := context.Background()
			st, err := e.loadState(bgCtx, code)
			if err != nil || st.CurrentIndex != questionIdx || st.Phase != PhaseQuestion {
				return
			}
			if err := e.triggerReveal(bgCtx, code); err != nil {
				slog.Error("engine: timer reveal failed", "error", err, "session", code)
			}
		case <-cancelCh:
			// Cancelled by SubmitAnswer (all answered) or NextQuestion.
		}
	}(sessionCode, idx, cancel)

	return nil
}

// triggerReveal broadcasts the correct answer, computes scores, persists to DB.
func (e *Engine) triggerReveal(ctx context.Context, sessionCode string) error {
	state, err := e.loadState(ctx, sessionCode)
	if err != nil {
		return err
	}
	if state.Phase != PhaseQuestion {
		return nil // already revealed
	}

	state.Phase = PhaseReveal
	if err := e.saveState(ctx, sessionCode, state); err != nil {
		return err
	}

	questions, err := e.loadCachedQuestions(ctx, sessionCode)
	if err != nil {
		return err
	}
	q := questions[state.CurrentIndex]

	isOrdering := q.Type == string(models.QTypeOrdering)
	isMultiSelect := q.Type == string(models.QTypeMultiSelect)

	// Collect correct option IDs / ordering.
	var correctOptionIDs []string
	var correctOrder []string
	if isOrdering {
		for _, opt := range q.Options {
			correctOrder = append(correctOrder, opt.ID)
		}
	} else {
		for _, opt := range q.Options {
			if opt.IsCorrect {
				correctOptionIDs = append(correctOptionIDs, opt.ID)
			}
		}
	}

	// Load answers from Redis.
	answerKey := redisKeyAnswers(sessionCode, state.CurrentIndex)
	rawAnswers, _ := e.redis.HGetAll(ctx, answerKey).Result()

	scores := make(map[string]revealScoreEntry)
	for playerID, rawAns := range rawAnswers {
		var ans playerAnswer
		if err := json.Unmarshal([]byte(rawAns), &ans); err != nil {
			continue
		}

		var isCorrect bool
		var points int

		if isOrdering {
			// Ordering: partial credit based on correct positions.
			correctPositions := CountCorrectPositions(ans.OptionIDs, correctOrder)
			isCorrect = correctPositions == len(correctOrder)
			elapsed := ans.AnsweredAt.Sub(state.QuestionStarted).Seconds()
			points = CalculateOrderingPoints(correctPositions, len(correctOrder), elapsed, q.TimeLimit)
		} else if isMultiSelect {
			// Multi-select: exact set match required.
			isCorrect = sameStringSet(ans.OptionIDs, correctOptionIDs)
			if isCorrect {
				elapsed := ans.AnsweredAt.Sub(state.QuestionStarted).Seconds()
				points = CalculatePoints(elapsed, q.TimeLimit)
			}
		} else {
			// MC / TF / Image: correct if pick is any of the correct options.
			for _, cid := range correctOptionIDs {
				if ans.OptionID == cid {
					isCorrect = true
					break
				}
			}
			if isCorrect {
				elapsed := ans.AnsweredAt.Sub(state.QuestionStarted).Seconds()
				points = CalculatePoints(elapsed, q.TimeLimit)
			}
		}

		// Persist to DB.
		playerUUID, err := uuid.Parse(playerID)
		if err != nil {
			continue
		}
		questionUUID, err := uuid.Parse(q.ID)
		if err != nil {
			continue
		}
		sessionUUID, err := uuid.Parse(state.SessionID)
		if err != nil {
			continue
		}

		if isOrdering || isMultiSelect {
			answerDataJSON, _ := json.Marshal(ans.OptionIDs)
			_, dbErr := e.db.Exec(ctx,
				`INSERT INTO game_answers (id, session_id, player_id, question_id, option_id, answer_data, answered_at, is_correct, points)
				 VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8)
				 ON CONFLICT (session_id, player_id, question_id) DO NOTHING`,
				uuid.New(), sessionUUID, playerUUID, questionUUID, answerDataJSON,
				ans.AnsweredAt, isCorrect, points,
			)
			if dbErr != nil {
				slog.Error("engine: insert multi-option answer failed", "error", dbErr, "session", sessionCode, "player", playerID)
			}
		} else {
			optionUUID, err := uuid.Parse(ans.OptionID)
			if err != nil {
				continue
			}
			_, dbErr := e.db.Exec(ctx,
				`INSERT INTO game_answers (id, session_id, player_id, question_id, option_id, answered_at, is_correct, points)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
				 ON CONFLICT (session_id, player_id, question_id) DO NOTHING`,
				uuid.New(), sessionUUID, playerUUID, questionUUID, optionUUID,
				ans.AnsweredAt, isCorrect, points,
			)
			if dbErr != nil {
				slog.Error("engine: insert answer failed", "error", dbErr, "session", sessionCode, "player", playerID)
			}
		}

		if points > 0 {
			_, _ = e.db.Exec(ctx,
				`UPDATE game_players SET score = score + $1 WHERE id = $2`,
				points, playerUUID,
			)
		}

		// Get total score for this player.
		var totalScore int
		_ = e.db.QueryRow(ctx,
			`SELECT score FROM game_players WHERE id = $1`, playerUUID,
		).Scan(&totalScore)

		scores[playerID] = revealScoreEntry{
			IsCorrect:  isCorrect,
			Points:     points,
			TotalScore: totalScore,
		}
	}

	revealPayload := map[string]any{
		"scores": scores,
	}
	if isOrdering {
		revealPayload["correct_order"] = correctOrder
	} else if len(correctOptionIDs) == 1 {
		revealPayload["correct_option_id"] = correctOptionIDs[0]
	} else {
		// Multiple correct options — send both for backward compat.
		revealPayload["correct_option_id"] = correctOptionIDs[0]
		revealPayload["correct_option_ids"] = correctOptionIDs
	}

	e.hub.Broadcast(sessionCode, hub.Message{
		Type:    hub.MsgAnswerReveal,
		Payload: revealPayload,
	})

	// Auto-advance to leaderboard after 3 seconds.
	go func() {
		time.Sleep(3 * time.Second)
		bgCtx := context.Background()
		if err := e.broadcastLeaderboard(bgCtx, sessionCode); err != nil {
			slog.Error("engine: broadcastLeaderboard failed", "error", err, "session", sessionCode)
		}
	}()

	return nil
}

// broadcastLeaderboard sends the current leaderboard to all clients.
func (e *Engine) broadcastLeaderboard(ctx context.Context, sessionCode string) error {
	state, err := e.loadState(ctx, sessionCode)
	if err != nil {
		return err
	}
	state.Phase = PhaseLeaderboard
	if err := e.saveState(ctx, sessionCode, state); err != nil {
		return err
	}

	entries, err := e.getLeaderboard(ctx, state.SessionID)
	if err != nil {
		return err
	}

	e.hub.Broadcast(sessionCode, hub.Message{
		Type:    hub.MsgLeaderboard,
		Payload: map[string]any{"entries": entries},
	})
	return nil
}

// triggerGameOver broadcasts the final podium.
func (e *Engine) triggerGameOver(ctx context.Context, sessionCode string) error {
	state, err := e.loadState(ctx, sessionCode)
	if err != nil {
		return err
	}
	state.Phase = PhaseGameOver
	if err := e.saveState(ctx, sessionCode, state); err != nil {
		return err
	}

	// Update DB session status to finished.
	_, _ = e.db.Exec(ctx,
		`UPDATE game_sessions SET status = 'finished', ended_at = NOW() WHERE code = $1`,
		sessionCode,
	)

	entries, err := e.getLeaderboard(ctx, state.SessionID)
	if err != nil {
		return err
	}

	e.hub.Broadcast(sessionCode, hub.Message{
		Type:    hub.MsgPodium,
		Payload: map[string]any{"entries": entries},
	})
	return nil
}

// EndGame forcefully ends the game (e.g. host ended session early).
// Broadcasts game_over with reason="session_ended" and cleans up Redis.
func (e *Engine) EndGame(ctx context.Context, sessionCode string) {
	e.cancelTimer(sessionCode)

	e.hub.Broadcast(sessionCode, hub.Message{
		Type: hub.MsgGameOver,
		Payload: map[string]any{
			"reason": "session_ended",
		},
	})

	// Clean up Redis keys.
	state, err := e.loadState(ctx, sessionCode)
	if err == nil {
		for i := 0; i < state.TotalQuestions; i++ {
			e.redis.Del(ctx, redisKeyAnswers(sessionCode, i))
		}
	}
	e.redis.Del(ctx, redisKeyState(sessionCode))
	e.redis.Del(ctx, redisKeyQuestions(sessionCode))
}

// cancelTimer cancels the active question timer for a session.
func (e *Engine) cancelTimer(sessionCode string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if ch, ok := e.timers[sessionCode]; ok {
		close(ch)
		delete(e.timers, sessionCode)
	}
}

// getLeaderboard queries DB for the session leaderboard.
func (e *Engine) getLeaderboard(ctx context.Context, sessionID string) ([]models.LeaderboardEntry, error) {
	rows, err := e.db.Query(ctx,
		`SELECT id, name, score FROM game_players WHERE session_id = $1 ORDER BY score DESC`,
		sessionID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []models.LeaderboardEntry
	rank := 1
	for rows.Next() {
		var e models.LeaderboardEntry
		if err := rows.Scan(&e.PlayerID, &e.Name, &e.Score); err != nil {
			return nil, err
		}
		e.Rank = rank
		rank++
		entries = append(entries, e)
	}
	if entries == nil {
		entries = []models.LeaderboardEntry{}
	}
	return entries, nil
}

// loadQuestions fetches questions with options from DB.
func (e *Engine) loadQuestions(ctx context.Context, quizID string) ([]storedQuestion, error) {
	rows, err := e.db.Query(ctx,
		`SELECT id, text, type, time_limit, "order", COALESCE(image_url, '') FROM questions WHERE quiz_id = $1 ORDER BY "order" ASC`,
		quizID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var questions []storedQuestion
	for rows.Next() {
		var q storedQuestion
		if err := rows.Scan(&q.ID, &q.Text, &q.Type, &q.TimeLimit, &q.Order, &q.ImageURL); err != nil {
			return nil, err
		}
		questions = append(questions, q)
	}

	for i := range questions {
		optRows, err := e.db.Query(ctx,
			`SELECT id, text, is_correct, COALESCE(image_url, ''), sort_order FROM options WHERE question_id = $1 ORDER BY sort_order`,
			questions[i].ID,
		)
		if err != nil {
			return nil, err
		}
		for optRows.Next() {
			var opt storedOption
			if err := optRows.Scan(&opt.ID, &opt.Text, &opt.IsCorrect, &opt.ImageURL, &opt.SortOrder); err != nil {
				optRows.Close()
				return nil, err
			}
			questions[i].Options = append(questions[i].Options, opt)
		}
		optRows.Close()
	}
	return questions, nil
}

func (e *Engine) loadCachedQuestions(ctx context.Context, sessionCode string) ([]storedQuestion, error) {
	data, err := e.redis.Get(ctx, redisKeyQuestions(sessionCode)).Bytes()
	if err != nil {
		return nil, fmt.Errorf("questions not in cache: %w", err)
	}
	var questions []storedQuestion
	if err := json.Unmarshal(data, &questions); err != nil {
		return nil, err
	}
	return questions, nil
}

func (e *Engine) saveState(ctx context.Context, sessionCode string, state *GameState) error {
	data, err := json.Marshal(state)
	if err != nil {
		return err
	}
	return e.redis.Set(ctx, redisKeyState(sessionCode), data, 24*time.Hour).Err()
}

func (e *Engine) loadState(ctx context.Context, sessionCode string) (*GameState, error) {
	data, err := e.redis.Get(ctx, redisKeyState(sessionCode)).Bytes()
	if err != nil {
		return nil, fmt.Errorf("no game state for %s: %w", sessionCode, err)
	}
	var state GameState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, err
	}
	return &state, nil
}

// shuffleOptions returns a copy of options in random order (for ordering questions).
func shuffleOptions(opts []storedOption) []storedOption {
	shuffled := make([]storedOption, len(opts))
	copy(shuffled, opts)
	rand.Shuffle(len(shuffled), func(i, j int) {
		shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
	})
	return shuffled
}

// buildQuestionPayload constructs the question broadcast payload.
// Options do NOT include is_correct (players must not see the answer).
// For ordering questions, options are shuffled.
func buildQuestionPayload(q storedQuestion, idx, total int) map[string]any {
	options := q.Options
	if q.Type == string(models.QTypeOrdering) {
		options = shuffleOptions(options)
	}
	opts := make([]map[string]any, 0, len(options))
	for _, o := range options {
		opt := map[string]any{"id": o.ID, "text": o.Text}
		if o.ImageURL != "" {
			opt["image_url"] = o.ImageURL
		}
		opts = append(opts, opt)
	}
	question := map[string]any{
		"id":         q.ID,
		"text":       q.Text,
		"type":       q.Type,
		"time_limit": q.TimeLimit,
		"options":    opts,
	}
	if q.ImageURL != "" {
		question["image_url"] = q.ImageURL
	}
	return map[string]any{
		"question_index":  idx,
		"total_questions": total,
		"question":        question,
	}
}

// BuildHostQuestionPayload is the same as buildQuestionPayload but includes is_correct.
// For ordering questions, options are in correct order (sort_order).
func BuildHostQuestionPayload(q storedQuestion, idx, total int) map[string]any {
	opts := make([]map[string]any, 0, len(q.Options))
	for _, o := range q.Options {
		opt := map[string]any{
			"id":         o.ID,
			"text":       o.Text,
			"is_correct": o.IsCorrect,
		}
		if o.ImageURL != "" {
			opt["image_url"] = o.ImageURL
		}
		opt["sort_order"] = o.SortOrder
		opts = append(opts, opt)
	}
	question := map[string]any{
		"id":         q.ID,
		"text":       q.Text,
		"type":       q.Type,
		"time_limit": q.TimeLimit,
		"options":    opts,
	}
	if q.ImageURL != "" {
		question["image_url"] = q.ImageURL
	}
	return map[string]any{
		"question_index":  idx,
		"total_questions": total,
		"question":        question,
	}
}

// GetHostQuestion returns the current question with is_correct included (for host display).
func (e *Engine) GetHostQuestion(ctx context.Context, sessionCode string) (*hub.Message, error) {
	state, err := e.loadState(ctx, sessionCode)
	if err != nil {
		return nil, err
	}
	if state.Phase != PhaseQuestion {
		return nil, nil
	}
	questions, err := e.loadCachedQuestions(ctx, sessionCode)
	if err != nil {
		return nil, err
	}
	q := questions[state.CurrentIndex]
	msg := hub.Message{
		Type:    hub.MsgQuestion,
		Payload: BuildHostQuestionPayload(q, state.CurrentIndex, state.TotalQuestions),
	}
	return &msg, nil
}
