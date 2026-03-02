package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGenerateQuiz_MissingAPIKey(t *testing.T) {
	h := newTestHandler() // anthropicClient is nil (no key in test config)

	w := postJSON(t, h.GenerateQuiz, map[string]any{
		"topic":          "Science",
		"question_count": 3,
		"context":        "",
	})

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("want 503, got %d", w.Code)
	}
}

func TestGenerateQuiz_ValidationErrors(t *testing.T) {
	h := newTestHandler()

	tests := []struct {
		name       string
		body       any
		wantStatus int
	}{
		{
			name:       "missing topic",
			body:       map[string]any{"question_count": 5},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "question_count zero",
			body:       map[string]any{"topic": "Science", "question_count": 0},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "question_count too high",
			body:       map[string]any{"topic": "Science", "question_count": 21},
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w := postJSON(t, h.GenerateQuiz, tc.body)
			if w.Code != tc.wantStatus {
				t.Errorf("want %d, got %d", tc.wantStatus, w.Code)
			}
		})
	}
}

func TestGenerateQuiz_InvalidJSON(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("not-json"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.GenerateQuiz(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("want 400, got %d", w.Code)
	}
}

func TestGenerateQuiz_TopicTooLong(t *testing.T) {
	h := newTestHandler()
	w := postJSON(t, h.GenerateQuiz, map[string]any{
		"topic":          string(make([]byte, 201)),
		"question_count": 5,
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("want 400, got %d", w.Code)
	}
}
