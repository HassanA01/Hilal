package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRequestID_GeneratesUUID(t *testing.T) {
	handler := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqID := GetRequestID(r.Context())
		if reqID == "" {
			t.Error("expected non-empty request ID in context")
		}
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	xReqID := rr.Header().Get("X-Request-Id")
	if xReqID == "" {
		t.Error("expected X-Request-Id header to be set")
	}
	// UUID v4 format: 8-4-4-4-12 hex chars
	if len(xReqID) != 36 {
		t.Errorf("expected UUID-length request ID, got %q", xReqID)
	}
}

func TestGetRequestID_EmptyContext(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	if got := GetRequestID(req.Context()); got != "" {
		t.Errorf("expected empty request ID from plain context, got %q", got)
	}
}
