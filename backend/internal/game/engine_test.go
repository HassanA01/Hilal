package game

import (
	"testing"
	"time"
)

func TestBuildQuestionPayload(t *testing.T) {
	q := storedQuestion{
		ID:        "q1",
		Text:      "What is 2+2?",
		Type:      "multiple_choice",
		TimeLimit: 20,
		Options: []storedOption{
			{ID: "o1", Text: "3", IsCorrect: false},
			{ID: "o2", Text: "4", IsCorrect: true},
			{ID: "o3", Text: "5", IsCorrect: false},
		},
	}

	payload := buildQuestionPayload(q, 0, 5)

	if payload["question_index"] != 0 {
		t.Errorf("expected question_index=0, got %v", payload["question_index"])
	}
	if payload["total_questions"] != 5 {
		t.Errorf("expected total_questions=5, got %v", payload["total_questions"])
	}

	inner, ok := payload["question"].(map[string]any)
	if !ok {
		t.Fatal("question field missing or wrong type")
	}
	if inner["id"] != "q1" {
		t.Errorf("expected id=q1, got %v", inner["id"])
	}
	if inner["type"] != "multiple_choice" {
		t.Errorf("expected type=multiple_choice, got %v", inner["type"])
	}
	opts, ok := inner["options"].([]map[string]any)
	if !ok {
		t.Fatal("options field missing or wrong type")
	}
	for _, opt := range opts {
		if _, hasCorrect := opt["is_correct"]; hasCorrect {
			t.Error("player question payload must not include is_correct")
		}
	}
}

func TestBuildHostQuestionPayload(t *testing.T) {
	q := storedQuestion{
		ID:        "q1",
		Text:      "Capital of France?",
		Type:      "multiple_choice",
		TimeLimit: 15,
		Options: []storedOption{
			{ID: "o1", Text: "London", IsCorrect: false},
			{ID: "o2", Text: "Paris", IsCorrect: true},
		},
	}

	payload := BuildHostQuestionPayload(q, 2, 10)

	inner, ok := payload["question"].(map[string]any)
	if !ok {
		t.Fatal("question field missing")
	}
	opts, ok := inner["options"].([]map[string]any)
	if !ok {
		t.Fatal("options field wrong type")
	}
	if len(opts) != 2 {
		t.Fatalf("expected 2 options, got %d", len(opts))
	}
	if opts[0]["is_correct"] != false {
		t.Error("expected first option is_correct=false")
	}
	if opts[1]["is_correct"] != true {
		t.Error("expected second option is_correct=true")
	}
}

func TestCalculatePointsTiming(t *testing.T) {
	// Verify that earlier answers score more points.
	fast := CalculatePoints(1, 20)
	slow := CalculatePoints(15, 20)
	if fast <= slow {
		t.Errorf("fast answer (%d) should score more than slow (%d)", fast, slow)
	}
	if fast > BasePoints {
		t.Errorf("points (%d) should not exceed BasePoints (%d)", fast, BasePoints)
	}
	if slow < 0 {
		t.Errorf("points should not be negative, got %d", slow)
	}
}

func TestGameStateFields(t *testing.T) {
	state := GameState{
		SessionCode:     "123456",
		SessionID:       "sess-id",
		CurrentIndex:    2,
		TotalQuestions:  5,
		Phase:           PhaseQuestion,
		QuestionStarted: time.Now(),
	}
	if state.Phase != PhaseQuestion {
		t.Errorf("expected phase %s, got %s", PhaseQuestion, state.Phase)
	}
	if state.CurrentIndex != 2 {
		t.Errorf("expected index 2, got %d", state.CurrentIndex)
	}
}

// TestRevealScoreCalculation verifies the reveal scoring logic:
// correct answers earn time-weighted points; incorrect answers earn zero.
func TestRevealScoreCalculation(t *testing.T) {
	correctOptionID := "opt-correct"
	wrongOptionID := "opt-wrong"
	timeLimit := 20
	questionStarted := time.Now().Add(-5 * time.Second) // 5 seconds elapsed

	tests := []struct {
		name            string
		optionID        string
		wantCorrect     bool
		wantPointsAbove int
		wantPointsBelow int
	}{
		{
			name:            "correct answer earns points",
			optionID:        correctOptionID,
			wantCorrect:     true,
			wantPointsAbove: 0,
			wantPointsBelow: BasePoints + 1,
		},
		{
			name:            "incorrect answer earns zero",
			optionID:        wrongOptionID,
			wantCorrect:     false,
			wantPointsAbove: -1,
			wantPointsBelow: 1,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			isCorrect := tc.optionID == correctOptionID
			points := 0
			if isCorrect {
				elapsed := time.Since(questionStarted).Seconds()
				points = CalculatePoints(elapsed, timeLimit)
			}

			if isCorrect != tc.wantCorrect {
				t.Errorf("isCorrect: got %v, want %v", isCorrect, tc.wantCorrect)
			}
			if points <= tc.wantPointsAbove || points >= tc.wantPointsBelow {
				t.Errorf("points=%d not in (%d, %d)", points, tc.wantPointsAbove, tc.wantPointsBelow)
			}
		})
	}
}

// TestRevealPayloadFields verifies the revealScoreEntry struct holds the right fields.
func TestRevealPayloadFields(t *testing.T) {
	entry := revealScoreEntry{
		IsCorrect:  true,
		Points:     750,
		TotalScore: 1750,
	}
	if !entry.IsCorrect {
		t.Error("expected IsCorrect=true")
	}
	if entry.Points != 750 {
		t.Errorf("expected Points=750, got %d", entry.Points)
	}
	if entry.TotalScore != 1750 {
		t.Errorf("expected TotalScore=1750, got %d", entry.TotalScore)
	}
}

func TestShuffleOptions_ActuallyShuffles(t *testing.T) {
	// Create options in a fixed order
	opts := []storedOption{
		{ID: "a", Text: "A", SortOrder: 0},
		{ID: "b", Text: "B", SortOrder: 1},
		{ID: "c", Text: "C", SortOrder: 2},
		{ID: "d", Text: "D", SortOrder: 3},
		{ID: "e", Text: "E", SortOrder: 4},
	}

	// Run shuffle many times and check that the order changes at least once.
	// With 5 items, the probability of never shuffling in 50 attempts is vanishingly small.
	sawDifferentOrder := false
	for range 50 {
		shuffled := shuffleOptions(opts)
		if len(shuffled) != len(opts) {
			t.Fatalf("shuffled length %d != original %d", len(shuffled), len(opts))
		}
		for j, o := range shuffled {
			if o.ID != opts[j].ID {
				sawDifferentOrder = true
				break
			}
		}
		if sawDifferentOrder {
			break
		}
	}
	if !sawDifferentOrder {
		t.Error("shuffleOptions did not change the order in 50 attempts — shuffle is broken")
	}
}

func TestShuffleOptions_DoesNotMutateOriginal(t *testing.T) {
	opts := []storedOption{
		{ID: "a", Text: "A"},
		{ID: "b", Text: "B"},
		{ID: "c", Text: "C"},
	}
	original := make([]storedOption, len(opts))
	copy(original, opts)

	_ = shuffleOptions(opts)

	for i, o := range opts {
		if o.ID != original[i].ID {
			t.Errorf("original slice was mutated at index %d", i)
		}
	}
}

func TestBuildQuestionPayload_OrderingShuffled(t *testing.T) {
	q := storedQuestion{
		ID:        "q1",
		Text:      "Order these",
		Type:      "ordering",
		TimeLimit: 30,
		Options: []storedOption{
			{ID: "o1", Text: "First", SortOrder: 0},
			{ID: "o2", Text: "Second", SortOrder: 1},
			{ID: "o3", Text: "Third", SortOrder: 2},
			{ID: "o4", Text: "Fourth", SortOrder: 3},
			{ID: "o5", Text: "Fifth", SortOrder: 4},
		},
	}

	// Run multiple times — at least once the order should differ
	sawDifferent := false
	for range 50 {
		payload := buildQuestionPayload(q, 0, 1)
		inner := payload["question"].(map[string]any)
		opts := inner["options"].([]map[string]any)
		for j, opt := range opts {
			if opt["id"] != q.Options[j].ID {
				sawDifferent = true
				break
			}
		}
		if sawDifferent {
			break
		}
	}
	if !sawDifferent {
		t.Error("ordering question options were never shuffled in player payload")
	}
}

func TestPhaseConstants(t *testing.T) {
	phases := []GamePhase{PhaseStarting, PhaseQuestion, PhaseReveal, PhaseLeaderboard, PhaseGameOver}
	seen := make(map[GamePhase]bool)
	for _, p := range phases {
		if seen[p] {
			t.Errorf("duplicate phase value: %s", p)
		}
		seen[p] = true
		if p == "" {
			t.Error("phase value must not be empty string")
		}
	}
}
