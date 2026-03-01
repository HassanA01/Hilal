# Fly.io Deployment — Everything That Went Wrong (and Why)

First production deployment of Iftaroot (2026-03-01). This doc covers every obstacle hit in order, with the actual error, what it meant in plain English, and exactly what fixed it.

---

## Problem 1: `fly secrets set` with backslash line continuation broke

### What we tried
```bash
fly secrets set \
    JWT_SECRET="$(openssl rand -hex 32)" \
    REDIS_URL="rediss://..." \
    FRONTEND_URL="https://iftaroot-frontend.fly.dev" \
    PORT="8080" \
    --app iftaroot-backend
```

### The error
```
Error: the config for your app is missing an app name
(eval):2: command not found:
(eval):4: command not found:
(eval):5: command not found: --app
```

### What it meant (plain English)
The backslash (`\`) at the end of each line is supposed to tell the shell "this command continues on the next line." But zsh was treating each continuation line as a separate command, so `--app iftaroot-backend` ended up being parsed on its own — which isn't a valid command.

### Fix
Run it as a single line, or set each secret separately:
```bash
fly secrets set JWT_SECRET="..." -a iftaroot-backend
fly secrets set REDIS_URL="..." -a iftaroot-backend
```

---

## Problem 2: Postgres cluster wouldn't start (boot loop)

### The error (from `fly logs --app iftaroot-db`)
```
repmgrd | [ERROR] connection to database failed
connection to server at "7817660b255178.vm.iftaroot-db.internal" port 5433 failed: timeout expired
monitor | failed to open local connection: failed to connect to host=...: dial error (timeout: context deadline exceeded)
repmgrd | exit status 6
repmgrd | restarting in 5s [attempt 2]
```
Machine status: `state: error`, `3 total, 3 critical`

### What it meant (plain English)
Fly Postgres runs two processes inside the VM: the actual Postgres database, and a tool called `repmgrd` (replication manager) that monitors Postgres and handles failover. The `port 5433` timeout is the key clue: `repmgrd` uses port 5433 to talk to Postgres internally. If that port times out, Postgres itself never started.

The root cause here was likely a **Fly infrastructure glitch on the first cluster** rather than a memory issue — the second cluster created with the same `shared-cpu-1x` (256MB) size booted cleanly and has been running fine (all 3/3 checks passing). The first machine ID (`7817660b255178`) was simply broken from the start.

### Fix
Destroy the broken cluster and recreate it:
```bash
fly apps destroy iftaroot-db --yes
fly postgres create --name iftaroot-db --region iad --initial-cluster-size 1 --vm-size shared-cpu-1x --volume-size 1
```

The new cluster (machine `2873267f430908`) came up healthy on the same VM size.

---

## Problem 3: `fly postgres attach` said "no active leader found"

### The error
```
Error: no active leader found
```

### What it meant (plain English)
Before you can attach Postgres to an app, the cluster needs a healthy "primary" node (the leader). When we ran `fly postgres attach` right after creating the cluster, Postgres hadn't finished booting yet — so there was no leader to attach to. This was also happening because the VM was crashing (Problem 2), so it never got to the "healthy" state.

### Fix
This resolved itself once the Postgres cluster was recreated on a larger VM and fully started. We also discovered the attach had already partially succeeded on a previous attempt — Fly had set `DATABASE_URL` as a secret on the backend app, so the second attempt gave us:
```
Error: consumer app "iftaroot-backend" already contains a secret named DATABASE_URL
```
That's actually fine — it meant the attach worked the first time around.

---

## Problem 4: Backend crashed on boot — migrations directory not found

### The error (from `fly logs --app iftaroot-backend`)
```
failed to run migrations: failed to create migrator: failed to open source, "file://migrations": open .: no such file or directory
```

### What it meant (plain English)
The Go server looks for migration files using a *relative* path: `file://migrations`. A relative path means "look for a folder called `migrations` inside the current working directory."

In the production Docker container, we copy the migration files to `/migrations` (an absolute path at the root of the filesystem). But we never told the container what the "current working directory" should be. Without a `WORKDIR` set, the distroless container starts from an undefined directory — and there's no `migrations` folder there.

The `open .: no such file or directory` part is especially telling: even the current directory itself (`"."`) didn't exist as far as the process was concerned.

**The mismatch:**
- Code expected: `<current dir>/migrations`
- Dockerfile put files at: `/migrations`
- Current dir was: undefined/inaccessible

### Fix
Add `WORKDIR /` to the prod stage in `Dockerfile.backend`. This explicitly sets the current directory to `/` (the root), so `file://migrations` resolves to `/migrations` — exactly where the files were copied.

```dockerfile
FROM gcr.io/distroless/static:nonroot AS prod
WORKDIR /                                          # ← added this
COPY --from=builder /server /server
COPY --from=builder /app/migrations /migrations
```

**Why not just change the code to use `file:///migrations` (absolute path)?**
That would fix prod but break local dev — in the dev container the working directory is `/app`, so migrations are at `/app/migrations`. Using `WORKDIR /` keeps the relative path working in both environments.

---

## Problem 5: 401 Unauthorized during first deploy

### The error
```
WARN failed to release lease for machine 17810307f402d8 [app]: unauthorized
Error: error getting machine 17810307f402d8 from api: failed to get VM: unauthorized
WARN failed to set final release status after deployment failure: failed to update release (status 401)
```

### What it meant (plain English)
Fly returned "401 Unauthorized" when trying to manage the machine during deploy. This happened because we had rotated the CLI session token earlier in the session (`fly auth logout` + `fly auth login`), and the new session wasn't being picked up cleanly by flyctl in the current terminal. The deploy itself (building and pushing the image) succeeded — the failure was only in the machine management step after the image was already uploaded.

### Fix
Re-running `fly auth login` to get a fresh session, then redeploying. This wasn't fully conclusive — the machine also recovered on its own when started manually with `fly machine start`.

---

## Problem 6: Redis URL had a hidden newline in it

### The error (from `fly logs --app iftaroot-backend`)
```
failed to connect to redis: invalid redis URL: parse "rediss://default:AdjsAAIncDIwNTI1ODQwNGQwOGU0N2MyOTM5NTVlYTZi\n  ZWFkZGM3ZXAyNTU1MzI@sincere-cougar-55532.upstash.io:6379": net/url: invalid control character in URL
```

### What it meant (plain English)
When the Redis URL was set using `fly secrets set`, the terminal window was too narrow — it visually wrapped the long URL onto the next line. But **visual wrapping is not the same as a line break in the value**. The shell actually stored a literal newline character (`\n`) plus spaces in the middle of the URL.

You can see it right in the error: the URL is split with `\n  ` in the middle of the password. Go's URL parser rejected it because URLs can't contain newline characters.

This is a subtle problem because the terminal *looks* like it's on one line when you type it, but the stored value is corrupted.

### Fix
Re-set the secret as a guaranteed single line. Reconstructed the full password by joining the two halves visible in the error log:
- Part 1: `AdjsAAIncDIwNTI1ODQwNGQwOGU0N2MyOTM5NTVlYTZi`
- Part 2: `ZWFkZGM3ZXAyNTU1MzI`
- Full: `AdjsAAIncDIwNTI1ODQwNGQwOGU0N2MyOTM5NTVlYTZiZWFkZGM3ZXAyNTU1MzI`

```bash
fly secrets set REDIS_URL="rediss://default:AdjsAAIncDIwNTI1ODQwNGQwOGU0N2MyOTM5NTVlYTZiZWFkZGM3ZXAyNTU1MzI@sincere-cougar-55532.upstash.io:6379" -a iftaroot-backend
```

**Prevention:** Issue #25 tracks adding startup validation that catches malformed URLs (with control characters) before attempting to connect. This would have given us an immediate clear error instead of a confusing "invalid control character" deep in the Redis connection code.

---

## Problem 7: `fly auth token` is deprecated (and dangerous)

### What happened
The original deployment plan used `fly auth token` to get a token for GitHub Actions. The command still works but prints a deprecation warning, and outputs your **personal CLI session token** — not a scoped API token.

### Why it's a problem
- The session token has full access to your Fly account (not scoped to one app)
- It doesn't appear in the token management dashboard, so you can't revoke it easily
- It expires unpredictably when your CLI session rotates

Additionally, the token was accidentally pasted into this chat session (exposed in conversation history).

### Fix
Use scoped deploy tokens — one per app:
```bash
fly tokens create deploy -a iftaroot-backend   # → FLY_API_TOKEN_BACKEND
fly tokens create deploy -a iftaroot-frontend  # → FLY_API_TOKEN_FRONTEND
```

Deploy tokens are scoped to a single app, have configurable expiry, and are visible/revocable in the dashboard.

The CI workflow was also updated to use the correct secret names (`FLY_API_TOKEN_BACKEND` / `FLY_API_TOKEN_FRONTEND`) instead of a single `FLY_API_TOKEN`.

---

## Summary Table

| # | Error | Plain-English Cause | Fix |
|---|-------|---------------------|-----|
| 1 | `command not found: --app` | Backslash line continuation broke in zsh | Run as single line or one arg at a time |
| 2 | `port 5433: timeout expired` (Postgres boot loop) | First cluster was broken (Fly glitch); same size works fine on new cluster | Destroy and recreate the cluster |
| 3 | `no active leader found` | Postgres still starting (or crashing) when attach ran | Wait for healthy cluster; attach succeeded silently on first try |
| 4 | `open .: no such file or directory` | No `WORKDIR` in prod container; relative migrations path couldn't resolve | Add `WORKDIR /` to prod Dockerfile stage |
| 5 | `401 Unauthorized` during deploy | Stale CLI session token after logout/login | Re-authenticate; machine recovered on manual start |
| 6 | `invalid control character in URL` | Terminal line-wrap injected `\n` into Redis secret | Re-set secret as single unbroken line |
| 7 | `fly auth token` deprecated | Outputs personal session token, not a scoped deploy token | Use `fly tokens create deploy -a <app>` |
