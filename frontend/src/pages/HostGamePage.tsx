import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { ChevronRight, Users, LogOut, Volume2, VolumeOff } from "lucide-react";
import { CrescentIcon } from "../components/icons";
import { useWebSocket } from "../hooks/useWebSocket";
import { useGameStore } from "../stores/gameStore";
import { endSession } from "../api/sessions";
import { LeaderboardDisplay } from "../components/LeaderboardDisplay";
import { PodiumScreen } from "../components/PodiumScreen";
import { ConfirmModal } from "../components/ConfirmModal";
import { PrayerArcTransition } from "../components/PrayerArcTransition";
import { useGameAudio } from "../hooks/useGameAudio";
import type { WsMessage, LeaderboardEntry, PodiumEntry, AnswerRevealPayload } from "../types";

const WS_BASE = import.meta.env.VITE_WS_BASE_URL ?? "ws://localhost:8081";

interface HostOption {
  id: string;
  text: string;
  is_correct: boolean;
  image_url?: string;
  sort_order?: number;
}

interface HostQuestionPayload {
  question_index: number;
  total_questions: number;
  question: {
    id: string;
    text: string;
    type: string;
    time_limit: number;
    image_url?: string;
    options: HostOption[];
  };
}

type GamePhase = "waiting" | "question" | "reveal" | "leaderboard" | "arc_transition" | "podium";

const OPTION_COLORS = ["#4caf50", "#2196f3", "#ff6b35", "#f44336"];
const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

const TYPE_LABELS: Record<string, string> = {
  multiple_choice: "Multiple Choice",
  multi_select: "Multi Select",
  true_false: "True / False",
  image_choice: "Image Choice",
  ordering: "Ordering",
};

/** Deterministic shuffle using a simple hash of the questionId as seed. */
function seededShuffle<T>(arr: T[], seed: string): T[] {
  const copy = [...arr];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  for (let i = copy.length - 1; i > 0; i--) {
    h = (h * 1664525 + 1013904223) | 0;
    const j = ((h >>> 0) % (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function useDelayedFlag(active: boolean, delayMs: number, resetKey: string): boolean {
  const [flag, setFlag] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setFlag(active), active ? delayMs : 0);
    return () => clearTimeout(timer);
  }, [active, delayMs, resetKey]);
  return flag;
}

function OrderingReveal({ options, questionId, revealed, correctOrder }: {
  options: HostOption[];
  questionId: string;
  revealed: boolean;
  correctOrder?: string[];
}) {
  const shuffled = useMemo(() => seededShuffle(options, questionId), [options, questionId]);
  const settled = useDelayedFlag(revealed, 700, questionId);

  // During question: shuffled order. On reveal: correct order.
  const displayOptions = revealed && correctOrder
    ? correctOrder.map((id) => options.find((o) => o.id === id)!).filter(Boolean)
    : shuffled;

  return (
    <LayoutGroup>
      {displayOptions.map((opt, i) => (
        <motion.div
          key={opt.id}
          layout
          className="flex items-center gap-3 px-4 py-3 rounded-xl"
          style={{
            background: settled ? "rgba(76,175,80,0.15)" : "rgba(255,255,255,0.08)",
            border: `1px solid ${settled ? "rgba(76,175,80,0.3)" : "rgba(245,200,66,0.2)"}`,
            transition: "background 0.4s ease, border-color 0.4s ease",
          }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center font-bold shrink-0 text-sm"
            style={{
              background: settled ? "#4caf50" : "rgba(245,200,66,0.3)",
              color: settled ? "white" : "#f5c842",
              transition: "background 0.4s ease, color 0.4s ease",
            }}
          >
            {revealed ? i + 1 : "•"}
          </div>
          <span className="font-medium text-white flex-1 text-sm leading-snug">{opt.text}</span>
          <AnimatePresence>
            {settled && (
              <motion.span
                className="text-xl font-black shrink-0"
                style={{ color: "#4caf50" }}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 300, delay: i * 0.08 }}
              >
                &#x2713;
              </motion.span>
            )}
          </AnimatePresence>
        </motion.div>
      ))}
    </LayoutGroup>
  );
}

export function HostGamePage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const activeSession = useGameStore((s) => s.activeSession);
  const clearActiveSession = useGameStore((s) => s.clearActiveSession);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const [phase, setPhase] = useState<GamePhase>("waiting");
  const [currentQuestion, setCurrentQuestion] = useState<HostQuestionPayload | null>(null);
  const [revealPayload, setRevealPayload] = useState<AnswerRevealPayload | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [prevLeaderboard, setPrevLeaderboard] = useState<LeaderboardEntry[]>([]);
  const leaderboardRef = useRef<LeaderboardEntry[]>([]);
  const [podium, setPodium] = useState<PodiumEntry[]>([]);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [totalPlayers, setTotalPlayers] = useState(0);
  const [wsReady, setWsReady] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [timeLimit, setTimeLimit] = useState(20);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const { muted, toggleMute } = useGameAudio(phase);

  useEffect(() => {
    if (phase !== "question" || timeLeft <= 0) return;
    const id = setInterval(() => {
      setTimeLeft((t) => Math.max(0, t - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [phase, timeLeft]);

  const { send } = useWebSocket({
    url: `${WS_BASE}/api/v1/ws/host/${code}`,
    onOpen: () => setWsReady(true),
    onClose: () => setWsReady(false),
    onMessage: useCallback((msg: WsMessage) => {
      switch (msg.type) {
        case "question": {
          const p = msg.payload as HostQuestionPayload;
          setCurrentQuestion(p);
          setPhase("question");
          setAnsweredCount(0);
          setRevealPayload(null);
          setTimeLimit(p.question.time_limit);
          setTimeLeft(p.question.time_limit);
          break;
        }
        case "answer_count": {
          const p = msg.payload as { answered: number; total: number };
          setAnsweredCount(p.answered);
          setTotalPlayers(p.total);
          break;
        }
        case "answer_reveal": {
          const p = msg.payload as AnswerRevealPayload;
          setRevealPayload(p);
          setPhase("reveal");
          setTimeLeft(0);
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
          clearActiveSession();
          break;
        }
      }
    }, [clearActiveSession]),
    enabled: !!code,
  });

  const handleNextQuestion = () => setPhase("arc_transition");
  const handleEndGame = () => navigate("/admin");

  async function handleForceEndGame() {
    if (activeSession) {
      try { await endSession(activeSession.sessionId); } catch { /* ignore */ }
      clearActiveSession();
    }
    navigate("/admin", { replace: true });
  }

  if (phase === "waiting") {
    return (
      <div className="min-h-screen w-full relative overflow-hidden flex items-center justify-center" style={{ background: "#1a0a2e" }}>
        <div className="ramadan-pattern" />
        <div className="relative z-10 text-center space-y-4">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 3, repeat: Infinity, ease: "linear" }}>
            <CrescentIcon className="w-12 h-12 mx-auto" style={{ color: "#f5c842" }} />
          </motion.div>
          <p className="text-lg font-semibold text-white">Starting game…</p>
          <div className="flex items-center justify-center gap-2">
            <span className={`w-2 h-2 rounded-full ${wsReady ? "bg-green-400" : "bg-yellow-400"} animate-pulse`} />
            <p className="text-sm" style={{ color: wsReady ? "#4caf50" : "#f5c842" }}>
              {wsReady ? "Connected" : "Connecting…"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "podium") {
    return <PodiumScreen entries={podium.slice(0, 3)} onEnd={handleEndGame} endLabel="Back to Dashboard" />;
  }

  if (phase === "arc_transition") {
    return (
      <PrayerArcTransition
        onComplete={() => send({ type: "next_question", payload: {} })}
      />
    );
  }

  if (phase === "leaderboard") {
    const isLastQuestion = !currentQuestion || currentQuestion.question_index + 1 >= currentQuestion.total_questions;
    return (
      <div className="min-h-screen w-full relative overflow-hidden" style={{ background: "#1a0a2e" }}>
        <div className="ramadan-pattern" />
        <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-4 py-8">
          <div className="w-full max-w-lg space-y-6">
            <motion.h2 className="text-2xl font-black text-center" style={{ color: "#f5c842" }}
              initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
              Leaderboard
            </motion.h2>
            <LeaderboardDisplay entries={leaderboard} prevEntries={prevLeaderboard} />
            <motion.button
              onClick={handleNextQuestion}
              className="w-full py-4 rounded-xl font-bold text-lg text-white flex items-center justify-center gap-2"
              style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8c5a 100%)", boxShadow: "0 8px 30px rgba(255,107,53,0.4)" }}
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
              {isLastQuestion ? "Show Final Results" : "Next Question"}
              <ChevronRight className="w-5 h-5" />
            </motion.button>
          </div>
        </div>
      </div>
    );
  }

  // Question + Reveal split panel
  const circumference = 2 * Math.PI * 54;
  const dashOffset = circumference * (1 - timeLeft / Math.max(timeLimit, 1));
  const qType = currentQuestion?.question.type ?? "multiple_choice";
  const isOrdering = qType === "ordering";

  return (
    <div className="min-h-screen w-full relative overflow-hidden flex flex-col" style={{ background: "#1a0a2e" }}>
      <div className="ramadan-pattern" />

      {showEndConfirm && (
        <ConfirmModal
          title="End the game?"
          message="This will end the session for all players. This cannot be undone."
          confirmLabel="End Game"
          onConfirm={handleForceEndGame}
          onCancel={() => setShowEndConfirm(false)}
        />
      )}

      {/* Top bar */}
      <div className="relative z-20 px-4 sm:px-8 py-3 sm:py-4 flex items-center justify-between"
        style={{ background: "linear-gradient(180deg, rgba(30,15,50,0.95) 0%, rgba(20,10,40,0.9) 100%)", borderBottom: "1px solid rgba(245,200,66,0.2)" }}>
        <div className="flex items-center gap-2 sm:gap-3">
          <CrescentIcon className="w-6 h-6" style={{ color: "#f5c842" }} />
          <span className="hidden sm:inline text-lg font-bold" style={{ color: "#f5c842" }}>Hilal Live</span>
          <span className="font-mono text-sm px-2 py-0.5 rounded" style={{ background: "rgba(245,200,66,0.1)", color: "rgba(255,255,255,0.5)" }}>{code}</span>
        </div>
        {currentQuestion && (
          <div className="flex items-center gap-2 text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: "rgba(245,200,66,0.15)", color: "#f5c842" }}>
              {TYPE_LABELS[qType] ?? qType}
            </span>
            <span>Q <span className="font-bold text-white">{currentQuestion.question_index + 1}</span> / {currentQuestion.total_questions}</span>
          </div>
        )}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5">
            <Users className="w-4 h-4" style={{ color: "#2196f3" }} />
            <span className="font-bold text-white">{answeredCount}</span>
            {totalPlayers > 0 && (
              <span className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>/ {totalPlayers}</span>
            )}
            <span className="hidden sm:inline text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>answered</span>
            <span className={`ml-1 w-2 h-2 rounded-full ${wsReady ? "bg-green-400" : "bg-yellow-400"} animate-pulse`} />
          </div>
          <motion.button onClick={toggleMute} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            className="p-1.5 rounded-lg" aria-label={muted ? "Unmute audio" : "Mute audio"}
            style={{ background: "rgba(245,200,66,0.12)", color: muted ? "rgba(255,255,255,0.4)" : "#f5c842", border: "1px solid rgba(245,200,66,0.25)" }}>
            {muted ? <VolumeOff className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </motion.button>
          <motion.button onClick={() => setShowEndConfirm(true)} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-xs font-bold"
            style={{ background: "rgba(244,67,54,0.15)", color: "#f44336", border: "1px solid rgba(244,67,54,0.3)" }}>
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">End Game</span>
          </motion.button>
        </div>
      </div>

      {currentQuestion && (
        <div className="relative z-10 flex-1 flex flex-col gap-5 p-4 sm:p-6 max-w-2xl mx-auto w-full">
          {/* Progress bar */}
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>Progress</p>
              <p className="font-bold text-sm" style={{ color: "#f5c842" }}>
                Q{currentQuestion.question_index + 1} / {currentQuestion.total_questions}
              </p>
            </div>
            <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.1)" }}>
              <motion.div className="h-full rounded-full"
                style={{ background: "linear-gradient(90deg, #f5c842 0%, #ffd700 100%)" }}
                initial={{ width: 0 }}
                animate={{ width: `${((currentQuestion.question_index + 1) / currentQuestion.total_questions) * 100}%` }}
                transition={{ duration: 0.5 }} />
            </div>
          </motion.div>

          {/* Question card */}
          <motion.div className="p-8 rounded-3xl flex flex-col"
            style={{ background: "linear-gradient(135deg, rgba(42,20,66,0.9) 0%, rgba(30,15,50,0.95) 100%)", border: "2px solid rgba(245,200,66,0.3)", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}
            initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg"
                style={{ background: "rgba(245,200,66,0.2)", color: "#f5c842", border: "2px solid rgba(245,200,66,0.5)" }}>
                Q{currentQuestion.question_index + 1}
              </div>
              <CrescentIcon className="w-5 h-5" style={{ color: "#f5c842" }} />
            </div>
            <h2 className="text-3xl font-bold text-white leading-tight">{currentQuestion.question.text}</h2>

            {/* Question image */}
            {currentQuestion.question.image_url && (
              <img src={currentQuestion.question.image_url} alt="" className="mt-4 rounded-xl max-h-48 object-contain" />
            )}

            {/* Timer circle */}
            <div className="flex justify-center mt-8">
              <div className="relative w-28 h-28">
                <svg className="w-28 h-28" style={{ transform: "rotate(-90deg)" }} viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="54" stroke="rgba(245,200,66,0.15)" strokeWidth="8" fill="none" />
                  <circle cx="60" cy="60" r="54"
                    stroke={timeLeft <= 5 ? "#f44336" : "#f5c842"}
                    strokeWidth="8" fill="none" strokeLinecap="round"
                    style={{
                      strokeDasharray: circumference,
                      strokeDashoffset: dashOffset,
                      filter: `drop-shadow(0 0 ${timeLeft <= 5 ? "20px rgba(244,67,54,0.8)" : "12px rgba(245,200,66,0.6)"})`,
                      transition: "stroke-dashoffset 1s linear, stroke 0.3s ease",
                    }} />
                </svg>
                <motion.div className="absolute inset-0 flex items-center justify-center text-4xl font-black"
                  style={{ color: timeLeft <= 5 ? "#f44336" : "#f5c842" }}
                  animate={timeLeft <= 5 && timeLeft > 0 ? { scale: [1, 1.15, 1] } : {}}
                  transition={{ duration: 0.5, repeat: Infinity }}>
                  {timeLeft}
                </motion.div>
              </div>
            </div>
          </motion.div>

          {/* Status bar */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            {phase === "reveal" && revealPayload ? (
              <div className="p-4 rounded-xl flex items-center justify-center gap-2"
                style={{ background: "rgba(76,175,80,0.15)", border: "1px solid rgba(76,175,80,0.3)" }}>
                <span className="text-2xl font-black" style={{ color: "#4caf50" }}>
                  {Object.values(revealPayload.scores).filter((s) => s.is_correct).length}
                </span>
                <span className="text-sm" style={{ color: "rgba(255,255,255,0.7)" }}>
                  / {Object.keys(revealPayload.scores).length} {isOrdering ? "got full marks" : "answered correctly"}
                </span>
              </div>
            ) : (
              <div className="p-4 rounded-xl flex items-center gap-3"
                style={{ background: "rgba(245,200,66,0.08)", border: "1px solid rgba(245,200,66,0.2)" }}>
                <motion.div className="w-2 h-2 rounded-full bg-green-400" animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.5, repeat: Infinity }} />
                <span className="text-sm font-bold text-white">
                  {answeredCount}{totalPlayers > 0 ? ` / ${totalPlayers}` : ""}
                </span>
                <span className="text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>players have answered</span>
              </div>
            )}
          </motion.div>

          {/* Options */}
          <motion.div className="p-6 rounded-3xl space-y-3"
            style={{ background: "linear-gradient(135deg, rgba(42,20,66,0.9) 0%, rgba(30,15,50,0.95) 100%)", border: "2px solid rgba(245,200,66,0.3)", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold" style={{ color: "rgba(255,255,255,0.8)" }}>
                {isOrdering && phase === "reveal" ? "Correct Order" : "Answer Options"}
              </h3>
              {phase === "reveal" && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(76,175,80,0.2)", color: "#4caf50" }}>Revealed</span>
              )}
            </div>

            {isOrdering ? (
              <OrderingReveal
                options={currentQuestion.question.options}
                questionId={currentQuestion.question.id}
                revealed={phase === "reveal"}
                correctOrder={revealPayload?.correct_order}
              />
            ) : (
              /* ── MC / TF / Image Choice options ── */
              currentQuestion.question.options.map((opt, i) => {
                const color = OPTION_COLORS[i % 4];
                const isCorrect = opt.is_correct;
                const revealed = phase === "reveal";
                const dimmed = revealed && !isCorrect;
                return (
                  <motion.div key={opt.id}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl"
                    style={{
                      background: `${color}${dimmed ? "11" : "22"}`,
                      border: `2px solid ${revealed ? (isCorrect ? color : "rgba(255,255,255,0.08)") : `${color}55`}`,
                      opacity: dimmed ? 0.4 : 1,
                    }}
                    initial={{ opacity: 0, x: 20 }} animate={{ opacity: dimmed ? 0.4 : 1, x: 0 }} transition={{ delay: i * 0.08 }}>
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-white shrink-0 text-sm"
                      style={{ background: color }}>
                      {OPTION_LETTERS[i]}
                    </div>
                    {opt.image_url && (
                      <img src={opt.image_url} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                    )}
                    <span className="font-medium text-white flex-1 text-sm leading-snug">{opt.text}</span>
                    {revealed && isCorrect && (
                      <motion.span className="text-xl font-black shrink-0" style={{ color }}
                        initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300 }}>
                        &#x2713;
                      </motion.span>
                    )}
                  </motion.div>
                );
              })
            )}
          </motion.div>

          {phase === "reveal" && (
            <p className="text-center text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>
              Leaderboard coming up…
            </p>
          )}
        </div>
      )}
    </div>
  );
}
