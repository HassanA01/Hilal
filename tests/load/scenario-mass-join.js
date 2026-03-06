import { check, sleep } from "k6";
import ws from "k6/ws";
import { Counter, Trend } from "k6/metrics";
import {
  BASE_URL,
  WS_URL,
  WS_PARAMS,
  registerAdmin,
  createQuiz,
  createSession,
  joinSession,
} from "./helpers.js";

/*
 * Scenario: Mass Player Join
 *
 * Simulates many players joining a single game session simultaneously.
 * Tests the WebSocket hub's ability to handle concurrent connections
 * and the broadcast fan-out for player_joined messages.
 *
 * Default: 100 players joining over 10 seconds.
 * Smoke:   10 players joining over 5 seconds.
 */

const PLAYER_COUNT = __ENV.PLAYER_COUNT ? parseInt(__ENV.PLAYER_COUNT) : 100;
const RAMP_DURATION = __ENV.RAMP_DURATION || "10s";

export const options = {
  scenarios: {
    mass_join: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: RAMP_DURATION, target: PLAYER_COUNT },
        { duration: "10s", target: PLAYER_COUNT }, // hold
        { duration: "5s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1000"],
    ws_connect_duration: ["p(95)<1000"],
    join_api_duration: ["p(95)<500"],
  },
};

const joinApiDuration = new Trend("join_api_duration");
const wsConnectDuration = new Trend("ws_connect_duration");
const wsConnected = new Counter("ws_connections_established");
const playerJoinedReceived = new Counter("player_joined_messages");

// Setup: one admin creates a quiz and session, shared by all VUs.
export function setup() {
  const admin = registerAdmin("massjoin");
  if (!admin) throw new Error("Admin registration failed in setup");

  const quiz = createQuiz(admin.token, 3);
  if (!quiz) throw new Error("Quiz creation failed in setup");

  const session = createSession(admin.token, quiz.quizId);
  if (!session) throw new Error("Session creation failed in setup");

  return {
    token: admin.token,
    sessionId: session.sessionId,
    code: session.code,
  };
}

export default function (data) {
  const playerName = `player-${__VU}-${__ITER}`;

  // Join via REST API
  const joinStart = Date.now();
  const player = joinSession(data.code, playerName);
  joinApiDuration.add(Date.now() - joinStart);

  if (!player) return;

  // Connect via WebSocket
  const wsUrl = `${WS_URL}/ws/player/${data.code}?player_id=${player.playerId}&name=${playerName}`;

  const connectStart = Date.now();
  const res = ws.connect(wsUrl, WS_PARAMS, function (socket) {
    wsConnectDuration.add(Date.now() - connectStart);
    wsConnected.add(1);

    socket.on("message", function (msg) {
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === "player_joined") {
          playerJoinedReceived.add(1);
        }
      } catch (_) {
        // ignore non-JSON (pong, etc.)
      }
    });

    socket.on("error", function (e) {
      console.error(`WS error for ${playerName}: ${e.error()}`);
    });

    // Stay connected for a bit to receive player_joined broadcasts
    sleep(15);

    socket.close();
  });

  check(res, {
    "ws status 101": (r) => r && r.status === 101,
  });
}
