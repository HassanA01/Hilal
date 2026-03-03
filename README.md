<p align="center">
  <img src="https://img.icons8.com/emoji/96/crescent-moon-emoji.png" width="80" alt="Hilal" />
</p>

<h1 align="center">Hilal</h1>

<p align="center">
  <strong>The free, open source alternative to Kahoot.</strong><br />
  A real-time multiplayer quiz game built for Ramadan — and beyond.
</p>

<p align="center">
  <a href="https://github.com/HassanA01/Hilal/stargazers"><img src="https://img.shields.io/github/stars/HassanA01/Hilal?style=flat&color=f5c842" alt="GitHub Stars" /></a>
  <a href="https://github.com/HassanA01/Hilal/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License" /></a>
  <a href="https://github.com/HassanA01/Hilal/actions/workflows/ci.yml"><img src="https://github.com/HassanA01/Hilal/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/HassanA01/Hilal/releases"><img src="https://img.shields.io/github/v/release/HassanA01/Hilal?color=f5c842" alt="Release" /></a>
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#tech-stack">Tech Stack</a> ·
  <a href="#self-hosting">Self-Hosting</a> ·
  <a href="docs/architecture.md">Architecture</a> ·
  <a href="#contributing">Contributing</a> ·
  <a href="#license">License</a>
</p>

---

<p align="center">
  <video src="https://github.com/user-attachments/assets/c1154945-29a0-4cb9-add6-bce1a2a1cecd" width="800" controls></video>
</p>

---

## Why Hilal?

Kahoot locks core features — unlimited players, AI quiz generation, advanced game modes — behind paid plans. Hilal gives you all of that for free, forever, with full source code you can self-host and customize.

Built with a Ramadan-first design language (crescent moons, golden tones, prayer arc transitions), but works for any quiz night, classroom, or team event.

## Features

- **Real-Time Gameplay** — WebSocket-powered. Every answer, score update, and reveal happens instantly across all connected players.
- **AI-Powered Quiz Generation** — Describe a topic and let AI build the questions. Review, edit, and launch in seconds.
- **Unlimited Players, Always Free** — No player caps, no paywalls, no feature gates.
- **Speed Scoring** — Faster correct answers earn more points. Every question reshuffles the leaderboard.
- **No Account Needed to Play** — Players join with a 6-digit code and a name. That's it.
- **Ramadan-Themed Design** — Prayer arc transitions, crescent moon motifs, and golden design tokens — built with intention, not as an afterthought.

## Quick Start

```bash
# Clone the repo
git clone https://github.com/HassanA01/Hilal.git
cd Hilal

# Copy environment variables
cp .env.example .env

# Start everything (backend, frontend, postgres, redis)
docker compose up --build
```

Open your browser:

| Role   | URL                          |
|--------|------------------------------|
| Admin  | http://localhost:5173        |
| Player | http://localhost:5173/join   |

## Tech Stack

| Layer     | Technology                                  |
|-----------|---------------------------------------------|
| Backend   | Go 1.24, Chi router, gorilla/websocket      |
| Frontend  | React 19, TypeScript, Vite 7, Tailwind v4   |
| Database  | PostgreSQL 16                               |
| Cache     | Redis 7 (game state + pub/sub)              |
| Auth      | JWT (admin-only, players are ephemeral)     |
| AI        | Claude API (quiz generation)                |
| Container | Docker + Docker Compose                     |

## Self-Hosting

Hilal runs entirely in Docker. The `docker-compose.yml` spins up all four services (backend, frontend, PostgreSQL, Redis) with hot-reload for development.

### Production

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

See [`.env.example`](.env.example) for all required environment variables. At minimum you'll need:

- `JWT_SECRET` — a strong random string for admin auth
- `ANTHROPIC_API_KEY` — for AI quiz generation (optional, feature degrades gracefully)

### Running Checks

```bash
# Run all checks (build, test, lint, typecheck) in Docker
./scripts/check.sh
```

## Contributing

Contributions are welcome! Here's the quick version:

1. Fork the repo and create a branch: `feat/<issue>-<description>` or `fix/<issue>-<description>`
2. Write tests for your changes
3. Run `./scripts/check.sh` — all checks must pass
4. Open a PR to `main`

See the [open issues](https://github.com/HassanA01/Hilal/issues) for things to work on.

## License

Hilal is open source under the [MIT License](LICENSE).
