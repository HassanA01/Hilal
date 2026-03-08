import { check, sleep } from "k6";
import http from "k6/http";
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
 * Scenario: Full Game Simulation
 *
 * End-to-end game flow: admin creates quiz → starts session → players
 * join → game plays through all questions → podium.
 *
 * Each VU is one independent game with its own admin and players.
 * Tests overall system throughput with concurrent games.
 *
 * Default: 10 concurrent games, 5 players each, 3 questions.
 * Smoke:   2 concurrent games, 3 players each, 2 questions.
 */

const CONCURRENT_GAMES = __ENV.CONCURRENT_GAMES
  ? parseInt(__ENV.CONCURRENT_GAMES)
  : 10;
const PLAYERS_PER_GAME = __ENV.PLAYERS_PER_GAME
  ? parseInt(__ENV.PLAYERS_PER_GAME)
  : 5;
const QUESTION_COUNT = __ENV.QUESTION_COUNT
  ? parseInt(__ENV.QUESTION_COUNT)
  : 3;

export const options = {
  scenarios: {
    full_game: {
      executor: "per-vu-iterations",
      vus: CONCURRENT_GAMES,
      iterations: 1,
      maxDuration: "5m",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<1000"],
    game_setup_duration: ["p(95)<5000"],
    game_total_duration: ["p(95)<120000"],
  },
};

const gameSetupDuration = new Trend("game_setup_duration");
const gameTotalDuration = new Trend("game_total_duration");
const gamesCompleted = new Counter("games_completed");
const gamesFailed = new Counter("games_failed");

export default function () {
  const gameStart = Date.now();
  const gameTag = `game-${__VU}-${__ITER}`;

  // ── Phase 1: Setup (admin + quiz + session) ──

  const setupStart = Date.now();

  const admin = registerAdmin(gameTag);
  if (!admin) {
    gamesFailed.add(1);
    return;
  }

  const quiz = createQuiz(admin.token, QUESTION_COUNT);
  if (!quiz) {
    gamesFailed.add(1);
    return;
  }

  const fullQuiz = getQuiz(admin.token, quiz.quizId);
  if (!fullQuiz) {
    gamesFailed.add(1);
    return;
  }

  const session = createSession(admin.token, quiz.quizId);
  if (!session) {
    gamesFailed.add(1);
    return;
  }

  // ── Phase 2: Players join ──

  const players = [];
  for (let i = 0; i < PLAYERS_PER_GAME; i++) {
    const player = joinSession(session.code, `${gameTag}-p${i}`);
    if (!player) {
      console.error(`${gameTag}: player ${i} join failed`);
      continue;
    }
    players.push({ ...player, name: `${gameTag}-p${i}` });
  }

  if (players.length === 0) {
    gamesFailed.add(1);
    return;
  }

  gameSetupDuration.add(Date.now() - setupStart);

  // ── Phase 3: Connect host WebSocket ──

  const hostWsUrl = `${WS_URL}/ws/host/${session.code}`;

  const hostRes = ws.connect(hostWsUrl, WS_PARAMS, function (hostSocket) {
    let hostGamePhase = "waiting";
    let questionsProcessed = 0;

    hostSocket.on("message", function (msg) {
      const lines = msg.split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          handleHostMessage(hostSocket, parsed);
        } catch (_) {}
      }
    });

    function handleHostMessage(socket, parsed) {
      switch (parsed.type) {
        case "question":
          hostGamePhase = "question";
          break;

        case "answer_reveal":
          hostGamePhase = "reveal";
          break;

        case "leaderboard":
          hostGamePhase = "leaderboard";
          questionsProcessed++;

          // Send next_question after a brief pause
          sleep(1);
          socket.send(JSON.stringify({ type: "next_question", payload: null }));
          break;

        case "podium":
        case "game_over":
          hostGamePhase = "done";
          gameTotalDuration.add(Date.now() - gameStart);
          gamesCompleted.add(1);
          socket.close();
          break;
      }
    }

    hostSocket.on("error", function (e) {
      console.error(`${gameTag} host WS error: ${e.error()}`);
    });

    // ── Phase 4: Connect player WebSockets ──

    // Give a moment for host connection to stabilize
    sleep(0.5);

    // Start the game via HTTP
    startSession(admin.token, session.sessionId);

    // Simulate players answering (we do this sequentially per player
    // since k6 WS connections in the same VU are cooperative)
    // Each player connects, listens for questions, and answers.
    for (const player of players) {
      connectPlayer(player, session.code, fullQuiz.questions);
    }

    // Wait for game to finish (host processes reveals + leaderboards)
    let waitTime = 0;
    while (hostGamePhase !== "done" && waitTime < 120) {
      sleep(1);
      waitTime++;
    }

    if (hostGamePhase !== "done") {
      console.error(`${gameTag}: game did not complete within timeout`);
      gamesFailed.add(1);
      hostSocket.close();
    }
  });

  check(hostRes, {
    "host ws 101": (r) => r && r.status === 101,
  });
}

function connectPlayer(player, code, questions) {
  const wsUrl = `${WS_URL}/ws/player/${code}?player_id=${player.playerId}&name=${player.name}`;

  ws.connect(wsUrl, WS_PARAMS, function (socket) {
    socket.on("message", function (msg) {
      const lines = msg.split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);

          if (parsed.type === "question") {
            const q = questions.find(
              (q) => q.id === parsed.payload.question_id
            );
            if (!q) return;

            // Random think time
            sleep(0.3 + Math.random() * 1.5);

            const option =
              q.options[Math.floor(Math.random() * q.options.length)];
            socket.send(
              JSON.stringify({
                type: "answer_submitted",
                payload: {
                  question_id: parsed.payload.question_id,
                  option_id: option.id,
                },
              })
            );
          }

          if (
            parsed.type === "podium" ||
            parsed.type === "game_over"
          ) {
            socket.close();
          }
        } catch (_) {}
      }
    });

    // Stay connected until game ends or timeout
    sleep(120);
  });
}
