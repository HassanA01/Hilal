package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	appMiddleware "github.com/HassanA01/Hilal/backend/internal/middleware"
)

func withAdminID(req *http.Request, adminID string) *http.Request {
	return req.WithContext(appMiddleware.ContextWithAdminID(req.Context(), adminID))
}

func mustMarshal(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}

func TestCreateQuiz_Validation(t *testing.T) {
	h := newTestHandler()

	tests := []struct {
		name       string
		body       []byte
		wantStatus int
	}{
		{"empty body", mustMarshal(map[string]string{}), http.StatusBadRequest},
		{"missing title", mustMarshal(map[string]any{"questions": []any{}}), http.StatusBadRequest},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			req = withAdminID(req, "test-admin-id")
			w := httptest.NewRecorder()
			h.CreateQuiz(w, req)
			if w.Code != tc.wantStatus {
				t.Errorf("expected %d, got %d — body: %s", tc.wantStatus, w.Code, w.Body.String())
			}
		})
	}
}

func TestUpdateQuiz_Validation(t *testing.T) {
	h := newTestHandler()

	tests := []struct {
		name       string
		body       []byte
		wantStatus int
	}{
		{"empty title", mustMarshal(map[string]any{"title": "", "questions": []any{}}), http.StatusBadRequest},
		{"missing title", mustMarshal(map[string]any{"questions": []any{}}), http.StatusBadRequest},
		{"invalid json", []byte("not-json"), http.StatusBadRequest},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPut, "/", bytes.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			req = withAdminID(req, "test-admin-id")
			w := httptest.NewRecorder()
			h.UpdateQuiz(w, req)
			if w.Code != tc.wantStatus {
				t.Errorf("expected %d, got %d — body: %s", tc.wantStatus, w.Code, w.Body.String())
			}
		})
	}
}
