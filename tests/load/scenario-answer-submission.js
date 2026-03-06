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
  startSession,
  getQuiz,
} from "./helpers.js";

/*
 * Scenario: Concurrent Answer Submission
 *
 * Simulates players submitting answers simultaneously during a live game.
 * Tests the game engine's answer processing, Redis write throughput,
 * and the scoring + reveal broadcast pipeline.
 *
 * Default: 50 players, 5 questions.
 * Smoke:   10 players, 3 questions.
 */

const PLAYER_COUNT = __ENV.PLAYER_COUNT ? parseInt(__ENV.PLAYER_COUNT) : 50;
const QUESTION_COUNT = __ENV.QUESTION_COUNT
  ? parseInt(__ENV.QUESTION_COUNT)
  : 5;

export const options = {
  scenarios: {
    answer_submission: {
      executor: "per-vu-iterations",
      vus: PLAYER_COUNT,
      iterations: 1,
      maxDuration: "3m",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500"],
    answer_submit_to_reveal: ["p(95)<5000"],
  },
};

const answerSubmitToReveal = new Trend("answer_submit_to_reveal");
const answersSubmitted = new Counter("answers_submitted");
const revealsReceived = new Counter("reveals_received");
const leaderboardsReceived = new Counter("leaderboards_received");

export function setup() {
  const admin = registerAdmin("answers");
  if (!admin) throw new Error("Admin registration failed");

  const quiz = createQuiz(admin.token, QUESTION_COUNT);
  if (!quiz) throw new Error("Quiz creation failed");

  // Fetch full quiz to get question/option IDs
  const fullQuiz = getQuiz(admin.token, quiz.quizId);
  if (!fullQuiz) throw new Error("Get quiz failed");

  const session = createSession(admin.token, quiz.quizId);
  if (!session) throw new Error("Session creation failed");

  // Pre-join all players via REST
  const players = [];
  for (let i = 0; i < PLAYER_COUNT; i++) {
    const player = joinSession(session.code, `player-${i}`);
    if (!player) throw new Error(`Player ${i} join failed`);
    players.push(player);
  }

  // Connect host WebSocket (needed for game engine)
  // We can't maintain the host WS from setup, so we'll do it in a separate scenario
  // Instead, start the game after a delay to let players connect

  return {
    token: admin.token,
    sessionId: session.sessionId,
    code: session.code,
    quizId: quiz.quizId,
    players,
    questions: fullQuiz.questions,
  };
}

export default function (data) {
  const playerIndex = __VU - 1;
  if (playerIndex >= data.players.length) return;

  const player = data.players[playerIndex];
  const playerName = `player-${playerIndex}`;

  const wsUrl = `${WS_URL}/ws/player/${data.code}?player_id=${player.playerId}&name=${playerName}`;

  const res = ws.connect(wsUrl, WS_PARAMS, function (socket) {
    let currentQuestionId = null;
    let answerSentAt = null;
    let questionsAnswered = 0;

    socket.on("message", function (msg) {
      // Handle newline-separated messages (server batching)
      const lines = msg.split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          handleMessage(socket, parsed);
        } catch (_) {
          // ignore non-JSON
        }
      }
    });

    function handleMessage(socket, parsed) {
      switch (parsed.type) {
        case "question": {
          currentQuestionId = parsed.payload.question_id;
          // Find matching question to get a valid option ID
          const q = data.questions.find((q) => q.id === currentQuestionId);
          if (!q) {
            console.error(`Question ${currentQuestionId} not found in quiz data`);
            return;
          }

          // Simulate think time (0.5-3 seconds) before answering
          const thinkTime = 0.5 + Math.random() * 2.5;
          sleep(thinkTime);

          // Pick a random option (simulates realistic answer distribution)
          const option =
            q.options[Math.floor(Math.random() * q.options.length)];

          answerSentAt = Date.now();
          socket.send(
            JSON.stringify({
              type: "answer_submitted",
              payload: {
                question_id: currentQuestionId,
                option_id: option.id,
              },
            })
          );
          answersSubmitted.add(1);
          questionsAnswered++;
          break;
        }

        case "answer_reveal": {
          if (answerSentAt) {
            answerSubmitToReveal.add(Date.now() - answerSentAt);
            answerSentAt = null;
          }
          revealsReceived.add(1);
          break;
        }

        case "leaderboard": {
          leaderboardsReceived.add(1);
          break;
        }

        case "game_over":
        case "podium": {
          socket.close();
          break;
        }
      }
    }

    socket.on("error", function (e) {
      console.error(`WS error for ${playerName}: ${e.error()}`);
    });

    // Wait for host to start the game, then wait for all questions
    // Timeout after 3 minutes (maxDuration handles overall)
    sleep(180);
  });

  check(res, {
    "ws status 101": (r) => r && r.status === 101,
  });
}

/*
 * NOTE: This scenario requires a host to start the game and send
 * next_question messages. Run the host companion script alongside:
 *
 *   node tests/load/host-driver.js <session-id> <token> <code>
 *
 * Or use scenario-full-game.js which handles the full flow.
 */
