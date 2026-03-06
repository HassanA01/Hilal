import { check, sleep } from "k6";
import http from "k6/http";
import { Trend } from "k6/metrics";
import {
  BASE_URL,
  registerAdmin,
  createQuiz,
  createSession,
  joinSession,
} from "./helpers.js";

/*
 * Scenario: REST API Throughput
 *
 * Hammers the stateless HTTP endpoints to find throughput limits.
 * Tests: auth, quiz CRUD, session management, player join.
 * Does NOT test WebSocket or game engine (see other scenarios).
 *
 * Default: 50 VUs for 60 seconds.
 * Smoke:   5 VUs for 10 seconds.
 */

const VUS = __ENV.VUS ? parseInt(__ENV.VUS) : 50;
const DURATION = __ENV.DURATION || "60s";

export const options = {
  scenarios: {
    api_throughput: {
      executor: "constant-vus",
      vus: VUS,
      duration: DURATION,
    },
  },
  thresholds: {
    http_req_duration: ["p(50)<100", "p(95)<500", "p(99)<1000"],
    http_req_failed: ["rate<0.01"],
    "http_req_duration{endpoint:register}": ["p(95)<500"],
    "http_req_duration{endpoint:create_quiz}": ["p(95)<500"],
    "http_req_duration{endpoint:list_quizzes}": ["p(95)<200"],
    "http_req_duration{endpoint:create_session}": ["p(95)<500"],
    "http_req_duration{endpoint:join_session}": ["p(95)<300"],
  },
};

export default function () {
  // Register
  const email = `api-${__VU}-${__ITER}-${Date.now()}@test.com`;
  let res = http.post(
    `${BASE_URL}/auth/register`,
    JSON.stringify({ email, password: "loadtest1234" }),
    {
      headers: { "Content-Type": "application/json" },
      tags: { endpoint: "register" },
    }
  );
  check(res, { "register ok": (r) => r.status === 201 });
  if (res.status !== 201) return;

  const token = res.json().token;
  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  // Create quiz
  res = http.post(
    `${BASE_URL}/quizzes`,
    JSON.stringify({
      title: `API Test Quiz ${Date.now()}`,
      questions: [
        {
          text: "Question 1?",
          time_limit: 20,
          order: 1,
          options: [
            { text: "A", is_correct: true },
            { text: "B", is_correct: false },
            { text: "C", is_correct: false },
            { text: "D", is_correct: false },
          ],
        },
      ],
    }),
    { headers: authHeaders, tags: { endpoint: "create_quiz" } }
  );
  check(res, { "create quiz ok": (r) => r.status === 201 });
  if (res.status !== 201) return;

  const quizId = res.json().id;

  // List quizzes
  res = http.get(`${BASE_URL}/quizzes`, {
    headers: authHeaders,
    tags: { endpoint: "list_quizzes" },
  });
  check(res, { "list quizzes ok": (r) => r.status === 200 });

  // Get quiz
  res = http.get(`${BASE_URL}/quizzes/${quizId}`, {
    headers: authHeaders,
    tags: { endpoint: "get_quiz" },
  });
  check(res, { "get quiz ok": (r) => r.status === 200 });

  // Create session
  res = http.post(
    `${BASE_URL}/sessions`,
    JSON.stringify({ quiz_id: quizId }),
    { headers: authHeaders, tags: { endpoint: "create_session" } }
  );
  check(res, {
    "create session ok": (r) => r.status === 201 || r.status === 200,
  });
  if (res.status !== 201 && res.status !== 200) return;

  const code = res.json().code;

  // Join session as players
  for (let i = 0; i < 3; i++) {
    res = http.post(
      `${BASE_URL}/sessions/join`,
      JSON.stringify({ code, name: `p-${__VU}-${__ITER}-${i}` }),
      {
        headers: { "Content-Type": "application/json" },
        tags: { endpoint: "join_session" },
      }
    );
    check(res, { "join ok": (r) => r.status === 200 });
  }

  // List players
  const sessionId = res.json().session_id;
  res = http.get(`${BASE_URL}/sessions/${sessionId}/players`, {
    tags: { endpoint: "list_players" },
  });
  check(res, { "list players ok": (r) => r.status === 200 });

  // Small pause between iterations
  sleep(0.5);
}
