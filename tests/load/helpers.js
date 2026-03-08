import http from "k6/http";
import { check } from "k6";

export const BASE_URL =
  __ENV.BASE_URL || "http://localhost:8081/api/v1";
export const WS_URL =
  __ENV.WS_URL || "ws://localhost:8081/api/v1";
// Origin header required by the WS upgrader (must match FRONTEND_URL)
export const WS_ORIGIN =
  __ENV.WS_ORIGIN || "http://localhost:5173";
export const WS_PARAMS = {
  headers: { Origin: __ENV.WS_ORIGIN || "http://localhost:5173" },
};

/**
 * Register a new admin and return { token, adminId }.
 * Uses a unique email per VU + iteration to avoid conflicts.
 */
export function registerAdmin(tag) {
  const vu = typeof __VU !== "undefined" ? __VU : 0;
  const iter = typeof __ITER !== "undefined" ? __ITER : 0;
  const email = `loadtest-${tag}-${vu}-${iter}-${Date.now()}@test.com`;
  const res = http.post(
    `${BASE_URL}/auth/register`,
    JSON.stringify({ email, password: "loadtest1234" }),
    { headers: { "Content-Type": "application/json" } }
  );
  check(res, {
    "register 201": (r) => r.status === 201,
  });
  if (res.status !== 201) {
    console.error(`register failed: ${res.status} ${res.body}`);
    return null;
  }
  const body = res.json();
  return { token: body.token, adminId: body.admin.id };
}

/**
 * Create a quiz with the given number of questions.
 * Returns { quizId }.
 */
export function createQuiz(token, questionCount) {
  const questions = [];
  for (let i = 0; i < questionCount; i++) {
    questions.push({
      text: `Load test question ${i + 1}?`,
      time_limit: 30,
      order: i + 1,
      options: [
        { text: "Correct answer", is_correct: true },
        { text: "Wrong answer A", is_correct: false },
        { text: "Wrong answer B", is_correct: false },
        { text: "Wrong answer C", is_correct: false },
      ],
    });
  }

  const res = http.post(
    `${BASE_URL}/quizzes`,
    JSON.stringify({ title: `Load Test Quiz ${Date.now()}`, questions }),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    }
  );
  check(res, {
    "create quiz 201": (r) => r.status === 201,
  });
  if (res.status !== 201) {
    console.error(`create quiz failed: ${res.status} ${res.body}`);
    return null;
  }
  return { quizId: res.json().id };
}

/**
 * Create a game session for a quiz.
 * Returns { sessionId, code }.
 */
export function createSession(token, quizId) {
  const res = http.post(
    `${BASE_URL}/sessions`,
    JSON.stringify({ quiz_id: quizId }),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    }
  );
  check(res, {
    "create session 201": (r) => r.status === 201 || r.status === 200,
  });
  if (res.status !== 201 && res.status !== 200) {
    console.error(`create session failed: ${res.status} ${res.body}`);
    return null;
  }
  const body = res.json();
  return { sessionId: body.session_id, code: body.code };
}

/**
 * Join a session as a player.
 * Returns { playerId, sessionId }.
 */
export function joinSession(code, name) {
  const res = http.post(
    `${BASE_URL}/sessions/join`,
    JSON.stringify({ code, name }),
    { headers: { "Content-Type": "application/json" } }
  );
  check(res, {
    "join session 200": (r) => r.status === 200,
  });
  if (res.status !== 200) {
    console.error(`join failed: ${res.status} ${res.body}`);
    return null;
  }
  const body = res.json();
  return { playerId: body.player_id, sessionId: body.session_id };
}

/**
 * Start a game session.
 */
export function startSession(token, sessionId) {
  const res = http.post(
    `${BASE_URL}/sessions/${sessionId}/start`,
    null,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  check(res, {
    "start session 200": (r) => r.status === 200,
  });
  if (res.status !== 200) {
    console.error(`start failed: ${res.status} ${res.body}`);
  }
  return res;
}

/**
 * Fetch a quiz by ID (to get question/option IDs for answer submission).
 * Returns the full quiz object with questions and options.
 */
export function getQuiz(token, quizId) {
  const res = http.get(`${BASE_URL}/quizzes/${quizId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  check(res, {
    "get quiz 200": (r) => r.status === 200,
  });
  if (res.status !== 200) {
    console.error(`get quiz failed: ${res.status} ${res.body}`);
    return null;
  }
  return res.json();
}
