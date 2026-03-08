# Hilal — System Design

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              INTERNET                                           │
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                   │
                           HTTPS / WSS
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         Fly.io Edge (iad region)                                │
│                                                                                 │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                    Frontend Container (Nginx)                             │  │
│  │                    hilal-frontend.fly.dev :443                             │  │
│  │                                                                           │  │
│  │   ┌─────────────┐    ┌──────────────────┐    ┌───────────────────────┐   │  │
│  │   │ /           │    │ /api/*           │    │ /api/v1/ws/*          │   │  │
│  │   │ Static SPA  │    │ Reverse Proxy    │    │ WebSocket Proxy       │   │  │
│  │   │ (React app) │    │ → backend:8080   │    │ → backend:8080        │   │  │
│  │   └─────────────┘    └────────┬─────────┘    └───────────┬───────────┘   │  │
│  │                               │                          │               │  │
│  └───────────────────────────────┼──────────────────────────┼───────────────┘  │
│                                  │   Fly.io .internal DNS   │                   │
│                                  ▼                          ▼                   │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                     Backend Container (Go)                                │  │
│  │                     hilal-backend.internal :8080                           │  │
│  │                                                                           │  │
│  │   ┌──────────────────────────────────────────────────────────────────┐    │  │
│  │   │                        Chi Router                                │    │  │
│  │   │                                                                  │    │  │
│  │   │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌──────────┐  │    │  │
│  │   │  │ Auth       │  │ Quiz CRUD  │  │ Session    │  │ Player   │  │    │  │
│  │   │  │ Handlers   │  │ Handlers   │  │ Handlers   │  │ Handlers │  │    │  │
│  │   │  └────────────┘  └────────────┘  └────────────┘  └──────────┘  │    │  │
│  │   │                                                                  │    │  │
│  │   │  ┌────────────┐  ┌──────────────────────────────────────────┐   │    │  │
│  │   │  │ AI Generate│  │ WebSocket Upgrade Handler                │   │    │  │
│  │   │  │ Handler    │  │   /ws/host/{code}                        │   │    │  │
│  │   │  │            │  │   /ws/player/{code}?player_id&name       │   │    │  │
│  │   │  └─────┬──────┘  └──────────────┬───────────────────────────┘   │    │  │
│  │   │        │                        │                                │    │  │
│  │   └────────┼────────────────────────┼────────────────────────────────┘    │  │
│  │            │                        │                                     │  │
│  │            │              ┌─────────▼──────────┐                          │  │
│  │            │              │   WebSocket Hub     │                          │  │
│  │            │              │   (in-process)      │                          │  │
│  │            │              │                     │                          │  │
│  │            │              │  rooms: map[code]   │                          │  │
│  │            │              │    → set of clients  │                          │  │
│  │            │              │                     │                          │  │
│  │            │              │  Broadcast()        │                          │  │
│  │            │              │  BroadcastToHost()  │                          │  │
│  │            │              │  BroadcastToPlayers()│                         │  │
│  │            │              └─────────┬───────────┘                          │  │
│  │            │                        │                                     │  │
│  │            │              ┌─────────▼───────────┐                         │  │
│  │            │              │    Game Engine       │                         │  │
│  │            │              │                      │                         │  │
│  │            │              │  State machine:      │                         │  │
│  │            │              │  starting → question │                         │  │
│  │            │              │  → reveal → leader-  │                         │  │
│  │            │              │  board → next_q |    │                         │  │
│  │            │              │  game_over → podium  │                         │  │
│  │            │              │                      │                         │  │
│  │            │              │  Timers (goroutines) │                         │  │
│  │            │              │  Scoring calculator  │                         │  │
│  │            │              └──┬──────────────┬────┘                         │  │
│  │            │                 │              │                              │  │
│  └────────────┼─────────────────┼──────────────┼──────────────────────────────┘  │
│               │                 │              │                                 │
└───────────────┼─────────────────┼──────────────┼─────────────────────────────────┘
                │                 │              │
        ┌───────▼───────┐  ┌─────▼────┐  ┌──────▼──────┐
        │               │  │          │  │             │
        │  Claude API   │  │  Redis   │  │ PostgreSQL  │
        │  (Anthropic)  │  │  7       │  │ 16          │
        │               │  │          │  │             │
        │  - Haiku      │  │ Game     │  │ Persistent  │
        │    (guardrail)│  │ state    │  │ data:       │
        │  - Sonnet 4.6 │  │ cache    │  │             │
        │    (generate) │  │          │  │ - admins    │
        │               │  │ Answer   │  │ - quizzes   │
        │  Tool use for │  │ tracking │  │ - questions │
        │  structured   │  │          │  │ - options   │
        │  output       │  │ Rate     │  │ - sessions  │
        │               │  │ limiting │  │ - players   │
        └───────────────┘  │          │  │ - answers   │
                           │ TTL: 24h │  │             │
                           └──────────┘  └─────────────┘
```

## Request Flow: REST API

```
Browser                    Nginx                    Go Backend              PostgreSQL
  │                          │                          │                       │
  │  GET /api/v1/quizzes     │                          │                       │
  │ ─────────────────────────▶                          │                       │
  │  (Authorization: Bearer) │  proxy_pass              │                       │
  │                          │ ─────────────────────────▶                       │
  │                          │                          │                       │
  │                          │            JWT middleware │                       │
  │                          │            extracts      │                       │
  │                          │            admin_id      │                       │
  │                          │                          │  SELECT * FROM        │
  │                          │                          │  quizzes WHERE        │
  │                          │                          │  admin_id = $1        │
  │                          │                          │ ──────────────────────▶
  │                          │                          │                       │
  │                          │                          │◀──────────────────────│
  │                          │                          │  rows                 │
  │                          │◀─────────────────────────│                       │
  │◀─────────────────────────│  200 OK + JSON           │                       │
  │                          │                          │                       │
```

## Request Flow: WebSocket Game Session

```
Host Browser           Player Browser          Go Backend            Redis         PostgreSQL
     │                       │                      │                  │                │
     │  WS /ws/host/{code}   │                      │                  │                │
     │ ──────────────────────────────────────────────▶                  │                │
     │                       │     Upgrade to WS     │                  │                │
     │◀──────────────────────────────────────────────│                  │                │
     │                       │  Hub.JoinRoom(client) │                  │                │
     │                       │                      │                  │                │
     │                       │  WS /ws/player/{code} │                  │                │
     │                       │ ─────────────────────▶                  │                │
     │                       │◀─────────────────────│                  │                │
     │                       │     Upgrade to WS     │                  │                │
     │                       │                      │                  │                │
     │  ◀──── broadcast ─────│── player_joined ──── │                  │                │
     │                       │                      │                  │                │
     │  POST /sessions/{id}/start                   │                  │                │
     │ ──────────────────────────────────────────────▶                  │                │
     │                       │                      │                  │                │
     │                       │        engine.StartGame()                │                │
     │                       │                      │  LOAD questions   │                │
     │                       │                      │ ─────────────────────────────────▶│
     │                       │                      │◀─────────────────────────────────│
     │                       │                      │                  │                │
     │                       │                      │  SET game:X:state │                │
     │                       │                      │  SET game:X:questions              │
     │                       │                      │ ─────────────────▶                │
     │                       │                      │                  │                │
     │  ◀──── broadcast ─────│──── question ────────│  (3s delay)      │                │
     │                       │◀──── question ───────│                  │                │
     │                       │                      │                  │                │
     │                       │  answer_submitted    │                  │                │
     │                       │ ─────────────────────▶                  │                │
     │                       │                      │  HSET answers    │                │
     │                       │                      │ ─────────────────▶                │
     │  ◀── answer_count ────│──────────────────────│                  │                │
     │                       │                      │                  │                │
     │                       │      (timer expires or all answered)    │                │
     │                       │                      │                  │                │
     │                       │                      │  HGETALL answers │                │
     │                       │                      │ ─────────────────▶                │
     │                       │                      │◀─────────────────│                │
     │                       │                      │                  │                │
     │                       │                      │  CalculatePoints()                │
     │                       │                      │                  │                │
     │                       │                      │  INSERT answers  │                │
     │                       │                      │  UPDATE scores   │                │
     │                       │                      │ ─────────────────────────────────▶│
     │                       │                      │                  │                │
     │  ◀──── broadcast ─────│── answer_reveal ─────│                  │                │
     │                       │◀── answer_reveal ────│                  │                │
     │                       │                      │                  │                │
     │                       │      (3s delay)      │                  │                │
     │                       │                      │                  │                │
     │  ◀──── broadcast ─────│── leaderboard ───────│  query scores    │                │
     │                       │◀── leaderboard ──────│ ─────────────────────────────────▶│
     │                       │                      │                  │                │
     │  next_question (WS)   │                      │                  │                │
     │ ──────────────────────────────────────────────▶                  │                │
     │                       │      (repeat cycle or game_over)        │                │
     │                       │                      │                  │                │
```

## AI Quiz Generation Flow

```
Admin Browser              Go Backend                Redis              Claude API
     │                         │                       │                     │
     │  POST /quizzes/generate │                       │                     │
     │  { topic, context,      │                       │                     │
     │    question_count }     │                       │                     │
     │ ────────────────────────▶                       │                     │
     │                         │                       │                     │
     │                         │  Validate input       │                     │
     │                         │  (printable chars,    │                     │
     │                         │   length limits)      │                     │
     │                         │                       │                     │
     │                         │  ZRANGEBYSCORE        │                     │
     │                         │  ratelimit:ai:{admin} │                     │
     │                         │ ──────────────────────▶                     │
     │                         │◀──────────────────────│                     │
     │                         │  count < 5/hr? ✓      │                     │
     │                         │                       │                     │
     │                         │  Guardrail check ─────────────────────────▶│
     │                         │  (Haiku — cheap,      │     "Is this topic │
     │                         │   fast classification)│      safe? PASS or │
     │                         │                       │      FAIL"         │
     │                         │◀─────────────────────────────────────────── │
     │                         │  PASS ✓               │                     │
     │                         │                       │                     │
     │                         │  Generate quiz ───────────────────────────▶│
     │                         │  (Sonnet 4.6 — tool   │   create_quiz tool │
     │                         │   use, structured     │   with questions,  │
     │                         │   output)             │   options, correct │
     │                         │                       │   answers          │
     │                         │◀─────────────────────────────────────────── │
     │                         │                       │                     │
     │                         │  Validate structure   │                     │
     │                         │  (4 options each,     │                     │
     │                         │   exactly 1 correct)  │                     │
     │                         │                       │                     │
     │  200 OK                 │  ZADD ratelimit       │                     │
     │  { quiz JSON }         │ ──────────────────────▶                     │
     │◀────────────────────────│                       │                     │
     │                         │                       │                     │
     │  (admin reviews/edits,  │                       │                     │
     │   then POST /quizzes    │                       │                     │
     │   to persist)           │                       │                     │
```

## Docker Compose — Dev Environment

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Docker Compose Network (dev)                        │
│                                                                         │
│  ┌─────────────────┐   ┌─────────────────┐   ┌──────────────────────┐  │
│  │                 │   │                 │   │                      │  │
│  │   PostgreSQL    │   │     Redis       │   │    Backend (Go)      │  │
│  │   16-alpine     │   │    7-alpine     │   │    golang:1.24       │  │
│  │                 │   │                 │   │                      │  │
│  │   :5432         │   │   :6379         │   │    :8081             │  │
│  │   ↕ mapped      │   │   ↕ mapped      │   │    ↕ mapped          │  │
│  │   host :5434    │   │   host :6380    │   │    host :8081        │  │
│  │                 │   │                 │   │                      │  │
│  │   Volume:       │   │   No persist    │   │    Air hot-reload    │  │
│  │   pgdata        │   │                 │   │    ./backend mounted │  │
│  │                 │   │                 │   │                      │  │
│  │   Health:       │   │   Health:       │   │    Depends on:       │  │
│  │   pg_isready    │   │   redis-cli     │   │    postgres ✓        │  │
│  │                 │   │   ping          │   │    redis ✓            │  │
│  └─────────────────┘   └─────────────────┘   └──────────────────────┘  │
│          ▲                      ▲                   ▲                   │
│          │                      │                   │                   │
│          │         pgx/v5       │   go-redis/v9     │                   │
│          │         connection   │   connection      │                   │
│          └──────────────────────┴───────────────────┘                   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                                                                  │   │
│  │    Frontend (React + Vite)                                       │   │
│  │    node:23-alpine                                                │   │
│  │                                                                  │   │
│  │    :5173 ↕ mapped to host :5173                                  │   │
│  │                                                                  │   │
│  │    Vite dev server with proxy:                                   │   │
│  │      /api/*  → http://backend:8081  (reverse proxy)              │   │
│  │      /ws/*   → ws://backend:8081    (WebSocket proxy)            │   │
│  │                                                                  │   │
│  │    Hot module replacement (HMR)                                  │   │
│  │    ./frontend mounted as volume                                  │   │
│  │                                                                  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Production Architecture (Fly.io)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Fly.io — iad region                                  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                   hilal-frontend.fly.dev                                │  │
│  │                   (public, HTTPS enforced)                              │  │
│  │                                                                        │  │
│  │   ┌────────────────────────────────────────────────────────────────┐   │  │
│  │   │                     Nginx (:80 → :443)                         │   │  │
│  │   │                                                                │   │  │
│  │   │  location /              → serve /usr/share/nginx/html (SPA)   │   │  │
│  │   │  location /api/v1/ws/    → proxy hilal-backend.internal:8080   │   │  │
│  │   │                            (Upgrade: websocket)                │   │  │
│  │   │  location /api/          → proxy hilal-backend.internal:8080   │   │  │
│  │   │                                                                │   │  │
│  │   └────────────────────────────────────┬───────────────────────────┘   │  │
│  │                                        │                               │  │
│  └────────────────────────────────────────┼───────────────────────────────┘  │
│                                           │                                  │
│                              .internal private network                       │
│                                           │                                  │
│  ┌────────────────────────────────────────▼───────────────────────────────┐  │
│  │                   hilal-backend.internal:8080                          │  │
│  │                   (private, not publicly accessible)                    │  │
│  │                                                                        │  │
│  │   ┌──────────────────────────────────────────────────────────────┐     │  │
│  │   │                    Go Binary (distroless)                     │     │  │
│  │   │                                                              │     │  │
│  │   │  Chi Router + CORS + JWT Middleware                          │     │  │
│  │   │  WebSocket Hub (in-process, single machine)                  │     │  │
│  │   │  Game Engine (state machine + timers)                        │     │  │
│  │   │                                                              │     │  │
│  │   │  Health: GET /health (every 15s, 10s grace)                  │     │  │
│  │   │  Min machines: 1 (always-on for WS sessions)                 │     │  │
│  │   └──────────────┬───────────────────────────┬────────────────────┘     │  │
│  │                  │                           │                          │  │
│  └──────────────────┼───────────────────────────┼──────────────────────────┘  │
│                     │                           │                             │
│         ┌───────────▼─────────┐    ┌────────────▼──────────┐                 │
│         │   Fly Postgres      │    │   Fly Redis            │                 │
│         │   (managed)         │    │   (managed)            │                 │
│         │                     │    │                        │                 │
│         │   PostgreSQL 16     │    │   Redis 7              │                 │
│         │   Persistent vol.   │    │   Ephemeral            │                 │
│         └─────────────────────┘    └────────────────────────┘                 │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

                           │
              External     │
                           ▼
                ┌─────────────────────┐
                │   Anthropic API     │
                │   api.anthropic.com │
                │                     │
                │   Called from Go    │
                │   backend only      │
                └─────────────────────┘
```

## Data Flow Summary

```
┌──────────────────────────────────────────────────────────────────────┐
│                        DATA CLASSIFICATION                           │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │              PostgreSQL (persistent, source of truth)           │  │
│  │                                                                │  │
│  │  Admins ──┐                                                    │  │
│  │           ├── Quizzes ──── Questions ──── Options               │  │
│  │           │                                                    │  │
│  │           └── Game Sessions ──┬── Game Players                  │  │
│  │                               └── Game Answers (scores, times)  │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │              Redis (ephemeral, 24h TTL, fast access)            │  │
│  │                                                                │  │
│  │  game:{code}:state       → GameState JSON (phase, index, time) │  │
│  │  game:{code}:questions   → Cached question array               │  │
│  │  game:{code}:q{N}:answers → Hash { playerID: answer JSON }     │  │
│  │  ratelimit:ai:{adminID}  → Sorted set (sliding window)         │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │              Client-Side (browser)                              │  │
│  │                                                                │  │
│  │  localStorage   → JWT token + admin info (Zustand persist)     │  │
│  │  sessionStorage → player UUID (ephemeral per tab)              │  │
│  │  Zustand store  → active session code (in-memory)              │  │
│  │  React Query    → cached API responses (5min stale time)       │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## CI/CD Pipeline

```
Developer pushes to any branch
          │
          ▼
┌─────────────────────────────────────────────────────────┐
│                 GitHub Actions CI                        │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Backend (parallel)              Frontend        │    │
│  │                                  (parallel)      │    │
│  │  ┌──────────────┐               ┌────────────┐  │    │
│  │  │ golangci-lint │               │ ESLint     │  │    │
│  │  └──────┬───────┘               └─────┬──────┘  │    │
│  │         ▼                              ▼         │    │
│  │  ┌──────────────┐               ┌────────────┐  │    │
│  │  │ go test -race│               │ tsc check  │  │    │
│  │  └──────┬───────┘               └─────┬──────┘  │    │
│  │         ▼                              ▼         │    │
│  │  ┌──────────────┐               ┌────────────┐  │    │
│  │  │ go build     │               │ vitest     │  │    │
│  │  └──────────────┘               └─────┬──────┘  │    │
│  │                                        ▼         │    │
│  │                                  ┌────────────┐  │    │
│  │                                  │ vite build │  │    │
│  │                                  └────────────┘  │    │
│  └─────────────────────────────────────────────────┘    │
│                          │                               │
│                          ▼                               │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Docker Build Verification                       │    │
│  │  Build prod images (backend + frontend)          │    │
│  │  with Docker layer caching                       │    │
│  └──────────────────────┬──────────────────────────┘    │
│                          │                               │
│                          ▼                               │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Deploy (main branch only, all checks pass)      │    │
│  │                                                   │    │
│  │  flyctl deploy → hilal-backend (fly.backend.toml) │    │
│  │  flyctl deploy → hilal-frontend (fly.frontend.toml│)   │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Key Design Decisions

| Decision | Rationale |
|---|---|
| **In-process WebSocket hub** | Single Fly.io machine. Simpler than distributed pub/sub. Redis persistence allows recovery after restart. |
| **Redis for game state, Postgres for records** | Game state is ephemeral and needs sub-ms reads. Final scores persist to Postgres for history. |
| **Nginx reverse proxy in prod** | Single public endpoint. Backend never exposed directly. WebSocket upgrade handled cleanly. |
| **Vite proxy in dev** | No Nginx in dev. Vite handles both SPA serving and API/WS proxying. |
| **Admin-only auth, ephemeral players** | Players join with a name, get a UUID per session. No registration friction. UUID in sessionStorage (tab-scoped). |
| **AI guardrail (Haiku) before generation (Sonnet)** | Cheap classification prevents wasting expensive Sonnet calls on bad input. |
| **Scoring based on answer speed** | `points = 1000 × max(0, 1 - elapsed/timeLimit)`. Faster = more points. Stored in Redis during game, persisted to Postgres on reveal. |
| **Distroless prod image** | Minimal attack surface. No shell, no package manager. Non-root user. |
| **Min 1 backend machine** | WebSocket sessions can't survive machine shutdown. Always-on ensures active games aren't interrupted. |
