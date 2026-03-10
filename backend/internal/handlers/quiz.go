package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	appMiddleware "github.com/HassanA01/Hilal/backend/internal/middleware"
	"github.com/HassanA01/Hilal/backend/internal/models"
)

func (h *Handler) ListQuizzes(w http.ResponseWriter, r *http.Request) {
	adminID := appMiddleware.GetAdminID(r.Context())
	rows, err := h.db.Query(r.Context(),
		`SELECT id, admin_id, title, created_at FROM quizzes WHERE admin_id = $1 ORDER BY created_at DESC`,
		adminID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list quizzes")
		return
	}
	defer rows.Close()

	var quizzes []models.Quiz
	for rows.Next() {
		var q models.Quiz
		if err := rows.Scan(&q.ID, &q.AdminID, &q.Title, &q.CreatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to scan quiz")
			return
		}
		quizzes = append(quizzes, q)
	}
	if quizzes == nil {
		quizzes = []models.Quiz{}
	}
	writeJSON(w, http.StatusOK, quizzes)
}

type createQuizRequest struct {
	Title     string              `json:"title"`
	Questions []questionInputItem `json:"questions"`
}

type questionInputItem struct {
	Text      string            `json:"text"`
	Type      string            `json:"type"`
	TimeLimit int               `json:"time_limit"`
	Order     int               `json:"order"`
	ImageURL  string            `json:"image_url,omitempty"`
	Options   []optionInputItem `json:"options"`
}

type optionInputItem struct {
	Text      string `json:"text"`
	IsCorrect bool   `json:"is_correct"`
	ImageURL  string `json:"image_url,omitempty"`
	SortOrder int    `json:"sort_order"`
}

// validateQuestionByType checks type-specific constraints for a question.
func validateQuestionByType(qi questionInputItem) string {
	qType := qi.Type
	if qType == "" {
		qType = string(models.QTypeMultipleChoice)
	}

	switch models.QuestionType(qType) {
	case models.QTypeMultipleChoice:
		if len(qi.Options) < 2 || len(qi.Options) > 4 {
			return "multiple choice questions must have 2–4 options"
		}
		correct := 0
		for _, o := range qi.Options {
			if o.IsCorrect {
				correct++
			}
		}
		if correct < 1 {
			return "multiple choice questions must have at least 1 correct option"
		}

	case models.QTypeMultiSelect:
		if len(qi.Options) < 2 || len(qi.Options) > 4 {
			return "multi-select questions must have 2–4 options"
		}
		correct := 0
		for _, o := range qi.Options {
			if o.IsCorrect {
				correct++
			}
		}
		if correct < 2 {
			return "multi-select questions must have at least 2 correct options"
		}

	case models.QTypeTrueFalse:
		if len(qi.Options) != 2 {
			return "true/false questions must have exactly 2 options"
		}
		correct := 0
		for _, o := range qi.Options {
			if o.IsCorrect {
				correct++
			}
		}
		if correct != 1 {
			return "true/false questions must have exactly 1 correct option"
		}

	case models.QTypeImageChoice:
		if len(qi.Options) < 2 || len(qi.Options) > 4 {
			return "image choice questions must have 2–4 options"
		}
		correct := 0
		for _, o := range qi.Options {
			if o.IsCorrect {
				correct++
			}
			if o.ImageURL == "" {
				return "all options in image choice questions must have an image URL"
			}
		}
		if correct != 1 {
			return "image choice questions must have exactly 1 correct option"
		}

	case models.QTypeOrdering:
		if len(qi.Options) < 2 || len(qi.Options) > 8 {
			return "ordering questions must have 2–8 items"
		}

	default:
		return "invalid question type: " + qType
	}

	return ""
}

func (h *Handler) CreateQuiz(w http.ResponseWriter, r *http.Request) {
	adminID := appMiddleware.GetAdminID(r.Context())

	var req createQuizRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Title == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}

	for i, qi := range req.Questions {
		if errMsg := validateQuestionByType(qi); errMsg != "" {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("question %d: %s", i+1, errMsg))
			return
		}
	}

	quizID := uuid.New()
	adminUUID, err := uuid.Parse(adminID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid admin id")
		return
	}

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start transaction")
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()

	_, err = tx.Exec(r.Context(),
		`INSERT INTO quizzes (id, admin_id, title) VALUES ($1, $2, $3)`,
		quizID, adminUUID, req.Title,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create quiz")
		return
	}

	for _, qi := range req.Questions {
		qID := uuid.New()
		qType := qi.Type
		if qType == "" {
			qType = string(models.QTypeMultipleChoice)
		}
		var imgURL *string
		if qi.ImageURL != "" {
			imgURL = &qi.ImageURL
		}
		_, err = tx.Exec(r.Context(),
			`INSERT INTO questions (id, quiz_id, text, type, time_limit, "order", image_url) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			qID, quizID, qi.Text, qType, qi.TimeLimit, qi.Order, imgURL,
		)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to create question")
			return
		}
		for idx, oi := range qi.Options {
			var optImgURL *string
			if oi.ImageURL != "" {
				optImgURL = &oi.ImageURL
			}
			sortOrder := oi.SortOrder
			if sortOrder == 0 {
				sortOrder = idx
			}
			_, err = tx.Exec(r.Context(),
				`INSERT INTO options (id, question_id, text, is_correct, image_url, sort_order) VALUES ($1, $2, $3, $4, $5, $6)`,
				uuid.New(), qID, oi.Text, oi.IsCorrect, optImgURL, sortOrder,
			)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed to create option")
				return
			}
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to commit transaction")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{"id": quizID.String(), "title": req.Title})
}

func (h *Handler) GetQuiz(w http.ResponseWriter, r *http.Request) {
	quizID := chi.URLParam(r, "quizID")
	adminID := appMiddleware.GetAdminID(r.Context())

	var quiz models.Quiz
	err := h.db.QueryRow(r.Context(),
		`SELECT id, admin_id, title, created_at FROM quizzes WHERE id = $1 AND admin_id = $2`, quizID, adminID,
	).Scan(&quiz.ID, &quiz.AdminID, &quiz.Title, &quiz.CreatedAt)
	if err != nil {
		writeError(w, http.StatusNotFound, "quiz not found")
		return
	}

	rows, err := h.db.Query(r.Context(),
		`SELECT id, quiz_id, text, type, time_limit, "order", image_url FROM questions WHERE quiz_id = $1 ORDER BY "order"`, quizID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load questions")
		return
	}
	defer rows.Close()

	for rows.Next() {
		var q models.Question
		if err := rows.Scan(&q.ID, &q.QuizID, &q.Text, &q.Type, &q.TimeLimit, &q.Order, &q.ImageURL); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to scan question")
			return
		}
		optRows, err := h.db.Query(r.Context(),
			`SELECT id, question_id, text, is_correct, image_url, sort_order FROM options WHERE question_id = $1 ORDER BY sort_order`, q.ID,
		)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to load options")
			return
		}
		for optRows.Next() {
			var o models.Option
			if err := optRows.Scan(&o.ID, &o.QuestionID, &o.Text, &o.IsCorrect, &o.ImageURL, &o.SortOrder); err != nil {
				optRows.Close()
				writeError(w, http.StatusInternalServerError, "failed to scan option")
				return
			}
			q.Options = append(q.Options, o)
		}
		optRows.Close()
		if err := optRows.Err(); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read options")
			return
		}
		quiz.Questions = append(quiz.Questions, q)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read questions")
		return
	}

	writeJSON(w, http.StatusOK, quiz)
}

func (h *Handler) UpdateQuiz(w http.ResponseWriter, r *http.Request) {
	quizID := chi.URLParam(r, "quizID")
	adminID := appMiddleware.GetAdminID(r.Context())

	var req createQuizRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Title == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}

	for i, qi := range req.Questions {
		if errMsg := validateQuestionByType(qi); errMsg != "" {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("question %d: %s", i+1, errMsg))
			return
		}
	}

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start transaction")
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()

	// Verify ownership and update title atomically
	result, err := tx.Exec(r.Context(),
		`UPDATE quizzes SET title = $1 WHERE id = $2 AND admin_id = $3`,
		req.Title, quizID, adminID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update quiz")
		return
	}
	if result.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "quiz not found")
		return
	}

	// Replace all questions and options (delete cascade handles options)
	if _, err = tx.Exec(r.Context(), `DELETE FROM questions WHERE quiz_id = $1`, quizID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update questions")
		return
	}

	for _, qi := range req.Questions {
		qID := uuid.New()
		qType := qi.Type
		if qType == "" {
			qType = string(models.QTypeMultipleChoice)
		}
		var imgURL *string
		if qi.ImageURL != "" {
			imgURL = &qi.ImageURL
		}
		if _, err = tx.Exec(r.Context(),
			`INSERT INTO questions (id, quiz_id, text, type, time_limit, "order", image_url) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			qID, quizID, qi.Text, qType, qi.TimeLimit, qi.Order, imgURL,
		); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to update question")
			return
		}
		for idx, oi := range qi.Options {
			var optImgURL *string
			if oi.ImageURL != "" {
				optImgURL = &oi.ImageURL
			}
			sortOrder := oi.SortOrder
			if sortOrder == 0 {
				sortOrder = idx
			}
			if _, err = tx.Exec(r.Context(),
				`INSERT INTO options (id, question_id, text, is_correct, image_url, sort_order) VALUES ($1, $2, $3, $4, $5, $6)`,
				uuid.New(), qID, oi.Text, oi.IsCorrect, optImgURL, sortOrder,
			); err != nil {
				writeError(w, http.StatusInternalServerError, "failed to update option")
				return
			}
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to commit transaction")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"id": quizID, "title": req.Title})
}

func (h *Handler) DeleteQuiz(w http.ResponseWriter, r *http.Request) {
	quizID := chi.URLParam(r, "quizID")
	adminID := appMiddleware.GetAdminID(r.Context())
	result, err := h.db.Exec(r.Context(),
		`DELETE FROM quizzes WHERE id = $1 AND admin_id = $2`, quizID, adminID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete quiz")
		return
	}
	if result.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "quiz not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
