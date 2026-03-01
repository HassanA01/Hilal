# Fly.io Deployment + CD Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy Iftaroot to Fly.io and add a GitHub Actions CD job that automatically deploys every push to `main` after all CI checks pass.

**Architecture:** Two Fly.io apps (backend Go binary + frontend nginx) communicate over Fly's private `.internal` network. Backend is not publicly exposed — all traffic enters through the frontend nginx which proxies `/api/*` and WebSocket upgrades to the backend. Fly Postgres + Upstash Redis provide managed data stores.

**Tech Stack:** Fly.io (flyctl), GitHub Actions, nginx, Docker multi-stage build, Go 1.24, React/Vite, PostgreSQL 16, Redis 7

---

## Pre-Implementation: One-Time Manual Setup

> **Do this once before the first deploy. These steps are NOT automated by CI/CD.**

```bash
# 1. Install flyctl
brew install flyctl

# 2. Authenticate
fly auth login

# 3. Create Fly Postgres (shared-cpu-1x is fine — 256MB works for single-node postgres-flex)
fly postgres create --name iftaroot-db --region iad --initial-cluster-size 1 --vm-size shared-cpu-1x --volume-size 1

# 4. Create the two apps
fly apps create iftaroot-backend
fly apps create iftaroot-frontend

# 5. Attach Postgres to backend (auto-sets DATABASE_URL secret)
fly postgres attach iftaroot-db --app iftaroot-backend

# 6. Sign up at https://upstash.com → create a Redis database (free tier)
#    Copy the Redis connection string (it looks like rediss://...)

# 7. Set backend secrets — set each on its own line to avoid shell line-wrap corruption
#    (multiline backslash continuation breaks in zsh and can corrupt secret values)
fly secrets set JWT_SECRET="$(openssl rand -hex 32)" -a iftaroot-backend
fly secrets set REDIS_URL="rediss://default:<password>@<host>.upstash.io:6379" -a iftaroot-backend
fly secrets set FRONTEND_URL="https://iftaroot-frontend.fly.dev" -a iftaroot-backend
fly secrets set PORT="8080" -a iftaroot-backend

# 8. Create scoped deploy tokens for GitHub Actions (one per app)
fly tokens create deploy -a iftaroot-backend
# → Copy output. Add to GitHub repo secrets as: FLY_API_TOKEN_BACKEND

fly tokens create deploy -a iftaroot-frontend
# → Copy output. Add to GitHub repo secrets as: FLY_API_TOKEN_FRONTEND
#
# Via CLI: gh secret set FLY_API_TOKEN_BACKEND --body "<token>"
#          gh secret set FLY_API_TOKEN_FRONTEND --body "<token>"
```

---

## Task 1: Fix nginx.conf — WebSocket proxy + Fly internal DNS

**Files:**
- Modify: `nginx.conf`

The nginx `/api/` location currently points to `http://backend:8080` (docker-compose DNS). On Fly.io, the backend is reachable at `iftaroot-backend.internal:8080`. Also, WebSocket connections use the path `/api/v1/ws/...` (not `/ws/`), so we need a specific location block with upgrade headers.

**Step 1: Update nginx.conf**

Replace the entire file with:

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # WebSocket upgrade — must come BEFORE the /api/ block (more specific wins)
    location /api/v1/ws/ {
        proxy_pass http://iftaroot-backend.internal:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # REST API proxy
    location /api/ {
        proxy_pass http://iftaroot-backend.internal:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Key changes:
- `http://backend:8080` → `http://iftaroot-backend.internal:8080` (Fly private DNS)
- Removed unused `/ws/` block
- Added specific `/api/v1/ws/` block with WebSocket upgrade headers + 1hr timeouts
- Added `X-Forwarded-*` headers to REST block for correct IP forwarding

**Step 2: Verify nginx config parses correctly (optional local check)**

```bash
docker run --rm -v $(pwd)/nginx.conf:/etc/nginx/conf.d/default.conf:ro nginx:alpine nginx -t
```

Expected: `nginx: configuration file /etc/nginx/nginx.conf test is successful`

**Step 3: Commit**

```bash
git add nginx.conf
git commit -m "fix(nginx): route WS upgrades via /api/v1/ws/ and switch to Fly internal DNS"
```

---

## Task 2: Update Dockerfile.frontend — accept VITE_WS_BASE_URL as build arg

**Files:**
- Modify: `Dockerfile.frontend`

Vite bakes `VITE_*` env vars into the JS bundle at build time. For production, `VITE_WS_BASE_URL` must be `wss://iftaroot-frontend.fly.dev` so WebSocket connections go through nginx (which then proxies to backend via `.internal`). The value is passed as a Docker build arg.

**Step 1: Update the builder stage in Dockerfile.frontend**

Current builder stage (lines 13-20):
```dockerfile
FROM node:23-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ .
RUN pnpm build
```

Replace with:
```dockerfile
FROM node:23-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ .
ARG VITE_WS_BASE_URL
ENV VITE_WS_BASE_URL=$VITE_WS_BASE_URL
RUN pnpm build
```

The `ARG` makes Docker accept the build argument. `ENV` exposes it to the `pnpm build` process so Vite picks it up.

**Step 2: Verify the dev stage is unaffected**

The dev stage runs `pnpm dev` which reads env vars at runtime from the mounted `.env` file — not affected by this change.

**Step 3: Commit**

```bash
git add Dockerfile.frontend
git commit -m "feat(docker): accept VITE_WS_BASE_URL as build arg in frontend prod stage"
```

---

## Task 3: Create fly.backend.toml

**Files:**
- Create: `fly.backend.toml`

This is the Fly.io app configuration for the Go backend. The backend is deployed as an internal-only service (no public HTTPS — it's accessed only via the frontend nginx proxy over the private network).

**Step 1: Create fly.backend.toml**

```toml
# Fly.io configuration for the Go backend
# Deploy with: flyctl deploy --config fly.backend.toml
app = "iftaroot-backend"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile.backend"
  target = "prod"

[env]
  PORT = "8080"

# Backend is reachable at iftaroot-backend.fly.dev (force_https=false, no redirect)
# Primary access is via the frontend nginx proxy over Fly's private .internal network
[http_service]
  internal_port = 8080
  force_https = false
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1  # keep alive — WebSocket game sessions can't survive machine restarts

[[http_service.checks]]
  grace_period = "10s"
  interval = "15s"
  method = "GET"
  path = "/health"
  protocol = "http"
  timeout = "5s"

[[vm]]
  memory = "256mb"
  cpu_kind = "shared"
  cpus = 1
```

**Step 2: Commit**

```bash
git add fly.backend.toml
git commit -m "feat(fly): add fly.backend.toml for Go backend deployment"
```

---

## Task 4: Create fly.frontend.toml

**Files:**
- Create: `fly.frontend.toml`

This is the Fly.io app configuration for the frontend nginx. This app IS publicly accessible and handles HTTPS termination. It passes `VITE_WS_BASE_URL` as a build arg so Vite bakes the correct WebSocket URL into the production bundle.

**Step 1: Create fly.frontend.toml**

```toml
# Fly.io configuration for the React/nginx frontend
# Deploy with: flyctl deploy --config fly.frontend.toml
app = "iftaroot-frontend"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile.frontend"
  target = "prod"
  [build.args]
    VITE_WS_BASE_URL = "wss://iftaroot-frontend.fly.dev"

[http_service]
  internal_port = 80
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  memory = "256mb"
  cpu_kind = "shared"
  cpus = 1
```

**Why `wss://iftaroot-frontend.fly.dev`?** The frontend pages construct WebSocket URLs as `${WS_BASE}/api/v1/ws/...`. Setting `WS_BASE` to the frontend domain means the WS connection hits the nginx proxy, which has a `/api/v1/ws/` location block that handles the upgrade and forwards to the backend.

**Step 2: Commit**

```bash
git add fly.frontend.toml
git commit -m "feat(fly): add fly.frontend.toml for nginx/React frontend deployment"
```

---

## Task 5: Add deploy job to ci.yml

**Files:**
- Modify: `.github/workflows/ci.yml`

Add a `deploy` job at the end of ci.yml that:
- Runs ONLY on push to `main` (not on PRs or other branches)
- Only starts after all CI jobs pass (`needs` all existing jobs)
- Deploys backend first, then frontend
- Uses `FLY_API_TOKEN_BACKEND` and `FLY_API_TOKEN_FRONTEND` secrets (scoped deploy tokens, one per app)

**Step 1: Add the deploy job at the end of .github/workflows/ci.yml**

Append this after the `docker-build` job (after line 173):

```yaml
  # ── Deploy ─────────────────────────────────────────────────────────────────
  deploy:
    name: Deploy to Fly.io
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    needs:
      - backend-lint
      - backend-test
      - backend-build
      - frontend-lint
      - frontend-typecheck
      - frontend-test
      - frontend-build
      - docker-build
    concurrency:
      group: deploy-production
      cancel-in-progress: false

    steps:
      - uses: actions/checkout@v4

      - name: Set up flyctl
        uses: superfly/flyctl-actions/setup-flyctl@v1.5

      - name: Deploy backend
        run: flyctl deploy --remote-only --config fly.backend.toml
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN_BACKEND }}

      - name: Deploy frontend
        run: flyctl deploy --remote-only --config fly.frontend.toml
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN_FRONTEND }}
```

Notes:
- `if: github.ref == 'refs/heads/main' && github.event_name == 'push'` — guards against running on PRs (which also target main)
- `concurrency.cancel-in-progress: false` — if two pushes land quickly, the second waits rather than cancelling an in-flight deploy
- `--remote-only` — builds happen on Fly's remote builder, not in CI (saves GitHub Actions minutes and avoids Docker-in-Docker complexity)

**Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add Fly.io deploy job gated on all CI checks passing"
```

---

## Task 6: Update .env.example

**Files:**
- Modify: `.env.example`

Document the production environment variables and what needs to be set as Fly.io secrets vs. local env.

**Step 1: Update .env.example**

Replace current content with:

```bash
# ── PostgreSQL (local dev only — Fly.io uses Fly Postgres managed service) ──
POSTGRES_USER=iftaroot
POSTGRES_PASSWORD=changeme
POSTGRES_DB=iftaroot

# ── Backend ────────────────────────────────────────────────────────────────
# Local dev: postgres:// with docker-compose service name
# Fly.io prod: automatically set by `fly postgres attach` (postgres:// format)
DATABASE_URL=postgres://iftaroot:changeme@postgres:5432/iftaroot?sslmode=disable

# Local dev: redis:// with docker-compose service name
# Fly.io prod: set via `fly secrets set REDIS_URL=rediss://...` (Upstash URL)
REDIS_URL=redis://redis:6379

# Must be ≥32 random characters in production
# Generate with: openssl rand -hex 32
JWT_SECRET=change-me-in-production

PORT=8081

# Local dev: Vite dev server URL
# Fly.io prod: https://iftaroot-frontend.fly.dev
FRONTEND_URL=http://localhost:5173

# ── Frontend (VITE_ prefix exposes to browser bundle) ─────────────────────
# These are baked into the JS bundle at build time by Vite.
# VITE_API_BASE_URL is unused (client.ts uses relative /api/v1 path).
# VITE_WS_BASE_URL is set via fly.frontend.toml [build.args] for Fly deploys.
VITE_API_BASE_URL=http://localhost:8081/api/v1
VITE_WS_BASE_URL=ws://localhost:8081

# ── GitHub Actions Secrets (NOT in .env — set via gh secret set) ─────────
# FLY_API_TOKEN_BACKEND  — from `fly tokens create deploy -a iftaroot-backend`
# FLY_API_TOKEN_FRONTEND — from `fly tokens create deploy -a iftaroot-frontend`
```

**Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: document production env vars and Fly.io secrets setup"
```

---

## Task 7: First Manual Deploy

> **Do this after all code changes are committed and pushed to main.**

```bash
# From the repo root

# Deploy backend first (so it's available when frontend nginx tries to proxy)
flyctl deploy --config fly.backend.toml

# Deploy frontend
flyctl deploy --config fly.frontend.toml
```

Watch the output for any errors. First deploy may take 2-3 minutes.

---

## Verification

After the first deploy:

**1. Test frontend is reachable:**
```bash
curl -I https://iftaroot-frontend.fly.dev
# Expected: HTTP/2 200
```

**2. Test API proxy:**
```bash
curl https://iftaroot-frontend.fly.dev/api/v1/health
# Expected: JSON response from Go backend (proxied through nginx)
```

**2b. Test backend health directly:**
```bash
curl https://iftaroot-backend.fly.dev/health
# Expected: 200 OK
```

**3. Test WebSocket (browser):**
- Open https://iftaroot-frontend.fly.dev in a browser
- Open DevTools → Network tab → filter by "WS"
- Start or join a game
- Expected: WebSocket connection shows status 101 (Switching Protocols)
- Verify messages flow (player_joined, etc.)

**4. Test CD pipeline:**
```bash
# Push any trivial change to main (e.g., a comment in CLAUDE.md)
git commit --allow-empty -m "chore: test CD pipeline"
git push origin main
```
- Go to GitHub → Actions → watch the CI workflow
- After all CI jobs pass, the `Deploy to Fly.io` job should start
- Expected: backend deploy then frontend deploy complete successfully

---

## Troubleshooting

**Backend not reachable from nginx:**
```bash
fly logs --app iftaroot-backend
# Check for startup errors (DB connection, migration failures)
```

**WebSocket connections failing:**
- Verify the nginx `/api/v1/ws/` location block is in place (Task 1)
- Check that `VITE_WS_BASE_URL` is `wss://iftaroot-frontend.fly.dev` in the deployed bundle:
  - DevTools → Sources → search for `iftaroot-frontend.fly.dev`

**Deploy job not triggered:**
- Verify `FLY_API_TOKEN_BACKEND` and `FLY_API_TOKEN_FRONTEND` secrets exist in GitHub repo settings
- Check the `if:` condition in the deploy job — it only runs on `push` to `main`, not PRs

**Fly machine quota exceeded (free tier limit):**
```bash
fly apps list  # check how many apps exist
fly machines list --app iftaroot-backend  # check machine count
```
Free tier allows 3 shared-cpu-1x machines. With 2 apps (backend + frontend = 2 machines) you're within limits.
