# AI Quiz Generation — Design Doc

**Date:** 2026-03-02
**Status:** Approved

## Problem

Creating quizzes question-by-question is tedious. Admins should be able to describe a topic and have a full quiz generated instantly, then review and edit it before saving.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| AI integration layer | Backend (Go) | API key stays server-side |
| Generation style | Sync request/response | Simple v1; streaming is a clean upgrade path later |
| Structured output | Tool use (forced) | More reliable than "return JSON" prompting |
| Claude SDK | `anthropic-sdk-go` (official) | Built-in retries, typed errors, future streaming support |
| Save flow | Unchanged | Generate returns data only; existing `POST /api/v1/quizzes` saves |
| Button placement | QuizFormPage (new quiz) | User is already in creation mode; full-width card is mobile-friendly |
| Additional context | Freeform textarea | Flexible; no need to enumerate difficulty levels etc. |

## User Flow

```
QuizListPage
  → [ + New Quiz ]
  → QuizFormPage (blank)
      ┌─────────────────────────────────────┐
      │  ✦ Generate with AI  (glowing card) │
      └─────────────────────────────────────┘
      → GenerateQuizModal (topic, question count, context)
      → POST /api/v1/quizzes/generate
      → Loading state ("Summoning questions...")
      → QuizFormPage pre-filled with generated data
      → User edits freely
      → [ Create quiz ] → POST /api/v1/quizzes (unchanged)
```

## Backend

### New endpoint

```
POST /api/v1/quizzes/generate   (auth required)
```

Request:
```json
{
  "topic": "Islamic history",
  "question_count": 8,
  "context": "hard difficulty, university level"
}
```

Response (same shape as `createQuizRequest`, not saved to DB):
```json
{
  "title": "Islamic History Challenge",
  "questions": [
    {
      "text": "...",
      "time_limit": 20,
      "order": 1,
      "options": [
        { "text": "...", "is_correct": false },
        { "text": "...", "is_correct": false },
        { "text": "...", "is_correct": true },
        { "text": "...", "is_correct": false }
      ]
    }
  ]
}
```

### Structured output via Tool Use

Claude is called with a `create_quiz` tool definition that exactly mirrors the `createQuizRequest` schema. `tool_choice` is forced to `{type: "any", name: "create_quiz"}`. The tool input is extracted directly — no JSON parsing, no markdown stripping, guaranteed schema conformance.

Tool schema constraints:
- `questions` array length == `question_count`
- Each question has exactly 4 options
- Exactly 1 option has `is_correct: true`
- `time_limit` defaults to 20s per question

### Model & config

- Model: `claude-sonnet-4-6`
- Max tokens: 4096
- Request timeout: 30s
- New env var: `ANTHROPIC_API_KEY`

### Error handling

| Condition | HTTP response |
|---|---|
| Missing/invalid API key | 502 — "AI service misconfigured" |
| Claude rate limit / API error | 502 — "AI service unavailable, please try again" |
| Tool input fails validation | 502 — "AI returned invalid response, please try again" |
| Request timeout (30s) | 504 — "AI generation timed out, please try again" |

### Files changed (backend)

| File | Change |
|---|---|
| `backend/internal/config/config.go` | Add `AnthropicAPIKey string` |
| `backend/internal/handlers/handlers.go` | Add `anthropicClient` to Handler struct; register new route |
| `backend/internal/handlers/ai.go` | New — `GenerateQuiz` handler |
| `backend/go.mod` | Add `github.com/anthropics/anthropic-sdk-go` |
| `.env.example` | Add `ANTHROPIC_API_KEY=` |

## Frontend

### "Generate with AI" card (QuizFormPage)

Shown only on new quiz (not edit). Full-width glowing card at the top of the form:
- **Gradient**: `#f5c842` → `#ff6b35` (gold to orange)
- **Icon**: `Sparkles` from lucide-react
- **Animation**: looping shimmer sweep + subtle pulse glow on the border
- **Hover**: scale up + glow intensifies (Framer Motion)
- **Label**: "Generate with AI"
- **Mobile**: full-width, touch-friendly tap target

### GenerateQuizModal

Three fields:
1. **Topic** (required) — text input, placeholder: "e.g. Islamic history, photosynthesis, Premier League"
2. **Number of questions** (required) — number input, range 1–20, default 5
3. **Additional context** (optional) — textarea, placeholder: "e.g. hard difficulty, university level, avoid trick questions"

Loading state: branded animation ("Summoning questions from the stars ✦") with crescent icon — matches the Ramadan night sky aesthetic.

### Pre-fill flow

On successful generation:
```ts
navigate("/admin/quizzes/new", { state: { generated: data } })
```

`QuizFormPage` reads `location.state?.generated` on mount and uses it as initial form state. No new stores or routes needed.

### Files changed (frontend)

| File | Change |
|---|---|
| `frontend/src/pages/QuizFormPage.tsx` | Read `location.state?.generated`; render "Generate with AI" card (new quiz only) |
| `frontend/src/components/GenerateQuizModal.tsx` | New — modal with 3 fields + loading state |
| `frontend/src/api/ai.ts` | New — `generateQuiz(params)` using existing Axios client |

## Testing

- **Backend unit test** (`ai_test.go`): mock Anthropic client, test happy path + each error condition
- **Frontend**: `GenerateQuizModal` renders correctly, form validation, loading state
