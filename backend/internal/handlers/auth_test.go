package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/HassanA01/Hilal/backend/internal/config"
)

// newTestHandler returns a Handler with nil DB/Redis/hub — safe for tests
// that only exercise validation paths (return before hitting DB).
func newTestHandler() *Handler {
	return &Handler{
		config: &config.Config{
			JWTSecret: "test-secret-that-is-long-enough",
		},
	}
}

func postJSON(t *testing.T, handler http.HandlerFunc, body any) *httptest.ResponseRecorder {
	t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler(w, req)
	return w
}

func TestRegister_Validation(t *testing.T) {
	h := newTestHandler()

	tests := []struct {
		name       string
		body       any
		wantStatus int
	}{
		{"empty body", map[string]string{}, http.StatusBadRequest},
		{"missing password", map[string]string{"email": "a@b.com"}, http.StatusBadRequest},
		{"missing email", map[string]string{"password": "secret123"}, http.StatusBadRequest},
		{"invalid email", map[string]string{"email": "notanemail", "password": "secret123"}, http.StatusBadRequest},
		{"password too short", map[string]string{"email": "a@b.com", "password": "short"}, http.StatusBadRequest},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w := postJSON(t, h.Register, tc.body)
			if w.Code != tc.wantStatus {
				t.Errorf("expected %d, got %d — body: %s", tc.wantStatus, w.Code, w.Body.String())
			}
		})
	}
}

func TestLogin_Validation(t *testing.T) {
	h := newTestHandler()

	tests := []struct {
		name       string
		body       any
		wantStatus int
	}{
		// Login hits DB after basic decode — nil DB would panic, so only test decode failure
		{"invalid json body", "not-json", http.StatusBadRequest},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(tc.body.(string)))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			h.Login(w, req)
			if w.Code != tc.wantStatus {
				t.Errorf("expected %d, got %d — body: %s", tc.wantStatus, w.Code, w.Body.String())
			}
		})
	}
}

func TestGenerateToken(t *testing.T) {
	h := newTestHandler()
	tok, err := h.generateToken("test-admin-id")
	if err != nil {
		t.Fatalf("generateToken failed: %v", err)
	}
	if tok == "" {
		t.Error("expected non-empty token")
	}
}
