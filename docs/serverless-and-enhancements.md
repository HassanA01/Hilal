# Hilal — Serverless Feasibility & Engineering Enhancements

## Serverless Feasibility Analysis

### Components That CAN Go Serverless (~60-70% of Backend)

| Component | Current | Serverless Target | Effort |
|---|---|---|---|
| Auth (register/login) | Go HTTP handler | Lambda/Cloud Function | Low |
| Quiz CRUD (list/create/update/delete) | Go HTTP handler | Lambda/Cloud Function | Low |
| AI quiz generation | Go HTTP handler | Lambda (perfect fit — bursty, expensive, cold start OK) | Low |
| Player join | Go HTTP handler | Lambda | Low |
| Session CRUD (create/list/get) | Go HTTP handler | Lambda | Low |
| Player results | Go HTTP handler | Lambda | Low |
| DB migrations | Runs on startup | One-off Lambda / CI step | Low |
| Rate limiting | Redis sorted set | Already works with managed Redis | None |

### Components That CANNOT Go Serverless Easily (~30-40%)

| Component | Why Not | Workaround |
|---|---|---|
| **WebSocket hub** | Persistent connections, in-memory room state | AWS API Gateway WebSocket API + Lambda, but adds latency per message |
| **Game engine** | Stateful timers, phase transitions, goroutines | Externalize ALL state to Redis + use scheduled events for timers |
| **Answer submission flow** | Sub-second latency needed (scoring depends on speed) | API Gateway WS adds ~50-100ms per hop — may affect scoring fairness |

### Recommended Architecture: Hybrid

Serverless for all HTTP endpoints (auth, CRUD, AI generation) + a single lightweight container for the WebSocket game engine.

- CRUD traffic is bursty and scales to zero
- Real-time game engine stays on a small always-on instance (Fly.io machine, ECS task, or Cloud Run min-instance)
- Fully serverless with API Gateway WebSocket is *possible* but adds complexity and latency that hurts a speed-based scoring game

---

## Enhancement Roadmap

### Epic 1: Ship Quality & Reliability

Core engineering improvements that prevent production incidents and make debugging possible.

#### 1.1 Observability Stack
- Replace `log.Printf` with `log/slog` (structured JSON logging, Go 1.24 stdlib)
- Add request correlation IDs — propagate through HTTP handlers and WS messages
- Instrument key metrics: active WS connections, games in progress, answer submission latency, AI generation duration
- Export via OpenTelemetry to Grafana Cloud (free tier) or Datadog
- Add health check endpoint with dependency status (DB, Redis, AI service)

#### 1.2 AI Generation Resilience
- Add circuit breaker pattern for Claude API calls (fail fast when API is degraded)
- Queue AI generation requests — return 202 Accepted, notify via polling or WS when complete
- Cache generated quizzes by topic hash — offer cached result before making a new API call
- Add timeout and retry with backoff for AI API calls

#### 1.3 Load Testing
- Add `k6` or `vegeta` load test suite
- Scenarios to test:
  - 100 players joining a session simultaneously
  - 50 players submitting answers within 1 second
  - 10 concurrent active games
  - AI generation under concurrent requests
- Establish baseline performance numbers and breaking points
- Add load test to CI (lightweight smoke version)

#### 1.4 E2E Test Suite
- Add Playwright test suite covering the critical path:
  - Admin registers → creates quiz → starts session
  - Players join via code → play through all questions → see results
  - Admin views leaderboard → ends game
- Test edge cases: player disconnect mid-game, duplicate join attempts
- Run E2E in CI against Docker Compose environment

#### 1.5 WebSocket Auto-Reconnect
- Add exponential backoff reconnection logic to `useWebSocket` hook
- On reconnect: recover game state from Redis (state already persisted)
- Show "Reconnecting..." overlay UI instead of dead screen
- Handle stale client detection server-side (remove clients that fail pong)
- Test reconnection under network throttling (Chrome DevTools simulation)

---

### Epic 2: Product Quality

Features that differentiate Hilal from basic quiz tools and make admins want to use it repeatedly.

#### 2.1 Question Type Expansion
- Add `type` column to `questions` table (enum: `multiple_choice`, `true_false`, `image_choice`, `ordering`)
- True/False: 2 options, simplified UI
- Image-based: Store image URLs in question/option fields, render in game UI
- Ordering/ranking: Player arranges items in correct order, partial credit scoring
- Update AI generation to support new question types
- Update frontend question rendering to be polymorphic based on type

#### 2.2 Admin Analytics Dashboard
- New page: `/admin/analytics` with quiz performance overview
- Per-quiz metrics:
  - Question difficulty distribution (% correct per question)
  - Average response time per question
  - Player engagement: did players leave mid-game?
  - Score distribution histogram
- Per-question drill-down: which options were selected (bar chart)
- Data source: `game_answers` table (already captured — just needs queries + UI)
- Time range filtering (last 7 days, 30 days, all time)

#### 2.3 Quiz Templates & Question Bank
- New `question_bank` table: admin-owned reusable questions
- "Save to library" action on any question after quiz creation
- "Import from library" in quiz editor — search/filter personal questions
- "Duplicate quiz" action on dashboard
- Tag/category system for organizing banked questions

#### 2.4 Media Support in Questions
- Image upload for questions and options (S3/R2 storage, presigned URLs)
- Support image URLs in AI-generated quizzes
- Audio clip support for music/sound trivia
- Video embed support (YouTube/Vimeo URLs) for question context
- Image preview in quiz editor
- Responsive media rendering in game UI (mobile-friendly)

#### 2.5 Spectator Mode
- New WS connection type: `/ws/spectator/{code}` (read-only, no answer submission)
- Spectators see questions, timer, answer distribution, leaderboard
- Spectator count shown to host
- Great for classroom projectors and event screens
- No player UUID needed — anonymous view-only connection

---

### Epic 3: Scale & Architecture

Infrastructure improvements for when the platform has real concurrent usage.

#### 3.1 Horizontal Scaling (Distributed Hub)
- Move room membership from in-memory map to Redis
- Use Redis pub/sub for cross-pod message broadcasting
- Connection ID routing or sticky sessions as interim step
- Extract hub interface so implementation can be swapped (in-memory vs Redis-backed)
- Document migration path and rollback plan

#### 3.2 Database Optimization
- Add PgBouncer for connection pooling (pgx pool is process-local, doesn't survive pod scaling)
- Add read replica for analytics queries (don't block game writes with dashboard reads)
- Partition `game_answers` table by session_id (will be the largest table)
- Add `EXPLAIN ANALYZE` checks in CI for critical query paths
- Index tuning: composite indexes for common query patterns (e.g., answers by session+player)

#### 3.3 CDN & Edge Caching
- Put frontend static assets behind Cloudflare or CloudFront
- Add proper `Cache-Control` headers for immutable quiz data during active games
- Consider edge functions for auth token validation (reduce round-trips)
- Gzip/Brotli compression for API responses

#### 3.4 Event Sourcing for Game State
- Replace mutable game state with append-only event log
- Events: `GameStarted`, `QuestionBroadcast`, `AnswerSubmitted`, `RevealTriggered`, `ScoreCalculated`, `GameEnded`
- Use Redis Streams as event store
- Enables: game replay, audit trail, production debugging, analytics pipeline
- Rebuild current state by replaying events (snapshot + replay pattern)

---

### Epic 4: Product-Market Fit

Features that expand the platform's reach and use cases.

#### 4.1 Teams Mode
- Team creation during lobby phase (host assigns or players choose)
- Aggregate team scoring (sum or average of member scores)
- Team leaderboard alongside individual leaderboard
- Team chat during game (optional)
- New DB tables: `game_teams`, `game_team_members`

#### 4.2 Tournament Mode
- Multi-round bracket-style competitions
- Elimination or points-based progression
- Tournament lobby with round scheduling
- Cross-quiz tournaments (different quiz per round)
- Tournament results page with bracket visualization

#### 4.3 Internationalization (i18n)
- Arabic RTL support (on-brand for "Hilal" crescent branding)
- Frontend i18n framework (react-intl or i18next)
- Language selector in UI
- AI quiz generation in specified language
- RTL-aware Tailwind layout (already supported in v4)

#### 4.4 Progressive Web App (PWA)
- Service worker for offline quiz review (past results)
- "Add to Home Screen" prompt
- Push notifications for tournament updates
- Offline-first quiz editor (sync when online)

#### 4.5 Embeddable Widget
- `<iframe>` embed for running a quiz on any website
- Embed code generator for admins
- Configurable theme to match host site
- PostMessage API for score reporting to parent page

#### 4.6 LMS Integration
- Webhook system: POST scores to external URL on game completion
- Google Classroom integration (post assignment + grades)
- Canvas LMS grade passback (LTI 1.3)
- CSV export of results per session
- API key system for programmatic access
