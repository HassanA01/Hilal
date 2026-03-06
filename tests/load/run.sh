#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────
# Hilal — k6 Load Test Runner
#
# Usage:
#   ./tests/load/run.sh [scenario] [profile]
#
# Scenarios:
#   smoke            Lightweight CI smoke test (default)
#   mass-join        100 players joining simultaneously
#   answers          50 concurrent answer submissions
#   full-game        10 concurrent full game simulations
#   api              REST API throughput test
#   all              Run all scenarios sequentially
#
# Profiles:
#   smoke            Minimal (CI-safe, ~30s)
#   default          Standard load (see per-scenario defaults)
#   stress           Push to breaking point
#
# Examples:
#   ./tests/load/run.sh                    # smoke test
#   ./tests/load/run.sh mass-join          # 100 players joining
#   ./tests/load/run.sh api stress         # stress test API
#   ./tests/load/run.sh all smoke          # all scenarios, smoke profile
#
# Environment:
#   BASE_URL   API base URL (default: http://localhost:8081/api/v1)
#   WS_URL     WebSocket URL (default: ws://localhost:8081/api/v1)
# ─────────────────────────────────────────────────────────

SCENARIO="${1:-smoke}"
PROFILE="${2:-default}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check k6 is installed
if ! command -v k6 &>/dev/null; then
  echo "ERROR: k6 is not installed."
  echo "Install: brew install k6  (macOS)"
  echo "         or see https://grafana.com/docs/k6/latest/set-up/install-k6/"
  exit 1
fi

export BASE_URL="${BASE_URL:-http://localhost:8081/api/v1}"
export WS_URL="${WS_URL:-ws://localhost:8081/api/v1}"

echo "═══════════════════════════════════════════════"
echo "  Hilal Load Test"
echo "  Scenario: ${SCENARIO} | Profile: ${PROFILE}"
echo "  API:      ${BASE_URL}"
echo "  WS:       ${WS_URL}"
echo "═══════════════════════════════════════════════"
echo ""

run_k6() {
  local script="$1"
  shift
  echo "▶ Running: ${script}"
  echo "  Args: $*"
  echo ""
  k6 run "$@" "${SCRIPT_DIR}/${script}"
  echo ""
  echo "────────────────────────────────────────────"
  echo ""
}

case "${SCENARIO}" in
  smoke)
    run_k6 smoke.js
    ;;

  mass-join)
    case "${PROFILE}" in
      smoke)
        run_k6 scenario-mass-join.js -e PLAYER_COUNT=10 -e RAMP_DURATION=5s
        ;;
      stress)
        run_k6 scenario-mass-join.js -e PLAYER_COUNT=500 -e RAMP_DURATION=30s
        ;;
      *)
        run_k6 scenario-mass-join.js
        ;;
    esac
    ;;

  answers)
    case "${PROFILE}" in
      smoke)
        run_k6 scenario-answer-submission.js -e PLAYER_COUNT=10 -e QUESTION_COUNT=3
        ;;
      stress)
        run_k6 scenario-answer-submission.js -e PLAYER_COUNT=200 -e QUESTION_COUNT=10
        ;;
      *)
        run_k6 scenario-answer-submission.js
        ;;
    esac
    ;;

  full-game)
    case "${PROFILE}" in
      smoke)
        run_k6 scenario-full-game.js -e CONCURRENT_GAMES=2 -e PLAYERS_PER_GAME=3 -e QUESTION_COUNT=2
        ;;
      stress)
        run_k6 scenario-full-game.js -e CONCURRENT_GAMES=30 -e PLAYERS_PER_GAME=20 -e QUESTION_COUNT=5
        ;;
      *)
        run_k6 scenario-full-game.js
        ;;
    esac
    ;;

  api)
    case "${PROFILE}" in
      smoke)
        run_k6 scenario-api-throughput.js -e VUS=5 -e DURATION=10s
        ;;
      stress)
        run_k6 scenario-api-throughput.js -e VUS=200 -e DURATION=120s
        ;;
      *)
        run_k6 scenario-api-throughput.js
        ;;
    esac
    ;;

  all)
    echo "Running all scenarios with profile: ${PROFILE}"
    echo ""
    "${0}" smoke "${PROFILE}"
    "${0}" api "${PROFILE}"
    "${0}" mass-join "${PROFILE}"
    "${0}" full-game "${PROFILE}"
    ;;

  *)
    echo "Unknown scenario: ${SCENARIO}"
    echo "Available: smoke, mass-join, answers, full-game, api, all"
    exit 1
    ;;
esac

echo "═══════════════════════════════════════════════"
echo "  Load test complete!"
echo "═══════════════════════════════════════════════"
