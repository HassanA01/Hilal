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

func TestValidateQuestionByType(t *testing.T) {
	tests := []struct {
		name    string
		input   questionInputItem
		wantErr bool
	}{
		{
			name: "valid multiple choice",
			input: questionInputItem{
				Type:    "multiple_choice",
				Options: []optionInputItem{{Text: "A", IsCorrect: true}, {Text: "B"}, {Text: "C"}, {Text: "D"}},
			},
		},
		{
			name: "mc too few options",
			input: questionInputItem{
				Type:    "multiple_choice",
				Options: []optionInputItem{{Text: "A", IsCorrect: true}},
			},
			wantErr: true,
		},
		{
			name: "mc no correct",
			input: questionInputItem{
				Type:    "multiple_choice",
				Options: []optionInputItem{{Text: "A"}, {Text: "B"}, {Text: "C"}, {Text: "D"}},
			},
			wantErr: true,
		},
		{
			name: "valid true/false",
			input: questionInputItem{
				Type:    "true_false",
				Options: []optionInputItem{{Text: "True", IsCorrect: true}, {Text: "False"}},
			},
		},
		{
			name: "tf wrong option count",
			input: questionInputItem{
				Type:    "true_false",
				Options: []optionInputItem{{Text: "True", IsCorrect: true}},
			},
			wantErr: true,
		},
		{
			name: "valid image choice",
			input: questionInputItem{
				Type: "image_choice",
				Options: []optionInputItem{
					{Text: "A", IsCorrect: true, ImageURL: "http://img/1"},
					{Text: "B", ImageURL: "http://img/2"},
				},
			},
		},
		{
			name: "image choice missing url",
			input: questionInputItem{
				Type: "image_choice",
				Options: []optionInputItem{
					{Text: "A", IsCorrect: true, ImageURL: "http://img/1"},
					{Text: "B"},
				},
			},
			wantErr: true,
		},
		{
			name: "valid ordering",
			input: questionInputItem{
				Type:    "ordering",
				Options: []optionInputItem{{Text: "First"}, {Text: "Second"}, {Text: "Third"}},
			},
		},
		{
			name: "ordering too few",
			input: questionInputItem{
				Type:    "ordering",
				Options: []optionInputItem{{Text: "Only"}},
			},
			wantErr: true,
		},
		{
			name: "invalid type",
			input: questionInputItem{
				Type:    "essay",
				Options: []optionInputItem{{Text: "A"}},
			},
			wantErr: true,
		},
		{
			name: "empty type defaults to mc",
			input: questionInputItem{
				Options: []optionInputItem{{Text: "A", IsCorrect: true}, {Text: "B"}, {Text: "C"}, {Text: "D"}},
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			errMsg := validateQuestionByType(tc.input)
			if tc.wantErr && errMsg == "" {
				t.Error("expected validation error, got none")
			}
			if !tc.wantErr && errMsg != "" {
				t.Errorf("unexpected validation error: %s", errMsg)
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
