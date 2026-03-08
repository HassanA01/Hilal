# Hilal — CLAUDE.md

Project-level context for Claude Code. Supplements the global CLAUDE.md.

## Stack

- **Backend**: Go 1.24, Chi router, gorilla/websocket, pgx/v5, go-redis/v9, golang-jwt
- **Frontend**: React 19, TypeScript, Vite 7, Tailwind CSS v4, Zustand, TanStack Query v5, React Router v7, Vitest
- **Database**: PostgreSQL 16 (schema versioned with golang-migrate)
- **Cache**: Redis 7 (game state + pub/sub)
- **Container**: Docker, Docker Compose

## Key Directories

```
backend/cmd/server/main.go        — entry point, server bootstrap
backend/internal/config/          — env var loading
backend/internal/db/              — DB pool, Redis client, migration runner
backend/internal/game/            — scoring algorithm, game state machine
backend/internal/hub/             — WebSocket hub (room/client management)
backend/internal/handlers/        — HTTP handlers + WebSocket upgrade
backend/internal/middleware/      — JWT auth middleware
backend/internal/models/          — domain types (Quiz, Question, GameSession…)
backend/migrations/               — SQL migration files (golang-migrate)
frontend/src/api/                 — Axios client, React Query client
frontend/src/hooks/               — useWebSocket, other custom hooks
frontend/src/stores/              — Zustand stores (auth, game state)
frontend/src/types/               — TypeScript interfaces (match backend models)
frontend/src/pages/               — route components
frontend/src/components/          — reusable UI components
```

## Common Commands

```bash
# Start full dev environment
docker compose up --build

# Run ALL checks (backend + frontend) — use this before every commit/PR
./scripts/check.sh

# Build for production
docker compose -f docker-compose.prod.yml build
```

## Pre-Push Checklist (MUST run before every commit)

```bash
./scripts/check.sh
```

This single script runs: backend build → backend test → backend lint → frontend typecheck → frontend lint → frontend test → frontend build. All inside Docker. Exit 0 = all green.

## Architecture Decisions

- **WebSocket hub is in-process** (single Go process). Redis is used for game state persistence, not clustering — but the architecture supports sharding later via Redis pub/sub.
- **Game state lives in Redis** keyed by `game:<sessionCode>:state`. This allows recovery after a backend restart.
- **Auth is admin-only**. Players are ephemeral — they join with a name, get a UUID stored in DB for the session, and use that UUID as their WebSocket identity (`?player_id=<uuid>`).
- **Migrations run on startup** in dev. In prod, run them as a separate step before deploying.
- **Tailwind v4** uses the `@tailwindcss/vite` plugin — no `tailwind.config.js` required. Import with `@import "tailwindcss"` in CSS.

## WebSocket Message Contract

All WS messages follow:
```json
{ "type": "<MessageType>", "payload": { ... } }
```

Message types are defined in:
- Backend: `backend/internal/hub/hub.go` (MessageType constants)
- Frontend: `frontend/src/types/index.ts` (MessageType union)

Keep these in sync when adding new message types.

## Game Flow (State Machine)

```
waiting → active → question_open → answer_reveal (3s) → leaderboard → next_question
                                                                          ↓ (after last question)
                                                                       game_over → podium
```

The state machine lives in `backend/internal/game/`. Each state transition is broadcast via the hub.

## Scoring

See `backend/internal/game/scoring.go`:
```go
points = BasePoints × max(0, 1 - elapsed/timeLimit)
BasePoints = 1000
```

## Environment Variables

See `.env.example` — copy to `.env` before starting.

## Branching

- `main` — production, always deployable, CI-protected
- `dev` — integration branch for next release. All feature/fix PRs target `dev`. Merge `dev` → `main` when stable.
- `feat/<issue>-<desc>` — features (branch from `dev`, PR into `dev`)
- `fix/<issue>-<desc>` — bug fixes (branch from `dev`, PR into `dev`)
- `chore/<desc>` — maintenance
