import { useState, useCallback, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion, Reorder } from "motion/react";
import { Check, X, Send, GripVertical } from "lucide-react";
import { CrescentIcon } from "../components/icons";
import { LeaderboardDisplay } from "../components/LeaderboardDisplay";
import { PodiumScreen } from "../components/PodiumScreen";
import { useWebSocket } from "../hooks/useWebSocket";
import { getPlayerResults } from "../api/sessions";
import type { WsMessage, QuestionPayload, AnswerRevealPayload, LeaderboardEntry, PodiumEntry } from "../types";

const WS_BASE = import.meta.env.VITE_WS_BASE_URL ?? "ws://localhost:8081";

// Answer option colors matching the Figma design
const OPTION_COLORS = ["#4caf50", "#2196f3", "#ff6b35", "#f44336"];

type GamePhase = "waiting" | "question" | "reveal" | "leaderboard" | "podium" | "ended";

// ── Countdown ring ───────────────────────────────────────────────────────────
function CountdownRing({ timeLimit, startedAt }: { timeLimit: number; startedAt: number }) {
  const [remaining, setRemaining] = useState(timeLimit);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const left = Math.max(0, timeLimit - elapsed);
      setRemaining(left);
      if (left <= 0 && intervalRef.current) clearInterval(intervalRef.current);
    }, 100);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [timeLimit, startedAt]);

  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const progress = remaining / timeLimit;
  const strokeDashoffset = circumference * (1 - progress);
  const isUrgent = remaining <= timeLimit * 0.25;
  const color = isUrgent ? "#f44336" : remaining > timeLimit * 0.5 ? "#f5c842" : "#ff6b35";

  return (
    <div className="relative flex items-center justify-center" style={{ width: 96, height: 96 }}>
      <svg className="absolute inset-0 -rotate-90" width="96" height="96" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={radius} fill="none" stroke="rgba(245,200,66,0.2)" strokeWidth="8" />
        <circle cx="48" cy="48" r={radius} fill="none" stroke={color} strokeWidth="8"
          strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
          style={{
            transition: "stroke-dashoffset 0.1s linear, stroke 0.3s",
            filter: `drop-shadow(0 0 ${isUrgent ? "15px" : "8px"} ${color}99)`,
          }} />
      </svg>
      <motion.span
        className="text-2xl font-black tabular-nums"
        style={{ color }}
        animate={isUrgent ? { scale: [1, 1.1, 1] } : {}}
        transition={{ duration: 0.5, repeat: isUrgent ? Infinity : 0 }}
      >
        {Math.ceil(remaining)}
      </motion.span>
    </div>
  );
}

export function PlayerGamePage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const playerId = sessionStorage.getItem("player_id") ?? "";
  const sessionId = sessionStorage.getItem("session_id") ?? "";

  const [phase, setPhase] = useState<GamePhase>("waiting");
  const [currentQuestion, setCurrentQuestion] = useState<QuestionPayload | null>(null);
  const [questionStartedAt, setQuestionStartedAt] = useState<number>(0);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [revealPayload, setRevealPayload] = useState<AnswerRevealPayload | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [prevLeaderboard, setPrevLeaderboard] = useState<LeaderboardEntry[]>([]);
  const leaderboardRef = useRef<LeaderboardEntry[]>([]);
  const [podium, setPodium] = useState<PodiumEntry[]>([]);

  // Ordering question state (drag-to-reorder)
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [orderingSubmitted, setOrderingSubmitted] = useState(false);

  // Multi-select question state
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
  const [multiSelectSubmitted, setMultiSelectSubmitted] = useState(false);

  const { data: playerResults } = useQuery({
    queryKey: ["playerResults", sessionId, playerId],
    queryFn: () => getPlayerResults(sessionId, playerId),
    enabled: phase === "podium" && !!sessionId && !!playerId,
    staleTime: Infinity,
  });

  const { send } = useWebSocket({
    url: `${WS_BASE}/api/v1/ws/player/${code}?player_id=${playerId}&name=${encodeURIComponent(
      sessionStorage.getItem("player_name") ?? "",
    )}`,
    onMessage: useCallback((msg: WsMessage) => {
      switch (msg.type) {
        case "question": {
          const p = msg.payload as QuestionPayload;
          setCurrentQuestion(p);
          setPhase("question");
          setSelectedOptionId(null);
          setRevealPayload(null);
          setQuestionStartedAt(Date.now());
          // Reset ordering state — initialize with shuffled option IDs
          setOrderedIds(p.question.options.map((o: { id: string }) => o.id));
          setOrderingSubmitted(false);
          // Reset multi-select state
          setSelectedOptionIds([]);
          setMultiSelectSubmitted(false);
          break;
        }
        case "answer_reveal": {
          const p = msg.payload as AnswerRevealPayload;
          setRevealPayload(p);
          setPhase("reveal");
          break;
        }
        case "leaderboard": {
          const p = msg.payload as { entries: LeaderboardEntry[] };
          setPrevLeaderboard(leaderboardRef.current);
          leaderboardRef.current = p.entries;
          setLeaderboard(p.entries);
          setPhase("leaderboard");
          break;
        }
        case "podium": {
          const p = msg.payload as { entries: PodiumEntry[] };
          setPodium(p.entries);
          setPhase("podium");
          break;
        }
        case "game_over": {
          const p = msg.payload as { reason?: string };
          if (p.reason === "session_ended") setPhase("ended");
          break;
        }
        case "player_kicked": {
          navigate("/join", { state: { kicked: true } });
          break;
        }
      }
    }, [navigate]),
    enabled: !!code && !!playerId,
  });

  const handleSelectOption = (optionId: string, questionId: string) => {
    if (selectedOptionId) return;
    setSelectedOptionId(optionId);
    send({ type: "answer_submitted", payload: { question_id: questionId, option_id: optionId } });
  };

  const handleSubmitOrdering = (questionId: string) => {
    if (orderingSubmitted) return;
    setOrderingSubmitted(true);
    send({ type: "answer_submitted", payload: { question_id: questionId, option_ids: orderedIds } });
  };

  const handleToggleOption = (optionId: string) => {
    if (multiSelectSubmitted) return;
    setSelectedOptionIds((prev) =>
      prev.includes(optionId) ? prev.filter((id) => id !== optionId) : [...prev, optionId]
    );
  };

  const handleSubmitMultiSelect = (questionId: string) => {
    if (multiSelectSubmitted || selectedOptionIds.length === 0) return;
    setMultiSelectSubmitted(true);
    send({ type: "answer_submitted", payload: { question_id: questionId, option_ids: selectedOptionIds } });
  };

  // ── Ended ────────────────────────────────────────────────────────────────
  if (phase === "ended") {
    return (
      <div className="min-h-screen w-full relative overflow-hidden" style={{ background: "#1a0a2e" }}>
        <div className="ramadan-pattern" />
        <div className="relative z-10 min-h-screen flex items-center justify-center px-6">
          <motion.div className="text-center w-full max-w-sm p-8 rounded-3xl"
            style={{ background: "linear-gradient(135deg, rgba(42,20,66,0.9) 0%, rgba(30,15,50,0.95) 100%)", boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(245,200,66,0.2)" }}
            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
            <div className="text-5xl mb-4">&#x1F6AB;</div>
            <h1 className="text-2xl font-bold text-white mb-2">Game Ended</h1>
            <p className="mb-6" style={{ color: "rgba(255,255,255,0.6)" }}>The host ended the session early.</p>
            <motion.a href="/join" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              className="inline-block py-3 px-6 rounded-xl font-bold text-white"
              style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8c5a 100%)" }}>
              Join another game
            </motion.a>
          </motion.div>
        </div>
      </div>
    );
  }

  // ── Waiting ──────────────────────────────────────────────────────────────
  if (phase === "waiting") {
    return (
      <div className="min-h-screen w-full relative overflow-hidden" style={{ background: "#1a0a2e" }}>
        <div className="ramadan-pattern" />
        <div className="relative z-10 min-h-screen flex items-center justify-center">
          <div className="text-center">
            <motion.div animate={{ y: [0, -15, 0], rotate: [-3, 3, -3] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}>
              <CrescentIcon className="w-20 h-20 mx-auto drop-shadow-[0_0_30px_rgba(245,200,66,0.8)]" style={{ color: "#f5c842" }} />
            </motion.div>
            <div className="flex gap-3 justify-center mt-8">
              {[0, 1, 2].map((i) => (
                <motion.div key={i} className="w-3 h-3 rounded-full" style={{ background: "#f5c842" }}
                  animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }} />
              ))}
            </div>
            <p className="mt-4 font-medium" style={{ color: "rgba(255,255,255,0.7)" }}>Get ready…</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Podium ───────────────────────────────────────────────────────────────
  if (phase === "podium") {
    return <PodiumScreen entries={podium} playerId={playerId} playerResults={playerResults} />;
  }

  // ── Leaderboard ──────────────────────────────────────────────────────────
  if (phase === "leaderboard") {
    return (
      <div className="min-h-screen w-full relative overflow-hidden" style={{ background: "#1a0a2e" }}>
        <div className="ramadan-pattern" />
        <div className="relative z-10 min-h-screen flex flex-col px-6 py-8 max-w-md mx-auto">
          <motion.div className="text-center mb-8" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center justify-center gap-3 mb-2">
              <CrescentIcon className="w-8 h-8" style={{ color: "#f5c842" }} />
              <h1 className="text-3xl font-black" style={{ color: "#f5c842" }}>Leaderboard</h1>
            </div>
            <p style={{ color: "rgba(255,255,255,0.7)" }}>Waiting for host…</p>
          </motion.div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
            <LeaderboardDisplay entries={leaderboard} prevEntries={prevLeaderboard} highlightPlayerId={playerId} />
          </motion.div>
        </div>
      </div>
    );
  }

  // ── Reveal ───────────────────────────────────────────────────────────────
  if (phase === "reveal" && currentQuestion && revealPayload) {
    const myScore = revealPayload.scores[playerId];
    const isCorrect = myScore?.is_correct ?? false;
    const points = myScore?.points ?? 0;
    const opts = currentQuestion.question.options;
    const qType = currentQuestion.question.type ?? "multiple_choice";
    const isOrdering = qType === "ordering";

    // Ordering reveal
    if (isOrdering && revealPayload.correct_order) {
      const correctOrder = revealPayload.correct_order;
      const optMap = Object.fromEntries(opts.map(o => [o.id, o.text]));

      return (
        <div className="min-h-screen w-full relative overflow-hidden" style={{ background: "#1a0a2e" }}>
          <div className="ramadan-pattern" />
          <div className="relative z-10 min-h-screen flex flex-col px-6 py-8 max-w-md mx-auto">
            <motion.h3 className="text-lg font-bold text-white mb-4 text-center"
              initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
              Correct Order
            </motion.h3>
            <div className="grid grid-cols-1 gap-3 mb-6">
              {correctOrder.map((optId, i) => {
                const playerGotRight = orderedIds[i] === optId;
                return (
                  <motion.div key={optId}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl"
                    style={{
                      background: playerGotRight ? "rgba(76,175,80,0.2)" : "rgba(244,67,54,0.15)",
                      border: `1px solid ${playerGotRight ? "rgba(76,175,80,0.4)" : "rgba(244,67,54,0.3)"}`,
                    }}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.08 }}>
                    <span className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm flex-shrink-0"
                      style={{ background: playerGotRight ? "rgba(76,175,80,0.3)" : "rgba(244,67,54,0.2)", color: "white" }}>
                      {i + 1}
                    </span>
                    <p className="text-white font-medium flex-1 leading-tight">{optMap[optId] ?? optId}</p>
                    {playerGotRight ? (
                      <Check className="w-5 h-5 text-green-400 flex-shrink-0" />
                    ) : (
                      <X className="w-5 h-5 text-red-400 flex-shrink-0" />
                    )}
                  </motion.div>
                );
              })}
            </div>

            {/* Points feedback */}
            <motion.div className="text-center mb-4"
              initial={{ opacity: 0, y: 30, scale: 0.8 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 200 }}>
              {points > 0 ? (
                <motion.div className="inline-block px-8 py-4 rounded-2xl"
                  style={{ background: "linear-gradient(135deg, #f5c842 0%, #ffd700 100%)", boxShadow: "0 10px 40px rgba(245,200,66,0.6)" }}
                  animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 0.5, repeat: 2 }}>
                  <p className="font-black text-4xl" style={{ color: "#1a0a2e" }}>+{points}</p>
                  <p className="text-sm font-medium" style={{ color: "#1a0a2e" }}>Partial credit!</p>
                </motion.div>
              ) : (
                <div className="inline-block px-8 py-4 rounded-2xl"
                  style={{ background: "rgba(244,67,54,0.2)", border: "2px solid rgba(244,67,54,0.4)" }}>
                  <p className="font-bold text-xl" style={{ color: "#f44336" }}>No points</p>
                </div>
              )}
            </motion.div>

            <p className="text-center text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>Leaderboard incoming…</p>
          </div>
        </div>
      );
    }

    // MC / True-False / Image Choice / Multi-Select reveal
    const isMultiSelect = qType === "multi_select";
    const correctIds = revealPayload.correct_option_ids ?? (revealPayload.correct_option_id ? [revealPayload.correct_option_id] : []);
    return (
      <div className="min-h-screen w-full relative overflow-hidden" style={{ background: "#1a0a2e" }}>
        <div className="ramadan-pattern" />
        <div className="relative z-10 min-h-screen flex flex-col px-6 py-8 max-w-md mx-auto">
          {/* Answer tiles */}
          <div className="grid grid-cols-1 gap-4 mb-6">
            {opts.map((opt, i) => {
              const isCorrectOpt = correctIds.includes(opt.id);
              const wasSelected = isMultiSelect ? selectedOptionIds.includes(opt.id) : opt.id === selectedOptionId;
              const color = OPTION_COLORS[i % 4];
              return (
                <motion.div key={opt.id}
                  className="relative p-5 rounded-2xl overflow-hidden"
                  style={{
                    background: isCorrectOpt ? `linear-gradient(135deg, ${color} 0%, ${color}dd 100%)` : wasSelected ? "rgba(244,67,54,0.25)" : "rgba(255,255,255,0.08)",
                    boxShadow: isCorrectOpt ? `0 8px 30px ${color}60, 0 0 0 3px ${color}` : "none",
                    opacity: !isCorrectOpt && !wasSelected ? 0.4 : 1,
                  }}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: !isCorrectOpt && !wasSelected ? 0.4 : 1, scale: isCorrectOpt ? [1, 1.03, 1] : 1 }}
                  transition={{ delay: i * 0.08, scale: { duration: 0.5, repeat: isCorrectOpt ? 2 : 0 } }}>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center font-black text-xl flex-shrink-0"
                      style={{ background: isCorrectOpt ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.1)", color: "white" }}>
                      {String.fromCharCode(65 + i)}
                    </div>
                    {opt.image_url && (
                      <img src={opt.image_url} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
                    )}
                    <p className="text-white font-medium flex-1 leading-tight">{opt.text}</p>
                    {isCorrectOpt && (
                      <motion.div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ background: "rgba(255,255,255,0.3)" }}
                        initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.4, type: "spring", stiffness: 200 }}>
                        <Check className="w-6 h-6 text-white" strokeWidth={3} />
                      </motion.div>
                    )}
                    {!isCorrectOpt && wasSelected && (
                      <motion.div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-red-500/30"
                        initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.4, type: "spring", stiffness: 200 }}>
                        <X className="w-6 h-6 text-red-400" strokeWidth={3} />
                      </motion.div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Result feedback */}
          <motion.div className="text-center mb-4"
            initial={{ opacity: 0, y: 30, scale: 0.8 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 200 }}>
            {isCorrect ? (
              <motion.div className="inline-block px-8 py-4 rounded-2xl"
                style={{ background: "linear-gradient(135deg, #f5c842 0%, #ffd700 100%)", boxShadow: "0 10px 40px rgba(245,200,66,0.6)" }}
                animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 0.5, repeat: 2 }}>
                <p className="font-black text-2xl" style={{ color: "#1a0a2e" }}>Correct!</p>
                <p className="font-black text-4xl" style={{ color: "#1a0a2e" }}>+{points}</p>
              </motion.div>
            ) : (
              <div className="inline-block px-8 py-4 rounded-2xl"
                style={{ background: "rgba(244,67,54,0.2)", border: "2px solid rgba(244,67,54,0.4)" }}>
                <p className="font-bold text-xl" style={{ color: "#f44336" }}>Incorrect</p>
              </div>
            )}
          </motion.div>

          <p className="text-center text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>Leaderboard incoming…</p>
        </div>
      </div>
    );
  }

  // ── Question ─────────────────────────────────────────────────────────────
  if (phase === "question" && currentQuestion) {
    const q = currentQuestion.question;
    const opts = q.options;
    const qType = q.type ?? "multiple_choice";
    const isOrdering = qType === "ordering";
    const isMultiSelect = qType === "multi_select";
    const isTrueFalse = qType === "true_false";
    const isLockedIn = isOrdering ? orderingSubmitted : isMultiSelect ? multiSelectSubmitted : !!selectedOptionId;

    return (
      <div className="min-h-screen w-full relative overflow-hidden" style={{ background: "#1a0a2e" }}>
        <div className="ramadan-pattern" />

        <div className="relative z-10 min-h-screen flex flex-col px-6 py-8 max-w-md mx-auto">
          {/* Timer */}
          <motion.div className="flex justify-center mb-6" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}>
            <CountdownRing timeLimit={q.time_limit} startedAt={questionStartedAt} />
          </motion.div>

          {/* Question header */}
          <motion.div className="mb-6 text-center px-2" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <div className="flex items-center justify-center gap-2 mb-3">
              <CrescentIcon className="w-5 h-5" style={{ color: "#f5c842" }} />
              <p className="text-sm font-medium" style={{ color: "#f5c842" }}>
                Question {currentQuestion.question_index + 1} of {currentQuestion.total_questions}
              </p>
            </div>
            <h2 className="text-xl font-bold text-white leading-snug">{q.text}</h2>
            {q.image_url && (
              <img src={q.image_url} alt="" className="mt-4 rounded-xl max-h-40 mx-auto object-contain" />
            )}
            {isOrdering && (
              <p className="mt-2 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>Arrange items in the correct order</p>
            )}
            {isMultiSelect && (
              <p className="mt-2 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>Select all that apply</p>
            )}
          </motion.div>

          {/* Locked-in state */}
          {isLockedIn ? (
            <motion.div
              className="flex flex-col items-center gap-6 py-4"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
            >
              <div className="w-full rounded-3xl p-8 text-center"
                style={{
                  background: "rgba(245,200,66,0.08)",
                  border: "2px solid rgba(245,200,66,0.35)",
                  boxShadow: "0 0 40px rgba(245,200,66,0.1)",
                }}>
                <motion.div
                  className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                  style={{ background: "rgba(245,200,66,0.15)", border: "2px solid rgba(245,200,66,0.4)" }}
                  animate={{ scale: [1, 1.05, 1] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                >
                  <Check className="w-8 h-8" style={{ color: "#f5c842" }} />
                </motion.div>
                <p className="text-lg font-bold text-white mb-2">Answer locked in!</p>
                {isOrdering ? (
                  <p className="text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>Your order has been submitted</p>
                ) : isMultiSelect ? (
                  <p className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.6)" }}>
                    {selectedOptionIds.length} option{selectedOptionIds.length !== 1 ? "s" : ""} selected
                  </p>
                ) : (
                  (() => {
                    const selectedIdx = opts.findIndex(o => o.id === selectedOptionId);
                    return selectedIdx >= 0 ? (
                      <p className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.6)" }}>
                        {String.fromCharCode(65 + selectedIdx)}: {opts[selectedIdx].text}
                      </p>
                    ) : null;
                  })()
                )}
              </div>

              <div className="flex items-center gap-2">
                {[0, 1, 2].map(i => (
                  <motion.div key={i} className="w-2 h-2 rounded-full"
                    style={{ background: "rgba(245,200,66,0.6)" }}
                    animate={{ scale: [1, 1.5, 1], opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 1, repeat: Infinity, delay: i * 0.3 }}
                  />
                ))}
                <p className="text-sm ml-1" style={{ color: "rgba(255,255,255,0.5)" }}>Waiting for others…</p>
              </div>
            </motion.div>
          ) : isOrdering ? (
            /* ── Ordering question (drag to reorder) ──────────────────── */
            <div className="flex flex-col gap-4">
              <p className="text-xs text-center" style={{ color: "rgba(255,255,255,0.5)" }}>
                Hold and drag to reorder
              </p>

              <Reorder.Group
                as="div"
                axis="y"
                values={orderedIds}
                onReorder={setOrderedIds}
                className="flex flex-col gap-3"
                data-testid="ordering-list"
              >
                {orderedIds.map((id, i) => {
                  const opt = opts.find(o => o.id === id);
                  return (
                    <Reorder.Item
                      as="div"
                      key={id}
                      value={id}
                      className="flex items-center gap-3 px-4 py-4 rounded-2xl cursor-grab active:cursor-grabbing select-none"
                      style={{
                        background: "rgba(42,20,66,0.8)",
                        border: "2px solid rgba(245,200,66,0.25)",
                        touchAction: "none",
                        position: "relative",
                      }}
                      whileDrag={{
                        scale: 1.05,
                        boxShadow: "0 12px 40px rgba(0,0,0,0.5), 0 0 0 2px #f5c842",
                        background: "rgba(42,20,66,0.95)",
                        cursor: "grabbing",
                      }}
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    >
                      <span
                        className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm flex-shrink-0"
                        style={{ background: "rgba(245,200,66,0.2)", color: "#f5c842" }}
                      >
                        {i + 1}
                      </span>
                      <span className="text-white font-medium flex-1 leading-tight">
                        {opt?.text}
                      </span>
                      <GripVertical className="w-6 h-6 flex-shrink-0" style={{ color: "rgba(245,200,66,0.4)" }} />
                    </Reorder.Item>
                  );
                })}
              </Reorder.Group>

              {/* Submit button */}
              <motion.button
                onClick={() => handleSubmitOrdering(q.id)}
                className="mt-2 w-full py-3 rounded-xl font-bold text-white flex items-center justify-center gap-2"
                style={{
                  background: "linear-gradient(135deg, #f5c842 0%, #ff6b35 100%)",
                  boxShadow: "0 6px 20px rgba(245,200,66,0.4)",
                }}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <Send className="w-5 h-5" />
                Submit Order
              </motion.button>
            </div>
          ) : isMultiSelect ? (
            /* ── Multi-select question (checkboxes + Submit) ───────────── */
            <div className="flex flex-col gap-3">
              <p className="text-xs text-center" style={{ color: "rgba(255,255,255,0.5)" }}>
                Select all correct answers
              </p>
              {opts.map((opt, i) => {
                const color = OPTION_COLORS[i % 4];
                const isSelected = selectedOptionIds.includes(opt.id);
                return (
                  <motion.button key={opt.id}
                    onClick={() => handleToggleOption(opt.id)}
                    className="relative px-4 py-3 rounded-2xl text-left overflow-hidden group"
                    style={{
                      background: isSelected
                        ? `linear-gradient(135deg, ${color}dd 0%, ${color}bb 100%)`
                        : `${color}22`,
                      boxShadow: isSelected ? `0 4px 15px ${color}40` : "none",
                      border: `2px solid ${isSelected ? color : `${color}55`}`,
                    }}
                    initial={{ opacity: 0, x: -30 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 + i * 0.08 }}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}>
                    <div className="relative z-10 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm flex-shrink-0"
                        style={{
                          background: isSelected ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.1)",
                          color: isSelected ? "white" : color,
                        }}>
                        {isSelected ? <Check className="w-4 h-4" /> : String.fromCharCode(65 + i)}
                      </div>
                      <p className={`font-medium leading-tight ${isSelected ? "text-white" : ""}`}
                        style={{ color: isSelected ? "white" : "rgba(255,255,255,0.7)" }}>
                        {opt.text}
                      </p>
                    </div>
                  </motion.button>
                );
              })}

              {/* Submit button */}
              <motion.button
                onClick={() => handleSubmitMultiSelect(q.id)}
                disabled={selectedOptionIds.length === 0}
                className="mt-2 w-full py-3 rounded-xl font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: selectedOptionIds.length > 0
                    ? "linear-gradient(135deg, #f5c842 0%, #ff6b35 100%)"
                    : "rgba(255,255,255,0.1)",
                  boxShadow: selectedOptionIds.length > 0 ? "0 6px 20px rgba(245,200,66,0.4)" : "none",
                }}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                whileHover={selectedOptionIds.length > 0 ? { scale: 1.02 } : {}}
                whileTap={selectedOptionIds.length > 0 ? { scale: 0.98 } : {}}>
                <Send className="w-5 h-5" />
                Submit ({selectedOptionIds.length})
              </motion.button>
            </div>
          ) : isTrueFalse ? (
            /* ── True / False question ─────────────────────────────────── */
            <div className="flex flex-col gap-4">
              {opts.map((opt) => {
                const isTrue = opt.text.toLowerCase() === "true";
                const color = isTrue ? "#4caf50" : "#f44336";
                return (
                  <motion.button key={opt.id}
                    onClick={() => handleSelectOption(opt.id, q.id)}
                    className="px-6 py-5 rounded-2xl text-center overflow-hidden"
                    style={{
                      background: `linear-gradient(135deg, ${color}dd 0%, ${color}bb 100%)`,
                      boxShadow: `0 6px 20px ${color}40`,
                    }}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}>
                    <p className="text-2xl font-black text-white">{opt.text}</p>
                  </motion.button>
                );
              })}
            </div>
          ) : (
            /* ── MC / Image Choice question ────────────────────────────── */
            <div className="flex flex-col gap-3">
              {opts.map((opt, i) => {
                const color = OPTION_COLORS[i % 4];
                return (
                  <motion.button key={opt.id}
                    onClick={() => handleSelectOption(opt.id, q.id)}
                    className="relative px-4 py-3 rounded-2xl text-left overflow-hidden group"
                    style={{
                      background: `linear-gradient(135deg, ${color}dd 0%, ${color}bb 100%)`,
                      boxShadow: `0 4px 15px ${color}40`,
                    }}
                    initial={{ opacity: 0, x: -30 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 + i * 0.08 }}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}>
                    {/* Shine on hover */}
                    <motion.div className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent opacity-0 group-hover:opacity-20"
                      initial={{ x: "-100%" }} whileHover={{ x: "100%" }} transition={{ duration: 0.6 }} />
                    <div className="relative z-10 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm flex-shrink-0"
                        style={{ background: "rgba(255,255,255,0.25)", color: "white" }}>
                        {String.fromCharCode(65 + i)}
                      </div>
                      {opt.image_url && (
                        <img src={opt.image_url} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
                      )}
                      <p className="text-white font-medium leading-tight">{opt.text}</p>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
