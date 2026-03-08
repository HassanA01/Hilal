import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import confetti from "canvas-confetti";
import { Trophy, Sparkles } from "lucide-react";
import { LanternIcon, CrescentIcon } from "./icons";
import type { PodiumEntry, PlayerResults } from "../types";

interface Props {
  entries: PodiumEntry[];
  playerId?: string;
  onEnd?: () => void;
  endLabel?: string;
  playerResults?: PlayerResults | null;
}

const GOLD_COLORS = ["#f5c842", "#ffd700", "#daa520", "#fff8dc", "#ff6b35", "#cd7f32"];

function fireCelebration() {
  const duration = 6000;
  const end = Date.now() + duration;

  // Side cannons — continuous confetti rain
  const frame = () => {
    confetti({
      particleCount: 3,
      angle: 60,
      spread: 55,
      origin: { x: 0, y: 0.6 },
      colors: GOLD_COLORS,
      ticks: 200,
      gravity: 0.8,
      scalar: 1.2,
      drift: 0.5,
    });
    confetti({
      particleCount: 3,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 0.6 },
      colors: GOLD_COLORS,
      ticks: 200,
      gravity: 0.8,
      scalar: 1.2,
      drift: -0.5,
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Firework bursts — staggered explosions from bottom
  const launchFirework = (delay: number, x: number) => {
    setTimeout(() => {
      // Big burst
      confetti({
        particleCount: 80,
        spread: 360,
        origin: { x, y: 0.3 + Math.random() * 0.2 },
        colors: GOLD_COLORS,
        ticks: 300,
        gravity: 0.6,
        scalar: 1.5,
        startVelocity: 30,
        shapes: ["circle", "square"],
      });
      // Trailing sparkles
      confetti({
        particleCount: 20,
        spread: 360,
        origin: { x, y: 0.3 + Math.random() * 0.2 },
        colors: ["#ffffff", "#f5c842"],
        ticks: 200,
        gravity: 0.4,
        scalar: 0.8,
        startVelocity: 15,
      });
    }, delay);
  };

  // Staggered fireworks across the screen
  launchFirework(300, 0.5);
  launchFirework(800, 0.25);
  launchFirework(1300, 0.75);
  launchFirework(2000, 0.4);
  launchFirework(2600, 0.6);
  launchFirework(3200, 0.3);
  launchFirework(3800, 0.7);
  launchFirework(4500, 0.5);

  // Grand finale — massive center burst
  setTimeout(() => {
    confetti({
      particleCount: 150,
      spread: 360,
      origin: { x: 0.5, y: 0.35 },
      colors: GOLD_COLORS,
      ticks: 400,
      gravity: 0.5,
      scalar: 2,
      startVelocity: 40,
      shapes: ["circle", "square"],
    });
  }, 5200);
}

const RANK_MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };
const RANK_TESTIDS: Record<number, string> = { 1: "podium-slot-1st", 2: "podium-slot-2nd", 3: "podium-slot-3rd" };

function PodiumBlock({
  entry, rank, height, isSelf, delay,
}: { entry: PodiumEntry; rank: number; height: number; isSelf: boolean; delay: number }) {
  const borderColor = rank === 1 ? "#f5c842" : rank === 2 ? "#c0c0c0" : "#cd7f32";
  const bgColor = rank === 1 ? "rgba(245,200,66,0.3)" : rank === 2 ? "rgba(192,192,192,0.2)" : "rgba(205,127,50,0.2)";
  const avatarGrad = rank === 1
    ? "linear-gradient(135deg, #f5c842 0%, #ffd700 100%)"
    : rank === 2
    ? "linear-gradient(135deg, #c0c0c0 0%, #e8e8e8 100%)"
    : "linear-gradient(135deg, #cd7f32 0%, #d4a574 100%)";
  const avatarColor = rank <= 2 ? "#1a0a2e" : "white";
  const avatarSize = rank === 1 ? "w-24 h-24 text-3xl" : "w-20 h-20 text-2xl";

  return (
    <motion.div
      className="flex flex-col items-center"
      data-testid={RANK_TESTIDS[rank]}
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay, type: "spring", stiffness: 100 }}
    >
      {/* Avatar */}
      <motion.div
        className={`${avatarSize} rounded-full flex items-center justify-center mb-3 relative font-black`}
        style={{ background: avatarGrad, boxShadow: `0 6px ${rank === 1 ? 40 : 25}px ${borderColor}90`, color: avatarColor }}
        animate={rank === 1 ? { boxShadow: [`0 6px 40px ${borderColor}cc`, `0 6px 60px ${borderColor}ff`, `0 6px 40px ${borderColor}cc`] } : {}}
        transition={{ duration: 1.5, repeat: Infinity }}
      >
        {entry.name[0]?.toUpperCase()}
        <div
          className={`absolute ${rank === 1 ? "-top-3 -right-3 w-10 h-10" : "-top-2 -right-2 w-8 h-8"} rounded-full flex items-center justify-center text-lg`}
          style={{ background: borderColor }}
        >
          {RANK_MEDALS[rank]}
        </div>
      </motion.div>

      {/* Podium block */}
      <div
        className={`${rank === 1 ? "w-32" : "w-28"} rounded-t-2xl px-3 py-4 text-center relative overflow-hidden`}
        style={{ height: `${height}px`, background: bgColor, border: `3px solid ${borderColor}` }}
      >
        {rank === 1 && (
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent"
            animate={{ x: ["-100%", "200%"] }}
            transition={{ duration: 2, repeat: Infinity, repeatDelay: 1 }}
            style={{ opacity: 0.15 }}
          />
        )}
        {rank === 1 && <CrescentIcon className="w-5 h-5 mx-auto mb-1" style={{ color: "#f5c842" }} />}
        <p className="text-white font-bold text-xs truncate mb-1">{entry.name}{isSelf ? " (you)" : ""}</p>
        <p className={`font-black ${rank === 1 ? "text-3xl" : "text-2xl"}`} style={{ color: borderColor }}>{entry.score}</p>
        <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.6)" }}>
          {rank === 1 ? "CHAMPION!" : rank === 2 ? "2nd Place" : "3rd Place"}
        </p>
      </div>
    </motion.div>
  );
}

export function PodiumScreen({ entries, playerId, onEnd, endLabel = "Back to Dashboard", playerResults }: Props) {
  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3);
  const myEntry = entries.find((e) => e.player_id === playerId);
  const firedRef = useRef(false);

  useEffect(() => {
    if (!firedRef.current) {
      firedRef.current = true;
      fireCelebration();
    }
  }, []);
  const isChampion = myEntry?.rank === 1;
  const [showBreakdown, setShowBreakdown] = useState(false);

  return (
    <div className="min-h-screen w-full relative overflow-hidden" style={{ background: "#1a0a2e" }}>
      <div className="ramadan-pattern" />

      <div className="relative z-10 min-h-screen flex flex-col px-6 py-8 max-w-md mx-auto">
        {/* Floating lanterns */}
        <div className="absolute top-10 left-1/2 -translate-x-1/2 flex gap-20">
          {[{ delay: 0, rot: [-5, 5, -5] }, { delay: 0.5, rot: [5, -5, 5] }].map((l, i) => (
            <motion.div key={i} animate={{ y: [0, -15, 0], rotate: l.rot as [number, number, number] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: l.delay }}>
              <LanternIcon className="w-12 h-12 drop-shadow-[0_0_20px_rgba(245,200,66,0.7)]" style={{ color: "#f5c842" }} />
            </motion.div>
          ))}
        </div>

        {/* Header */}
        <motion.div className="text-center mb-8 mt-20" initial={{ opacity: 0, y: -30 }} animate={{ opacity: 1, y: 0 }}>
          <motion.div className="flex items-center justify-center gap-3 mb-4"
            animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 2, repeat: Infinity }}>
            <Sparkles className="w-8 h-8" style={{ color: "#f5c842" }} />
            <Trophy className="w-12 h-12 drop-shadow-[0_0_30px_rgba(245,200,66,0.8)]" style={{ color: "#f5c842" }} />
            <Sparkles className="w-8 h-8" style={{ color: "#f5c842" }} />
          </motion.div>
          <h1 className="text-4xl font-black mb-2" style={{ color: "#f5c842", textShadow: "0 0 20px rgba(245,200,66,0.6)" }}>
            Game Over!
          </h1>
          <p style={{ color: "rgba(255,255,255,0.7)" }}>May your Iftaar be blessed ✨</p>
        </motion.div>

        {/* Podium — order: 2nd, 1st, 3rd */}
        {top3.length > 0 && (
          <motion.div className="flex items-end justify-center gap-4 mb-8"
            initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 }}>
            {([1, 0, 2] as const).map((entryIdx, slot) => {
              const entry = top3[entryIdx];
              if (!entry) return <div key={slot} className="w-28" />;
              const ranks = [2, 1, 3];
              const heights = [120, 150, 100];
              const delays = [0.6, 0.5, 0.7];
              return (
                <PodiumBlock key={entry.player_id} entry={entry} rank={ranks[slot]}
                  height={heights[slot]} isSelf={entry.player_id === playerId} delay={delays[slot]} />
              );
            })}
          </motion.div>
        )}

        {/* Congrats / encouragement message */}
        <motion.div className="text-center mb-6 px-6 py-4 rounded-2xl"
          style={{ background: "rgba(245, 200, 66, 0.1)", border: "1px solid rgba(245, 200, 66, 0.3)" }}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}>
          {isChampion ? (
            <p className="font-bold text-lg" style={{ color: "#f5c842" }}>🎉 Congratulations, Champion! 🎉</p>
          ) : (
            <p className="text-white">Great job! Thanks for playing with us 💫</p>
          )}
        </motion.div>

        {/* My score (if not in top 3) */}
        {myEntry && myEntry.rank > 3 && (
          <motion.div className="mb-6 p-5 rounded-2xl text-center"
            style={{ background: "rgba(245, 200, 66, 0.1)", border: "2px solid rgba(245, 200, 66, 0.3)" }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }}>
            <p className="text-sm mb-1" style={{ color: "rgba(255,255,255,0.7)" }}>Your final score</p>
            <p className="text-4xl font-black" style={{ color: "#f5c842" }}>{myEntry.score}</p>
            <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.6)" }}>Rank #{myEntry.rank}</p>
          </motion.div>
        )}

        {/* Remaining players */}
        {rest.length > 0 && (
          <div className="mb-6 space-y-2">
            {rest.map((entry) => {
              const isSelf = entry.player_id === playerId;
              return (
                <div key={entry.player_id} className="rounded-xl px-4 py-3 flex items-center gap-4"
                  style={{
                    background: isSelf ? "rgba(245,200,66,0.15)" : "rgba(255,255,255,0.08)",
                    border: `2px solid ${isSelf ? "rgba(245,200,66,0.4)" : "transparent"}`,
                  }}>
                  <span className="w-8 text-center font-bold shrink-0" style={{ color: "rgba(255,255,255,0.6)" }}>#{entry.rank}</span>
                  <span className="font-medium text-white flex-1 truncate">{entry.name}{isSelf && <span className="ml-2 text-xs" style={{ color: "#f5c842" }}>(you)</span>}</span>
                  <span className="font-bold tabular-nums shrink-0" style={{ color: "#f5c842" }}>{entry.score}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Personal question breakdown — hidden until player taps "See how you scored" */}
        {playerResults && playerResults.questions.length > 0 && (
          <div className="mb-6">
            {!showBreakdown && (
              <motion.button
                onClick={() => setShowBreakdown(true)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="w-full py-3 rounded-xl font-bold text-base"
                style={{
                  background: "rgba(245,200,66,0.12)",
                  border: "2px solid rgba(245,200,66,0.4)",
                  color: "#f5c842",
                }}
              >
                See how you scored
              </motion.button>
            )}
            {showBreakdown && (
                <motion.div
                  data-testid="player-results-breakdown"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                >
                  <h2 className="text-lg font-bold mb-3 text-center text-white">Your Performance</h2>
                  <div className="space-y-2">
                    {playerResults.questions.map((q, i) => (
                      <div key={q.question_id} className="rounded-xl px-4 py-3 flex items-start gap-3"
                        style={{
                          background: q.is_correct ? "rgba(76,175,80,0.15)" : "rgba(244,67,54,0.15)",
                          border: `1px solid ${q.is_correct ? "rgba(76,175,80,0.4)" : "rgba(244,67,54,0.4)"}`,
                        }}>
                        <span className="text-xl mt-0.5 flex-shrink-0">{q.is_correct ? "✓" : "✗"}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white leading-snug">{i + 1}. {q.question_text}</p>
                          <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.6)" }}>
                            Your answer: <span style={{ color: q.is_correct ? "#4caf50" : "#f44336" }}>{q.selected_option_text}</span>
                          </p>
                          {!q.is_correct && (
                            <p className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
                              Correct: <span style={{ color: "#4caf50" }}>{q.correct_option_text}</span>
                            </p>
                          )}
                        </div>
                        {q.is_correct && <span className="font-black tabular-nums text-sm shrink-0" style={{ color: "#4caf50" }}>+{q.points}</span>}
                      </div>
                    ))}
                  </div>
                </motion.div>
            )}
          </div>
        )}

        {/* Action */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }}>
          {onEnd ? (
            <motion.button onClick={onEnd} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              className="w-full py-4 rounded-xl font-bold text-lg text-white"
              style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8c5a 100%)", boxShadow: "0 8px 30px rgba(255,107,53,0.4)" }}>
              {endLabel}
            </motion.button>
          ) : (
            <motion.a href="/join" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              className="w-full block text-center py-4 rounded-xl font-bold text-lg text-white"
              style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8c5a 100%)", boxShadow: "0 8px 30px rgba(255,107,53,0.4)" }}>
              Play Again
            </motion.a>
          )}
        </motion.div>
      </div>
    </div>
  );
}
