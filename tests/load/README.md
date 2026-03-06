# Hilal — Load Testing Suite

k6-based load tests for the Hilal real-time quiz platform.

## Prerequisites

Install k6:

```bash
# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D68
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# Docker
docker pull grafana/k6
```

## Quick Start

```bash
# Start the dev environment
docker compose up --build -d

# Run the smoke test (CI-safe, ~30 seconds)
./tests/load/run.sh

# Run a specific scenario
./tests/load/run.sh mass-join
./tests/load/run.sh api
./tests/load/run.sh full-game

# Stress test
./tests/load/run.sh api stress
```

## Scenarios

| Scenario | Script | What It Tests | Default Load |
|---|---|---|---|
| `smoke` | `smoke.js` | API + full game flow (CI) | 1 game, 3 players, 2 questions |
| `mass-join` | `scenario-mass-join.js` | WS hub connection handling | 100 players, 1 session |
| `answers` | `scenario-answer-submission.js` | Game engine answer processing | 50 players, 5 questions |
| `full-game` | `scenario-full-game.js` | End-to-end concurrent games | 10 games, 5 players each |
| `api` | `scenario-api-throughput.js` | REST endpoint throughput | 50 VUs, 60 seconds |

## Profiles

Each scenario supports three profiles:

| Profile | Purpose | Scale |
|---|---|---|
| `smoke` | CI pipeline, sanity check | ~10% of default |
| `default` | Standard load testing | See scenario defaults above |
| `stress` | Find breaking points | ~5-10x default |

```bash
./tests/load/run.sh full-game smoke    # 2 games, 3 players
./tests/load/run.sh full-game          # 10 games, 5 players (default)
./tests/load/run.sh full-game stress   # 30 games, 20 players
```

## Performance Thresholds

### REST API

| Metric | Target |
|---|---|
| p50 latency | < 100ms |
| p95 latency | < 500ms |
| p99 latency | < 1000ms |
| Error rate | < 1% |

### WebSocket

| Metric | Target |
|---|---|
| Connection time (p95) | < 1000ms |
| Answer → Reveal (p95) | < 5000ms |

### Full Game

| Metric | Target |
|---|---|
| Game setup (p95) | < 5000ms |
| Total game duration (p95) | < 120s |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `BASE_URL` | `http://localhost:8081/api/v1` | Backend API base URL |
| `WS_URL` | `ws://localhost:8081/api/v1` | WebSocket base URL |

## File Structure

```
tests/load/
├── README.md                         # This file
├── run.sh                            # Test runner with profiles
├── helpers.js                        # Shared API helpers
├── smoke.js                          # CI smoke test
├── scenario-mass-join.js             # Mass player join
├── scenario-answer-submission.js     # Concurrent answer submission
├── scenario-full-game.js             # Full game simulation
└── scenario-api-throughput.js        # REST API throughput
```

## Running Against Production

```bash
BASE_URL=https://hilal-frontend.fly.dev/api/v1 \
WS_URL=wss://hilal-frontend.fly.dev/api/v1 \
./tests/load/run.sh smoke
```

**Warning**: Only run smoke tests against production. Never run stress tests against live infrastructure without coordination.

## Interpreting Results

k6 outputs a summary with metrics. Key things to look for:

- **http_req_duration**: API latency percentiles — compare against thresholds
- **ws_connect_duration**: Time to establish WebSocket connections
- **checks**: Pass rate — should be >95% for smoke, >90% for stress
- **http_req_failed**: Error rate — should be <1% for normal load
- **iterations**: Total completed test iterations — low count means bottleneck

If thresholds fail, k6 exits with code 99. CI can use this as a gate.

## Adding New Scenarios

1. Create `scenario-<name>.js` in this directory
2. Import helpers from `./helpers.js`
3. Define `options` with scenarios and thresholds
4. Add a case to `run.sh` with smoke/default/stress profiles
5. Update this README
