package handlers

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/HassanA01/Hilal/backend/internal/config"
	"github.com/HassanA01/Hilal/backend/internal/middleware"
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
			name:       "whitespace-only topic",
			body:       map[string]any{"topic": "   \t\n  ", "question_count": 5},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "question_count zero",
			body:       map[string]any{"topic": "Science", "question_count": 0},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "question_count exceeds AI cap",
			body:       map[string]any{"topic": "Science", "question_count": 11},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "question_count way too high",
			body:       map[string]any{"topic": "Science", "question_count": 21},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "non-printable chars in topic",
			body:       map[string]any{"topic": "Science\x00quiz", "question_count": 5},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "non-printable chars in context",
			body:       map[string]any{"topic": "Science", "question_count": 5, "context": "normal\x00text"},
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
		"topic":          strings.Repeat("a", 201),
		"question_count": 5,
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("want 400, got %d", w.Code)
	}
}

func TestGenerateQuiz_MaxQuestionsAllowed(t *testing.T) {
	// With no API key, a valid request at the cap should pass validation
	// and reach the 503 "not configured" check.
	h := newTestHandler()
	w := postJSON(t, h.GenerateQuiz, map[string]any{
		"topic":          "Science",
		"question_count": 10,
	})
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("want 503 (passed validation), got %d", w.Code)
	}
}

func TestIsPrintable(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"normal text", true},
		{"with numbers 123", true},
		{"Unicode: café résumé", true},
		{"has\x00null", false},
		{"has\x01control", false},
		{"", true},
		{"tabs\tand\nnewlines", true},
	}
	for _, tc := range tests {
		got := isPrintable(tc.input)
		if got != tc.want {
			t.Errorf("isPrintable(%q) = %v, want %v", tc.input, got, tc.want)
		}
	}
}

func TestClassifyInput_Pass(t *testing.T) {
	h := newTestHandler()
	// No anthropic client → classifyInput should fail-open (return true)
	// since it can't make the API call.
	// This tests the fail-open behavior.
	reason, ok := h.classifyInput(context.Background(), "Islamic history", "")
	if !ok {
		t.Errorf("expected pass (fail-open), got fail with reason: %s", reason)
	}
}

func TestClassifyInput_FailOpen_NilClient(t *testing.T) {
	h := newTestHandler() // no anthropic client
	reason, ok := h.classifyInput(context.Background(), "anything", "")
	if !ok {
		t.Errorf("expected fail-open, got fail with reason: %s", reason)
	}
	if reason != "" {
		t.Errorf("expected empty reason on fail-open, got: %s", reason)
	}
}

// newTestHandlerWithRedis creates a handler backed by miniredis for rate limit testing.
func newTestHandlerWithRedis(t *testing.T, limit int) (*Handler, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	rc := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { rc.Close() })
	return &Handler{
		redis: rc,
		config: &config.Config{
			JWTSecret:          "test-secret-that-is-long-enough",
			AIRateLimitPerHour: limit,
		},
	}, mr
}

func TestCheckRateLimit_NilRedis(t *testing.T) {
	h := newTestHandler() // redis is nil
	retryAfter, limited := h.checkRateLimit(context.Background(), "admin-1")
	if limited {
		t.Error("expected no rate limiting with nil redis")
	}
	if retryAfter != 0 {
		t.Errorf("expected retryAfter=0, got %d", retryAfter)
	}
}

func TestCheckRateLimit_ZeroLimit(t *testing.T) {
	h, _ := newTestHandlerWithRedis(t, 0)
	_, limited := h.checkRateLimit(context.Background(), "admin-1")
	if limited {
		t.Error("expected no rate limiting with limit=0")
	}
}

func TestCheckRateLimit_UnderLimit(t *testing.T) {
	h, _ := newTestHandlerWithRedis(t, 5)
	ctx := context.Background()
	for i := 0; i < 5; i++ {
		_, limited := h.checkRateLimit(ctx, "admin-1")
		if limited {
			t.Fatalf("request %d should not be rate limited", i+1)
		}
	}
}

func TestCheckRateLimit_ExceedsLimit(t *testing.T) {
	h, _ := newTestHandlerWithRedis(t, 3)
	ctx := context.Background()

	// Make 3 requests (at the limit)
	for i := 0; i < 3; i++ {
		_, limited := h.checkRateLimit(ctx, "admin-1")
		if limited {
			t.Fatalf("request %d should not be rate limited", i+1)
		}
	}

	// 4th request should be rate limited
	retryAfter, limited := h.checkRateLimit(ctx, "admin-1")
	if !limited {
		t.Error("4th request should be rate limited")
	}
	if retryAfter <= 0 {
		t.Errorf("expected positive retryAfter, got %d", retryAfter)
	}
}

func TestCheckRateLimit_PerUser(t *testing.T) {
	h, _ := newTestHandlerWithRedis(t, 2)
	ctx := context.Background()

	// admin-1 makes 2 requests
	for i := 0; i < 2; i++ {
		_, limited := h.checkRateLimit(ctx, "admin-1")
		if limited {
			t.Fatalf("admin-1 request %d should not be limited", i+1)
		}
	}

	// admin-1 is now limited
	_, limited := h.checkRateLimit(ctx, "admin-1")
	if !limited {
		t.Error("admin-1 should be limited after 2 requests")
	}

	// admin-2 should still be allowed
	_, limited = h.checkRateLimit(ctx, "admin-2")
	if limited {
		t.Error("admin-2 should not be limited")
	}
}

func TestGenerateQuiz_RateLimited(t *testing.T) {
	h, _ := newTestHandlerWithRedis(t, 1)

	makeRequest := func() *httptest.ResponseRecorder {
		body, _ := json.Marshal(map[string]any{
			"topic":          "Science",
			"question_count": 3,
		})
		req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req = req.WithContext(middleware.ContextWithAdminID(req.Context(), "admin-1"))
		w := httptest.NewRecorder()
		h.GenerateQuiz(w, req)
		return w
	}

	// First request should pass validation and hit 503 (no anthropic client)
	w := makeRequest()
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("first request: want 503, got %d", w.Code)
	}

	// Second request should be rate limited
	w = makeRequest()
	if w.Code != http.StatusTooManyRequests {
		t.Errorf("second request: want 429, got %d", w.Code)
	}
	if w.Header().Get("Retry-After") == "" {
		t.Error("expected Retry-After header")
	}
}

// --- Upload handler tests ---

// postMultipart builds a multipart request with a file and optional form fields.
func postMultipart(t *testing.T, handler http.HandlerFunc, filename string, fileContent []byte, fields map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	if fileContent != nil {
		part, err := writer.CreateFormFile("document", filename)
		if err != nil {
			t.Fatalf("create form file: %v", err)
		}
		if _, err := part.Write(fileContent); err != nil {
			t.Fatalf("write file content: %v", err)
		}
	}
	for k, v := range fields {
		if err := writer.WriteField(k, v); err != nil {
			t.Fatalf("write field %s: %v", k, err)
		}
	}
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/", &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	handler(w, req)
	return w
}

func TestGenerateQuizFromUpload_MissingFile(t *testing.T) {
	h := newTestHandler()
	w := postMultipart(t, h.GenerateQuizFromUpload, "", nil, map[string]string{
		"question_count": "5",
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("want 400, got %d", w.Code)
	}
}

func TestGenerateQuizFromUpload_UnsupportedExtension(t *testing.T) {
	h := newTestHandler()
	w := postMultipart(t, h.GenerateQuizFromUpload, "sheet.xlsx", []byte("data"), map[string]string{
		"question_count": "5",
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("want 400, got %d", w.Code)
	}
}

func TestGenerateQuizFromUpload_InvalidQuestionCount(t *testing.T) {
	h := newTestHandler()

	tests := []struct {
		name  string
		count string
	}{
		{"zero", "0"},
		{"eleven", "11"},
		{"non-numeric", "abc"},
		{"empty", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w := postMultipart(t, h.GenerateQuizFromUpload, "notes.txt", []byte("some content"), map[string]string{
				"question_count": tc.count,
			})
			if w.Code != http.StatusBadRequest {
				t.Errorf("want 400, got %d", w.Code)
			}
		})
	}
}

func TestGenerateQuizFromUpload_EmptyTextFile(t *testing.T) {
	h := newTestHandler()
	w := postMultipart(t, h.GenerateQuizFromUpload, "empty.txt", []byte("   \n  "), map[string]string{
		"question_count": "5",
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("want 400, got %d", w.Code)
	}
}

func TestGenerateQuizFromUpload_MissingAPIKey(t *testing.T) {
	h := newTestHandler()
	w := postMultipart(t, h.GenerateQuizFromUpload, "notes.txt", []byte("This is a document about science and biology."), map[string]string{
		"question_count": "5",
	})
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("want 503 (passed validation), got %d", w.Code)
	}
}

func TestGenerateQuizFromUpload_ValidDocx(t *testing.T) {
	h := newTestHandler()
	docx := makeTestDOCX("This is document body text about history.")
	w := postMultipart(t, h.GenerateQuizFromUpload, "lesson.docx", docx, map[string]string{
		"question_count": "3",
	})
	// Should pass validation and reach the 503 (no anthropic client)
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("want 503 (passed validation), got %d", w.Code)
	}
}

func TestGenerateQuizFromUpload_BadMagicBytes(t *testing.T) {
	h := newTestHandler()
	w := postMultipart(t, h.GenerateQuizFromUpload, "fake.pdf", []byte("not a pdf file"), map[string]string{
		"question_count": "5",
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("want 400, got %d", w.Code)
	}
}

func TestGenerateQuizFromUpload_RateLimited(t *testing.T) {
	h, _ := newTestHandlerWithRedis(t, 1)

	makeRequest := func() *httptest.ResponseRecorder {
		var buf bytes.Buffer
		writer := multipart.NewWriter(&buf)
		part, _ := writer.CreateFormFile("document", "notes.txt")
		_, _ = part.Write([]byte("Some document content for quiz generation."))
		_ = writer.WriteField("question_count", "3")
		writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/", &buf)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req = req.WithContext(middleware.ContextWithAdminID(req.Context(), "admin-1"))
		w := httptest.NewRecorder()
		h.GenerateQuizFromUpload(w, req)
		return w
	}

	// First request: passes rate limit, hits 503 (no anthropic client)
	w := makeRequest()
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("first request: want 503, got %d", w.Code)
	}

	// Second request: rate limited
	w = makeRequest()
	if w.Code != http.StatusTooManyRequests {
		t.Errorf("second request: want 429, got %d", w.Code)
	}
}

// makeTestDOCX creates a minimal valid DOCX (ZIP) with a single paragraph.
func makeTestDOCX(text string) []byte {
	buf := new(bytes.Buffer)
	w := zip.NewWriter(buf)
	f, _ := w.Create("word/document.xml")
	fmt.Fprintf(f,
		`<?xml version="1.0" encoding="UTF-8"?>`+
			`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`+
			`<w:body><w:p><w:r><w:t>%s</w:t></w:r></w:p></w:body></w:document>`, text)
	w.Close()
	return buf.Bytes()
}
