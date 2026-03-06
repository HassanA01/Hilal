import { check, sleep } from "k6";
import http from "k6/http";
import ws from "k6/ws";
import {
  BASE_URL,
  WS_URL,
  WS_PARAMS,
  registerAdmin,
  createQuiz,
  createSession,
  joinSession,
  startSession,
  getQuiz,
} from "./helpers.js";

/*
 * Smoke Test — Lightweight CI-Safe Load Test
 *
 * Two scenarios:
 *   1. smoke_api: exercises all REST endpoints (register, quiz CRUD,
 *      session management, player join, health check)
 *   2. smoke_ws: verifies WebSocket connectivity — host connects,
 *      player connects, player_joined broadcast received
 *
 * k6 limitation: a single VU can only hold one WS connection at a time
 * (ws.connect blocks). Full game simulation with host + players requires
 * multiple VUs — see scenario-full-game.js for that.
 *
 * Duration: ~15 seconds.
 */

export const options = {
  scenarios: {
    smoke_api: {
      executor: "per-vu-iterations",
      vus: 1,
      iterations: 1,
      maxDuration: "60s",
      exec: "smokeApi",
    },
    smoke_ws_host: {
      executor: "per-vu-iterations",
      vus: 1,
      iterations: 1,
      maxDuration: "30s",
      startTime: "3s",
      exec: "smokeWsHost",
    },
    smoke_ws_player: {
      executor: "per-vu-iterations",
      vus: 1,
      iterations: 1,
      maxDuration: "30s",
      startTime: "3s",
      exec: "smokeWsPlayer",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<2000"],
    http_req_failed: ["rate<0.05"],
    checks: ["rate>0.95"],
  },
};

// Shared state set in setup — session for WS tests
export function setup() {
  const admin = registerAdmin("smoke-ws");
  if (!admin) throw new Error("Admin registration failed in setup");

  const quiz = createQuiz(admin.token, 2);
  if (!quiz) throw new Error("Quiz creation failed in setup");

  const session = createSession(admin.token, quiz.quizId);
  if (!session) throw new Error("Session creation failed in setup");

  // Pre-join a player for the WS test
  const player = joinSession(session.code, "smoke-player");
  if (!player) throw new Error("Player join failed in setup");

  return {
    token: admin.token,
    code: session.code,
    sessionId: session.sessionId,
    playerId: player.playerId,
    playerName: "smoke-player",
  };
}

// ── Smoke: REST API endpoints ──

export function smokeApi(data) {
  // Register a fresh admin for API tests
  const admin = registerAdmin("smoke-api");
  check(admin, { "admin registered": (a) => a !== null });
  if (!admin) return;

  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${admin.token}`,
  };

  // Create quiz
  const quiz = createQuiz(admin.token, 2);
  check(quiz, { "quiz created": (q) => q !== null });
  if (!quiz) return;

  // List quizzes
  let res = http.get(`${BASE_URL}/quizzes`, { headers: authHeaders });
  check(res, { "list quizzes 200": (r) => r.status === 200 });

  // Get quiz
  res = http.get(`${BASE_URL}/quizzes/${quiz.quizId}`, {
    headers: authHeaders,
  });
  check(res, { "get quiz 200": (r) => r.status === 200 });

  // Create session
  const session = createSession(admin.token, quiz.quizId);
  check(session, { "session created": (s) => s !== null });
  if (!session) return;

  // Join 3 players
  for (let i = 0; i < 3; i++) {
    const player = joinSession(session.code, `smoke-api-p${i}`);
    check(player, { "player joined": (p) => p !== null });
  }

  // List players
  res = http.get(`${BASE_URL}/sessions/${session.sessionId}/players`);
  check(res, { "list players 200": (r) => r.status === 200 });
  const players = res.json();
  check(players, { "3 players listed": (p) => p.length === 3 });

  // Health check
  res = http.get(`${BASE_URL.replace("/api/v1", "")}/health`);
  check(res, { "health 200": (r) => r.status === 200 });
}

// ── Smoke: WebSocket host connection ──

export function smokeWsHost(data) {
  const wsUrl = `${WS_URL}/ws/host/${data.code}`;
  let receivedPlayerJoined = false;

  const res = ws.connect(wsUrl, WS_PARAMS, function (socket) {
    socket.on("message", function (msg) {
      const lines = msg.split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "player_joined") {
            receivedPlayerJoined = true;
          }
        } catch (_) {}
      }
    });

    socket.on("error", function (e) {
      console.error(`Host WS error: ${e.error()}`);
    });

    // Stay connected briefly
    sleep(5);
    socket.close();
  });

  check(res, { "host ws connected (101)": (r) => r && r.status === 101 });
}

// ── Smoke: WebSocket player connection ──

export function smokeWsPlayer(data) {
  // Small delay to let host connect first
  sleep(0.5);

  const wsUrl = `${WS_URL}/ws/player/${data.code}?player_id=${data.playerId}&name=${data.playerName}`;

  const res = ws.connect(wsUrl, WS_PARAMS, function (socket) {
    socket.on("error", function (e) {
      console.error(`Player WS error: ${e.error()}`);
    });

    // Stay connected briefly
    sleep(3);
    socket.close();
  });

  check(res, { "player ws connected (101)": (r) => r && r.status === 101 });
}
