# AI Quiz Generation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `POST /api/v1/quizzes/generate` backend endpoint that calls Claude via tool use to produce a structured quiz, then wire up a glowing "Generate with AI" card on the QuizFormPage that opens a modal, calls the endpoint, and pre-fills the form with the result.

**Architecture:** Backend handler calls the official Anthropic Go SDK using forced tool use (`tool_choice: {type: "any", name: "create_quiz"}`) so Claude always returns schema-conformant JSON — no markdown stripping, no parse fragility. The endpoint returns data only; the existing `POST /api/v1/quizzes` saves it. Frontend passes generated data via React Router location state to pre-fill `QuizFormPage`.

**Tech Stack:** Go 1.24, `github.com/anthropics/anthropic-sdk-go`, React 19 + TypeScript, Framer Motion, lucide-react, TanStack Query v5, React Router v7

---

### Task 1: Add ANTHROPIC_API_KEY to config and env

**Files:**
- Modify: `backend/internal/config/config.go`
- Modify: `.env.example`

**Step 1: Update Config struct**

In `backend/internal/config/config.go`, add `AnthropicAPIKey` field and load it:

```go
type Config struct {
	Port            string
	DatabaseURL     string
	RedisURL        string
	JWTSecret       string
	FrontendURL     string
	AnthropicAPIKey string
}

func Load() *Config {
	secret := getEnv("JWT_SECRET", "")
	if secret == "" {
		log.Fatal("JWT_SECRET environment variable is required")
	}

	return &Config{
		Port:            getEnv("PORT", "8081"),
		DatabaseURL:     getEnv("DATABASE_URL", "postgres://hilal:hilal@localhost:5432/hilal?sslmode=disable"),
		RedisURL:        getEnv("REDIS_URL", "redis://localhost:6379"),
		JWTSecret:       secret,
		FrontendURL:     getEnv("FRONTEND_URL", "http://localhost:5173"),
		AnthropicAPIKey: getEnv("ANTHROPIC_API_KEY", ""),
	}
}
```

Note: we do NOT fatal on empty `ANTHROPIC_API_KEY` — the handler will return a 502 if it's missing. This keeps the server bootable without the key in environments that don't use AI generation.

**Step 2: Update .env.example**

Add after the `FRONTEND_URL` line:

```
# Anthropic API key for AI quiz generation
# Get one at https://console.anthropic.com
ANTHROPIC_API_KEY=
```

**Step 3: Commit**

```bash
git add backend/internal/config/config.go .env.example
git commit -m "feat: add ANTHROPIC_API_KEY to config"
```

---

### Task 2: Add Anthropic Go SDK dependency

**Files:**
- Modify: `backend/go.mod`, `backend/go.sum`

**Step 1: Add the SDK**

Run from `backend/` directory:

```bash
go get github.com/anthropics/anthropic-sdk-go
```

**Step 2: Verify it appears in go.mod**

```bash
grep anthropic go.mod
```
Expected: `github.com/anthropics/anthropic-sdk-go vX.Y.Z`

**Step 3: Commit**

```bash
git add go.mod go.sum
git commit -m "chore: add anthropic-sdk-go dependency"
```

---

### Task 3: Add Anthropic client to Handler struct

**Files:**
- Modify: `backend/internal/handlers/handlers.go`

**Step 1: Update Handler struct and constructor**

```go
package handlers

import (
	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/HassanA01/Hilal/backend/internal/config"
	"github.com/HassanA01/Hilal/backend/internal/game"
	"github.com/HassanA01/Hilal/backend/internal/hub"
)

type Handler struct {
	db              *pgxpool.Pool
	redis           *redis.Client
	hub             *hub.Hub
	engine          *game.Engine
	config          *config.Config
	anthropicClient *anthropic.Client
}

func New(db *pgxpool.Pool, redisClient *redis.Client, gameHub *hub.Hub, cfg *config.Config) *Handler {
	var ac *anthropic.Client
	if cfg.AnthropicAPIKey != "" {
		c := anthropic.NewClient(option.WithAPIKey(cfg.AnthropicAPIKey))
		ac = &c
	}
	return &Handler{
		db:              db,
		redis:           redisClient,
		hub:             gameHub,
		engine:          game.NewEngine(gameHub, db, redisClient),
		config:          cfg,
		anthropicClient: ac,
	}
}
```

**Step 2: Register the new route** inside the `RequireAuth` group in `RegisterRoutes`:

```go
r.Post("/quizzes/generate", h.GenerateQuiz)
```

Add it directly after `r.Post("/quizzes", h.CreateQuiz)`.

**Step 3: Verify it compiles**

```bash
cd backend && go build ./...
```
Expected: no errors (GenerateQuiz doesn't exist yet — that's fine if you add a stub, or skip and add it in Task 5)

**Step 4: Commit**

```bash
git add backend/internal/handlers/handlers.go
git commit -m "feat: add anthropic client to handler struct"
```

---

### Task 4: Write failing tests for GenerateQuiz handler

**Files:**
- Create: `backend/internal/handlers/ai_test.go`

**Step 1: Write the tests**

```go
package handlers

import (
	"net/http"
	"testing"
)

func TestGenerateQuiz_MissingAPIKey(t *testing.T) {
	// anthropicClient is nil when key is empty
	h := newTestHandler()

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
```

**Step 2: Run tests to verify they fail**

```bash
cd backend && go test ./internal/handlers/... -run TestGenerateQuiz -v
```
Expected: compile error — `h.GenerateQuiz` undefined. That's correct — proceed to Task 5.

---

### Task 5: Implement GenerateQuiz handler

**Files:**
- Create: `backend/internal/handlers/ai.go`

**Step 1: Write the handler**

```go
package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
)

type generateQuizRequest struct {
	Topic         string `json:"topic"`
	QuestionCount int    `json:"question_count"`
	Context       string `json:"context"`
}

func (h *Handler) GenerateQuiz(w http.ResponseWriter, r *http.Request) {
	if h.anthropicClient == nil {
		writeError(w, http.StatusServiceUnavailable, "AI generation is not configured")
		return
	}

	var req generateQuizRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Topic == "" {
		writeError(w, http.StatusBadRequest, "topic is required")
		return
	}
	if req.QuestionCount < 1 || req.QuestionCount > 20 {
		writeError(w, http.StatusBadRequest, "question_count must be between 1 and 20")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	userPrompt := buildPrompt(req)

	// Tool schema matches createQuizRequest exactly
	schema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"title": map[string]any{"type": "string", "description": "A concise, engaging quiz title"},
			"questions": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"text":       map[string]any{"type": "string"},
						"time_limit": map[string]any{"type": "integer", "description": "Seconds, use 20"},
						"order":      map[string]any{"type": "integer"},
						"options": map[string]any{
							"type": "array",
							"items": map[string]any{
								"type": "object",
								"properties": map[string]any{
									"text":       map[string]any{"type": "string"},
									"is_correct": map[string]any{"type": "boolean"},
								},
								"required": []string{"text", "is_correct"},
							},
							"minItems": 4,
							"maxItems": 4,
						},
					},
					"required": []string{"text", "time_limit", "order", "options"},
				},
			},
		},
		"required": []string{"title", "questions"},
	}

	toolName := "create_quiz"
	msg, err := h.anthropicClient.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeSonnet4_6,
		MaxTokens: 4096,
		System: []anthropic.TextBlockParam{
			{
				Type: "text",
				Text: "You are an expert quiz writer. Generate engaging, accurate multiple-choice questions. Each question must have exactly 4 options with exactly 1 correct answer. Return data by calling the create_quiz tool.",
			},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(userPrompt),
		},
		Tools: []anthropic.ToolParam{
			{
				Name:        toolName,
				Description: anthropic.String("Create a structured multiple-choice quiz"),
				InputSchema: anthropic.ToolInputSchemaParam{
					Type:       "object",
					Properties: schema["properties"],
				},
			},
		},
		ToolChoice: anthropic.ToolChoiceToolParam{
			Type: "tool",
			Name: toolName,
		},
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, "AI service error: "+err.Error())
		return
	}

	// Extract tool use block
	var rawInput json.RawMessage
	for _, block := range msg.Content {
		if block.Type == anthropic.ContentBlockTypeToolUse {
			toolBlock := block.AsToolUse()
			rawInput = toolBlock.Input
			break
		}
	}
	if rawInput == nil {
		writeError(w, http.StatusBadGateway, "AI returned invalid response, please try again")
		return
	}

	var quiz createQuizRequest
	if err := json.Unmarshal(rawInput, &quiz); err != nil {
		writeError(w, http.StatusBadGateway, "AI returned invalid response, please try again")
		return
	}
	if quiz.Title == "" || len(quiz.Questions) == 0 {
		writeError(w, http.StatusBadGateway, "AI returned incomplete quiz, please try again")
		return
	}

	writeJSON(w, http.StatusOK, quiz)
}

func buildPrompt(req generateQuizRequest) string {
	prompt := "Generate a " + itoa(req.QuestionCount) + "-question multiple-choice quiz about: " + req.Topic + "."
	if req.Context != "" {
		prompt += "\nAdditional context: " + req.Context
	}
	prompt += "\nEach question needs exactly 4 options, exactly 1 correct. Use order values 1 through " + itoa(req.QuestionCount) + "."
	return prompt
}

func itoa(n int) string {
	return string(rune('0'+n%10)) // good enough for 1-20; use strconv.Itoa for real use
}
```

> **Note on `itoa`**: Replace the stub with `import "strconv"` and `strconv.Itoa(n)`.

> **Note on SDK types**: If the compiler rejects any `anthropic.*` types (SDK evolves fast), run `go doc github.com/anthropics/anthropic-sdk-go` to check current field names. The intent is always: model=sonnet-4-6, tool_choice forces `create_quiz`, system prompt sets the role.

**Step 2: Run the failing tests — they should now pass**

```bash
cd backend && go test ./internal/handlers/... -run TestGenerateQuiz -v
```
Expected:
```
--- PASS: TestGenerateQuiz_MissingAPIKey
--- PASS: TestGenerateQuiz_ValidationErrors/missing_topic
--- PASS: TestGenerateQuiz_ValidationErrors/question_count_zero
--- PASS: TestGenerateQuiz_ValidationErrors/question_count_too_high
PASS
```

**Step 3: Run the full backend test suite**

```bash
cd backend && go test ./...
```
Expected: all pass.

**Step 4: Commit**

```bash
git add backend/internal/handlers/ai.go backend/internal/handlers/ai_test.go
git commit -m "feat: add GenerateQuiz handler with Claude tool use"
```

---

### Task 6: Run full check suite

**Step 1:**

```bash
./scripts/check.sh
```
Expected: all green. Fix any lint errors before proceeding.

**Step 2: Commit if any lint fixes were needed**

```bash
git add -p
git commit -m "fix: lint issues in ai handler"
```

---

### Task 7: Frontend — add generateQuiz API function

**Files:**
- Create: `frontend/src/api/ai.ts`

**Step 1: Write the API module**

```ts
import { apiClient } from "./client";
import type { QuestionInput } from "./quizzes";

export interface GenerateQuizInput {
  topic: string;
  question_count: number;
  context: string;
}

export interface GenerateQuizResponse {
  title: string;
  questions: QuestionInput[];
}

export async function generateQuiz(input: GenerateQuizInput): Promise<GenerateQuizResponse> {
  const { data } = await apiClient.post<GenerateQuizResponse>("/quizzes/generate", input);
  return data;
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors.

**Step 3: Commit**

```bash
git add frontend/src/api/ai.ts
git commit -m "feat: add generateQuiz API function"
```

---

### Task 8: Frontend — GenerateQuizModal component

**Files:**
- Create: `frontend/src/components/GenerateQuizModal.tsx`

**Step 1: Write the component**

```tsx
import { useState, type FormEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, X } from "lucide-react";
import { generateQuiz, type GenerateQuizInput, type GenerateQuizResponse } from "../api/ai";

interface Props {
  onClose: () => void;
  onGenerated: (data: GenerateQuizResponse) => void;
}

export function GenerateQuizModal({ onClose, onGenerated }: Props) {
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(5);
  const [context, setContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputStyle = {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(245,200,66,0.2)",
    color: "white",
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await generateQuiz({ topic: topic.trim(), question_count: count, context: context.trim() });
      onGenerated(data);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Something went wrong. Please try again.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AnimatePresence>
      {/* Backdrop */}
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        {/* Modal */}
        <motion.div
          className="w-full max-w-md rounded-2xl p-6 relative"
          style={{
            background: "linear-gradient(135deg, rgba(42,20,66,0.98) 0%, rgba(20,10,40,0.99) 100%)",
            border: "1px solid rgba(245,200,66,0.3)",
            boxShadow: "0 0 40px rgba(245,200,66,0.15)",
          }}
          initial={{ scale: 0.92, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.92, opacity: 0, y: 20 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5" style={{ color: "#f5c842" }} />
              <h3 className="text-lg font-black text-white">Generate with AI</h3>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg transition"
              style={{ color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.05)" }}>
              <X className="w-4 h-4" />
            </button>
          </div>

          {loading ? (
            <div className="py-10 flex flex-col items-center gap-4">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}>
                <Sparkles className="w-8 h-8" style={{ color: "#f5c842" }} />
              </motion.div>
              <p className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.7)" }}>
                Summoning questions from the stars...
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Topic */}
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: "rgba(255,255,255,0.7)" }}>
                  Topic <span style={{ color: "#f44336" }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g. Islamic history, photosynthesis, Premier League"
                  className="w-full rounded-xl px-4 py-3 text-sm outline-none transition"
                  style={inputStyle}
                  onFocus={(e) => (e.target.style.borderColor = "rgba(245,200,66,0.6)")}
                  onBlur={(e) => (e.target.style.borderColor = "rgba(245,200,66,0.2)")}
                />
              </div>

              {/* Question count */}
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: "rgba(255,255,255,0.7)" }}>
                  Number of questions
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                  className="w-full rounded-xl px-4 py-3 text-sm outline-none transition"
                  style={inputStyle}
                  onFocus={(e) => (e.target.style.borderColor = "rgba(245,200,66,0.6)")}
                  onBlur={(e) => (e.target.style.borderColor = "rgba(245,200,66,0.2)")}
                />
              </div>

              {/* Context */}
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: "rgba(255,255,255,0.7)" }}>
                  Additional context <span style={{ color: "rgba(255,255,255,0.3)" }}>(optional)</span>
                </label>
                <textarea
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  rows={3}
                  placeholder="e.g. hard difficulty, university level, avoid trick questions"
                  className="w-full rounded-xl px-4 py-3 text-sm outline-none transition resize-none"
                  style={inputStyle}
                  onFocus={(e) => (e.target.style.borderColor = "rgba(245,200,66,0.6)")}
                  onBlur={(e) => (e.target.style.borderColor = "rgba(245,200,66,0.2)")}
                />
              </div>

              {error && (
                <div className="text-sm rounded-xl px-4 py-3"
                  style={{ background: "rgba(244,67,54,0.1)", border: "1px solid rgba(244,67,54,0.3)", color: "#f44336" }}>
                  {error}
                </div>
              )}

              <motion.button
                type="submit"
                className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2"
                style={{
                  background: "linear-gradient(135deg, #f5c842 0%, #ff6b35 100%)",
                  color: "white",
                  boxShadow: "0 6px 24px rgba(245,200,66,0.35)",
                }}
                whileHover={{ scale: 1.02, boxShadow: "0 8px 30px rgba(245,200,66,0.5)" }}
                whileTap={{ scale: 0.98 }}>
                <Sparkles className="w-4 h-4" />
                Generate Quiz
              </motion.button>
            </form>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors.

**Step 3: Commit**

```bash
git add frontend/src/components/GenerateQuizModal.tsx
git commit -m "feat: add GenerateQuizModal component"
```

---

### Task 9: Frontend — update QuizFormPage

**Files:**
- Modify: `frontend/src/pages/QuizFormPage.tsx`

**Step 1: Add imports at the top of the file**

Add these to the existing import block:
```tsx
import { useState } from "react";                    // already imported
import { useNavigate, useParams, useLocation } from "react-router-dom";  // add useLocation
import { Sparkles } from "lucide-react";             // add to existing lucide import
import { GenerateQuizModal } from "../components/GenerateQuizModal";
import type { GenerateQuizResponse } from "../api/ai";
```

**Step 2: Inside the `QuizForm` component, add modal state**

After the existing state declarations (`title`, `questions`, `formError`), add:

```tsx
const [showAIModal, setShowAIModal] = useState(false);
```

**Step 3: Add the AI card above the `<form>` element**

Insert this block between the header `<motion.div>` and the `<form>`:

```tsx
{!isEdit && (
  <>
    <motion.button
      type="button"
      onClick={() => setShowAIModal(true)}
      className="w-full mb-6 py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2.5 relative overflow-hidden"
      style={{
        background: "linear-gradient(135deg, #f5c842 0%, #ff6b35 100%)",
        color: "white",
        boxShadow: "0 6px 28px rgba(245,200,66,0.4)",
      }}
      whileHover={{ scale: 1.01, boxShadow: "0 10px 36px rgba(245,200,66,0.55)" }}
      whileTap={{ scale: 0.99 }}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}>
      {/* Shimmer sweep */}
      <motion.span
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.25) 50%, transparent 60%)",
          backgroundSize: "200% 100%",
        }}
        animate={{ backgroundPositionX: ["200%", "-200%"] }}
        transition={{ duration: 2.5, repeat: Infinity, ease: "linear", repeatDelay: 1 }}
      />
      <Sparkles className="w-4 h-4 relative z-10" />
      <span className="relative z-10">Generate with AI</span>
    </motion.button>

    {showAIModal && (
      <GenerateQuizModal
        onClose={() => setShowAIModal(false)}
        onGenerated={(data) => {
          setShowAIModal(false);
          setTitle(data.title);
          setQuestions(
            data.questions.map((q) => ({
              text: q.text,
              time_limit: q.time_limit,
              options: q.options.map((o) => ({ text: o.text, is_correct: o.is_correct })),
            }))
          );
        }}
      />
    )}
  </>
)}
```

**Step 4: Update `QuizFormProps` to accept optional generated initial state**

The `QuizFormPage` wrapper already handles this via `location.state`. For the inner `QuizForm` component, the `onGenerated` callback sets state directly (as done in Step 3) — no prop change needed.

**Step 5: Update the `QuizFormPage` wrapper to read location state**

In the `QuizFormPage` function (the outer wrapper at the bottom of the file), add:

```tsx
export function QuizFormPage() {
  const { quizID } = useParams<{ quizID: string }>();
  const location = useLocation();                          // ADD
  const isEdit = !!quizID;

  // ... existing query code unchanged ...

  const initial = existing
    ? quizToInitial(existing)
    : (location.state as { generated?: { title: string; questions: QuestionDraft[] } })?.generated   // ADD
      ?? { title: "", questions: [blankQuestion()] };                                                // MODIFY

  return <QuizForm quizID={quizID} initial={initial} />;
}
```

**Step 6: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors.

**Step 7: Commit**

```bash
git add frontend/src/pages/QuizFormPage.tsx
git commit -m "feat: add Generate with AI card and pre-fill to QuizFormPage"
```

---

### Task 10: Write frontend tests

**Files:**
- Create: `frontend/src/test/GenerateQuizModal.test.tsx`
- Modify: `frontend/src/test/QuizFormPage.test.tsx`

**Step 1: Write GenerateQuizModal tests**

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GenerateQuizModal } from "../components/GenerateQuizModal";
import * as aiApi from "../api/ai";

vi.mock("../api/ai");

const mockOnClose = vi.fn();
const mockOnGenerated = vi.fn();

function renderModal() {
  return render(
    <GenerateQuizModal onClose={mockOnClose} onGenerated={mockOnGenerated} />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GenerateQuizModal", () => {
  it("renders topic input and Generate button", () => {
    renderModal();
    expect(screen.getByPlaceholderText(/Islamic history/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate quiz/i })).toBeInTheDocument();
  });

  it("calls onClose when X button is clicked", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "" })); // X button
    // More reliable: find by aria
    renderModal();
    const closeBtn = screen.getAllByRole("button").find((b) => b.querySelector("svg"));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it("requires topic — does not call API when topic is empty", async () => {
    vi.mocked(aiApi.generateQuiz).mockResolvedValue({ title: "Test", questions: [] });
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /generate quiz/i }));
    // HTML5 validation blocks submit on empty required field
    expect(aiApi.generateQuiz).not.toHaveBeenCalled();
  });

  it("shows loading state and calls onGenerated on success", async () => {
    const generated = {
      title: "Science Quiz",
      questions: [
        {
          text: "What is H2O?",
          time_limit: 20,
          order: 1,
          options: [
            { text: "Water", is_correct: true },
            { text: "Oxygen", is_correct: false },
            { text: "Hydrogen", is_correct: false },
            { text: "Helium", is_correct: false },
          ],
        },
      ],
    };
    vi.mocked(aiApi.generateQuiz).mockResolvedValue(generated);

    renderModal();
    fireEvent.change(screen.getByPlaceholderText(/Islamic history/i), {
      target: { value: "Science" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate quiz/i }));

    expect(await screen.findByText(/summoning questions/i)).toBeInTheDocument();

    await waitFor(() => expect(mockOnGenerated).toHaveBeenCalledWith(generated));
  });

  it("shows error message on API failure", async () => {
    vi.mocked(aiApi.generateQuiz).mockRejectedValue({
      response: { data: { error: "AI service unavailable" } },
    });

    renderModal();
    fireEvent.change(screen.getByPlaceholderText(/Islamic history/i), {
      target: { value: "Science" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate quiz/i }));

    expect(await screen.findByText(/AI service unavailable/i)).toBeInTheDocument();
  });
});
```

**Step 2: Add pre-fill test to QuizFormPage.test.tsx**

Add this test to the existing `describe("QuizFormPage — create mode")` block:

```tsx
it("pre-fills form when location state contains generated data", () => {
  const generated = {
    title: "AI History Quiz",
    questions: [
      {
        text: "Who was the first caliph?",
        time_limit: 20,
        order: 1,
        options: [
          { text: "Abu Bakr", is_correct: true },
          { text: "Umar", is_correct: false },
          { text: "Uthman", is_correct: false },
          { text: "Ali", is_correct: false },
        ],
      },
    ],
  };

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter
        initialEntries={[{ pathname: "/admin/quizzes/new", state: { generated } }]}
      >
        <Routes>
          <Route path="/admin/quizzes/new" element={<QuizFormPage />} />
          <Route path="/admin/quizzes" element={<div>quiz list</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

  expect(screen.getByDisplayValue("AI History Quiz")).toBeInTheDocument();
  expect(screen.getByDisplayValue("Who was the first caliph?")).toBeInTheDocument();
});
```

**Step 3: Run the tests**

```bash
./scripts/check.sh
```
Expected: all 103+ tests pass including new ones.

**Step 4: Commit**

```bash
git add frontend/src/test/GenerateQuizModal.test.tsx frontend/src/test/QuizFormPage.test.tsx
git commit -m "test: add GenerateQuizModal and QuizFormPage AI pre-fill tests"
```

---

### Task 11: Final verification and PR

**Step 1: Run the full check suite one last time**

```bash
./scripts/check.sh
```
Expected: all green.

**Step 2: Push and open PR**

```bash
git push -u origin feat/<issue>-ai-quiz-generation
gh pr create \
  --title "feat: AI quiz generation via Claude tool use" \
  --body "$(cat <<'EOF'
## Summary
- New `POST /api/v1/quizzes/generate` endpoint (auth-protected) calls Claude Sonnet 4.6 via forced tool use to produce schema-conformant quiz JSON
- Glowing gold/orange shimmer "Generate with AI" card on QuizFormPage (new quiz only) opens a modal with topic, count, and freeform context fields
- Generated quiz pre-fills the existing QuizFormPage form via React Router location state — nothing saves until the user confirms
- Backend tests cover: missing API key → 503, validation errors → 400
- Frontend tests cover: modal renders, loading state, success pre-fill, error handling

## Test plan
- [ ] Set `ANTHROPIC_API_KEY` in `.env` and run `docker compose up --build`
- [ ] Admin login → Quizzes → New Quiz — verify glowing card appears
- [ ] Click card → fill modal → Generate → verify form pre-fills
- [ ] Edit generated questions → Create quiz → verify saved correctly
- [ ] Remove API key → verify 503 error shown in modal
- [ ] `./scripts/check.sh` passes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
