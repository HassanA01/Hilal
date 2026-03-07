import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  BookOpen,
  Gamepad2,
  Users,
  MessageSquare,
  UserCheck,
  Trophy,
  ChevronDown,
  ChevronRight,
  Clock,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  fetchOverview,
  fetchGamesOverTime,
  fetchQuizPerformance,
  fetchQuizQuestions,
  fetchTopPlayers,
  fetchEngagement,
} from "../api/analytics";
import type {
  OverviewStats,
  QuizStats,
  QuestionStats,
  OptionDistribution,
  PeakHourBucket,
} from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number, decimals = 0): string {
  if (Number.isNaN(n) || n == null) return "0";
  if (Number.isInteger(n) && decimals === 0) return n.toLocaleString();
  return n.toFixed(decimals);
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function LoadingDots() {
  return (
    <div className="flex gap-3 justify-center py-12">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-3 h-3 rounded-full"
          style={{ background: "#f5c842" }}
          animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
        />
      ))}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div
      className="text-center py-12 rounded-2xl"
      style={{
        background: "rgba(244,67,54,0.1)",
        border: "1px solid rgba(244,67,54,0.3)",
      }}
    >
      <p style={{ color: "#f44336" }}>{message}</p>
    </div>
  );
}

function SectionCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl p-5 sm:p-6 ${className}`}
      style={{
        background: "linear-gradient(135deg, rgba(42,20,66,0.7) 0%, rgba(30,15,50,0.8) 100%)",
        border: "1px solid rgba(245,200,66,0.12)",
      }}
    >
      {children}
    </div>
  );
}

function ToggleGroup({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className="px-3 py-1 rounded-lg text-xs font-semibold transition-all"
          style={
            value === o.value
              ? { background: "#f5c842", color: "#1a0a2e" }
              : { color: "#f5c842", opacity: 0.7 }
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom Recharts tooltip
// ---------------------------------------------------------------------------

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; dataKey: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs shadow-lg"
      style={{
        background: "rgba(20,10,40,0.95)",
        border: "1px solid rgba(245,200,66,0.25)",
      }}
    >
      <p className="font-semibold text-white mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: "rgba(255,255,255,0.7)" }}>
          {p.dataKey === "games" ? "Games" : "Players"}: <span className="font-bold text-white">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview cards config
// ---------------------------------------------------------------------------

const OVERVIEW_CARDS: {
  key: keyof OverviewStats;
  label: string;
  icon: React.ElementType;
  decimal?: number;
}[] = [
  { key: "total_quizzes", label: "Total Quizzes", icon: BookOpen },
  { key: "total_games", label: "Total Games", icon: Gamepad2 },
  { key: "total_players", label: "Total Players", icon: Users },
  { key: "total_answers", label: "Total Answers", icon: MessageSquare },
  { key: "avg_players_per_game", label: "Avg Players / Game", icon: UserCheck, decimal: 1 },
  { key: "avg_score", label: "Avg Score", icon: Trophy, decimal: 1 },
];

// ---------------------------------------------------------------------------
// Peak-hours heatmap helpers
// ---------------------------------------------------------------------------

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function buildHeatmapGrid(buckets: PeakHourBucket[]): number[][] {
  // grid[day][hour] = count
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const b of buckets) {
    grid[b.day_of_week][b.hour] = b.count;
  }
  return grid;
}

function heatColor(count: number, max: number): string {
  if (max === 0 || count === 0) return "rgba(245,200,66,0.04)";
  const intensity = count / max;
  // interpolate opacity from 0.1 to 0.9
  const alpha = 0.1 + intensity * 0.8;
  return `rgba(245,200,66,${alpha.toFixed(2)})`;
}

// ---------------------------------------------------------------------------
// Question drill-down sub-component
// ---------------------------------------------------------------------------

function QuestionDrillDown({ quizId }: { quizId: string }) {
  const { data: questions, isLoading, isError } = useQuery({
    queryKey: ["analytics", "quiz-questions", quizId],
    queryFn: () => fetchQuizQuestions(quizId),
    enabled: !!quizId,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <LoadingDots />;
  if (isError) return <ErrorBox message="Failed to load question data." />;
  if (!questions || questions.length === 0) {
    return (
      <p className="text-sm py-4 text-center" style={{ color: "rgba(255,255,255,0.4)" }}>
        No question data available.
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-4">
      {questions.map((q: QuestionStats) => (
        <div
          key={q.id}
          className="rounded-xl p-4"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(245,200,66,0.08)" }}
        >
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: "rgba(245,200,66,0.15)", color: "#f5c842" }}>
              Q{q.order + 1}
            </span>
            <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>{q.type}</span>
          </div>
          <p className="text-sm text-white font-medium mb-3">{q.text}</p>

          <div className="flex flex-wrap gap-4 text-xs mb-3" style={{ color: "rgba(255,255,255,0.5)" }}>
            <span>Correct: <span className="text-white font-semibold">{fmt(q.correct_pct, 1)}%</span></span>
            <span>Avg Points: <span className="text-white font-semibold">{fmt(q.avg_points, 0)}</span></span>
            <span>Answers: <span className="text-white font-semibold">{q.total_answers}</span></span>
          </div>

          {/* Option distribution bars */}
          {q.options && q.options.length > 0 && (
            <div className="space-y-1.5">
              {q.options.map((opt: OptionDistribution, idx: number) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-xs w-28 truncate" style={{ color: "rgba(255,255,255,0.6)" }} title={opt.text}>
                    {opt.text}
                  </span>
                  <div className="flex-1 h-4 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.max(opt.pct, 1)}%`,
                        background: "linear-gradient(90deg, #f5c842, #ffd700)",
                        opacity: 0.8,
                      }}
                    />
                  </div>
                  <span className="text-xs w-12 text-right font-semibold" style={{ color: "rgba(255,255,255,0.6)" }}>
                    {fmt(opt.pct, 1)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export function AnalyticsDashboardPage() {
  // Games over time controls
  const [period, setPeriod] = useState("day");
  const [dateRange, setDateRange] = useState("30d");

  // Top players sort
  const [playerSort, setPlayerSort] = useState("score");

  // Quiz performance sort
  const [quizSort, setQuizSort] = useState("plays");
  const [quizOrder, setQuizOrder] = useState("desc");

  // Drill-down
  const [expandedQuizId, setExpandedQuizId] = useState<string | null>(null);

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  const {
    data: overview,
    isLoading: overviewLoading,
    isError: overviewError,
  } = useQuery({
    queryKey: ["analytics", "overview"],
    queryFn: fetchOverview,
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: timeseries,
    isLoading: timeseriesLoading,
    isError: timeseriesError,
  } = useQuery({
    queryKey: ["analytics", "games-over-time", period, dateRange],
    queryFn: () => fetchGamesOverTime(period, dateRange),
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: quizPerf,
    isLoading: quizPerfLoading,
    isError: quizPerfError,
  } = useQuery({
    queryKey: ["analytics", "quiz-performance", quizSort, quizOrder],
    queryFn: () => fetchQuizPerformance(quizSort, quizOrder),
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: topPlayers,
    isLoading: playersLoading,
    isError: playersError,
  } = useQuery({
    queryKey: ["analytics", "top-players", playerSort],
    queryFn: () => fetchTopPlayers(playerSort, 20),
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: engagement,
    isLoading: engagementLoading,
    isError: engagementError,
  } = useQuery({
    queryKey: ["analytics", "engagement"],
    queryFn: fetchEngagement,
    staleTime: 5 * 60 * 1000,
  });

  // -----------------------------------------------------------------------
  // Derived
  // -----------------------------------------------------------------------

  const isAllZeros =
    overview &&
    overview.total_quizzes === 0 &&
    overview.total_games === 0 &&
    overview.total_players === 0 &&
    overview.total_answers === 0;

  const heatmapGrid = engagement?.peak_hours ? buildHeatmapGrid(engagement.peak_hours) : null;
  const heatmapMax = heatmapGrid
    ? Math.max(...heatmapGrid.flat(), 1)
    : 1;

  // -----------------------------------------------------------------------
  // Quiz sort toggle helper
  // -----------------------------------------------------------------------

  function handleQuizSort(field: string) {
    if (quizSort === field) {
      setQuizOrder((prev) => (prev === "desc" ? "asc" : "desc"));
    } else {
      setQuizSort(field);
      setQuizOrder("desc");
    }
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div>
      {/* Title */}
      <motion.h2
        className="text-3xl font-black text-white mb-8"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        Analytics
      </motion.h2>

      {/* ============================================================== */}
      {/* 1. Overview Cards                                              */}
      {/* ============================================================== */}

      {overviewLoading && <LoadingDots />}
      {overviewError && <ErrorBox message="Failed to load analytics data." />}

      {overview && isAllZeros && (
        <motion.div
          className="text-center py-16 rounded-2xl mb-8"
          style={{ background: "rgba(245,200,66,0.05)", border: "2px dashed rgba(245,200,66,0.3)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <p className="text-lg text-white mb-1">No analytics data yet.</p>
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
            Host some games to start seeing stats here.
          </p>
        </motion.div>
      )}

      {overview && !isAllZeros && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
            {OVERVIEW_CARDS.map((card, i) => {
              const Icon = card.icon;
              return (
                <motion.div
                  key={card.key}
                  className="rounded-2xl p-4 sm:p-5"
                  style={{
                    background: "linear-gradient(135deg, rgba(42,20,66,0.7) 0%, rgba(30,15,50,0.8) 100%)",
                    border: "1px solid rgba(245,200,66,0.12)",
                  }}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                >
                  <Icon className="w-5 h-5 mb-2" style={{ color: "#f5c842" }} />
                  <p className="text-2xl sm:text-3xl font-black text-white leading-tight">
                    {fmt(overview[card.key], card.decimal ?? 0)}
                  </p>
                  <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.45)" }}>
                    {card.label}
                  </p>
                </motion.div>
              );
            })}
          </div>

          {/* ============================================================== */}
          {/* 2. Games Over Time                                             */}
          {/* ============================================================== */}

          <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <SectionCard className="mb-8">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
                <h3 className="text-lg font-bold text-white">Games Over Time</h3>
                <div className="flex flex-wrap gap-3">
                  <ToggleGroup
                    options={[
                      { label: "Day", value: "day" },
                      { label: "Week", value: "week" },
                      { label: "Month", value: "month" },
                    ]}
                    value={period}
                    onChange={setPeriod}
                  />
                  <ToggleGroup
                    options={[
                      { label: "7d", value: "7d" },
                      { label: "30d", value: "30d" },
                      { label: "90d", value: "90d" },
                      { label: "All", value: "all" },
                    ]}
                    value={dateRange}
                    onChange={setDateRange}
                  />
                </div>
              </div>

              {timeseriesLoading && <LoadingDots />}
              {timeseriesError && <ErrorBox message="Failed to load chart data." />}

              {timeseries && timeseries.length === 0 && (
                <p className="text-center text-sm py-8" style={{ color: "rgba(255,255,255,0.4)" }}>
                  No game data for this range.
                </p>
              )}

              {timeseries && timeseries.length > 0 && (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={timeseries} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                    <defs>
                      <linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f5c842" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#f5c842" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 12 }}
                      stroke="rgba(255,255,255,0.1)"
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 12 }}
                      stroke="rgba(255,255,255,0.1)"
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="games"
                      stroke="#f5c842"
                      strokeWidth={2}
                      fill="url(#goldGrad)"
                    />
                    <Area
                      type="monotone"
                      dataKey="players"
                      stroke="rgba(255,255,255,0.35)"
                      strokeWidth={1.5}
                      fill="none"
                      strokeDasharray="4 4"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </SectionCard>
          </motion.div>

          {/* ============================================================== */}
          {/* 3. Top Players                                                 */}
          {/* ============================================================== */}

          <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <SectionCard className="mb-8">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
                <h3 className="text-lg font-bold text-white">Top Players</h3>
                <ToggleGroup
                  options={[
                    { label: "Score", value: "score" },
                    { label: "Games", value: "games" },
                  ]}
                  value={playerSort}
                  onChange={setPlayerSort}
                />
              </div>

              {playersLoading && <LoadingDots />}
              {playersError && <ErrorBox message="Failed to load player data." />}

              {topPlayers && topPlayers.length === 0 && (
                <p className="text-center text-sm py-8" style={{ color: "rgba(255,255,255,0.4)" }}>
                  No player data yet.
                </p>
              )}

              {topPlayers && topPlayers.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ color: "rgba(255,255,255,0.4)" }}>
                        <th className="text-left py-2 px-2 font-medium">#</th>
                        <th className="text-left py-2 px-2 font-medium">Name</th>
                        <th className="text-right py-2 px-2 font-medium">Total Score</th>
                        <th className="text-right py-2 px-2 font-medium">Games</th>
                        <th className="text-right py-2 px-2 font-medium">Avg Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topPlayers.map((p, i) => (
                        <tr
                          key={`${p.name}-${i}`}
                          className="transition-colors"
                          style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
                        >
                          <td className="py-2.5 px-2 font-bold" style={{ color: i < 3 ? "#f5c842" : "rgba(255,255,255,0.5)" }}>
                            {i + 1}
                          </td>
                          <td className="py-2.5 px-2 text-white font-medium">{p.name}</td>
                          <td className="py-2.5 px-2 text-right text-white">{fmt(p.total_score)}</td>
                          <td className="py-2.5 px-2 text-right" style={{ color: "rgba(255,255,255,0.6)" }}>
                            {p.games_played}
                          </td>
                          <td className="py-2.5 px-2 text-right" style={{ color: "rgba(255,255,255,0.6)" }}>
                            {fmt(p.avg_score, 1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </motion.div>

          {/* ============================================================== */}
          {/* 4. Quiz Performance                                            */}
          {/* ============================================================== */}

          <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
            <SectionCard className="mb-8">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
                <h3 className="text-lg font-bold text-white">Quiz Performance</h3>
              </div>

              {quizPerfLoading && <LoadingDots />}
              {quizPerfError && <ErrorBox message="Failed to load quiz data." />}

              {quizPerf && quizPerf.length === 0 && (
                <p className="text-center text-sm py-8" style={{ color: "rgba(255,255,255,0.4)" }}>
                  No quiz data yet.
                </p>
              )}

              {quizPerf && quizPerf.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ color: "rgba(255,255,255,0.4)" }}>
                        <th className="text-left py-2 px-2 font-medium">Quiz</th>
                        <th
                          className="text-right py-2 px-2 font-medium cursor-pointer select-none hover:text-white transition-colors"
                          onClick={() => handleQuizSort("plays")}
                        >
                          Plays {quizSort === "plays" ? (quizOrder === "desc" ? "\u2193" : "\u2191") : ""}
                        </th>
                        <th
                          className="text-right py-2 px-2 font-medium cursor-pointer select-none hover:text-white transition-colors"
                          onClick={() => handleQuizSort("avg_score")}
                        >
                          Avg Score {quizSort === "avg_score" ? (quizOrder === "desc" ? "\u2193" : "\u2191") : ""}
                        </th>
                        <th className="text-right py-2 px-2 font-medium">Players</th>
                        <th className="text-right py-2 px-2 font-medium">Questions</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {quizPerf.map((q: QuizStats) => {
                        const isExpanded = expandedQuizId === q.id;
                        return (
                          <tr key={q.id} className="group" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                            <td colSpan={6} className="p-0">
                              <div
                                className="flex items-center cursor-pointer px-2 py-2.5 transition-colors rounded-lg"
                                style={{ background: isExpanded ? "rgba(245,200,66,0.05)" : "transparent" }}
                                onClick={() => setExpandedQuizId(isExpanded ? null : q.id)}
                              >
                                <span className="flex-1 text-white font-medium truncate pr-2">{q.title}</span>
                                <span className="w-16 text-right text-white">{q.plays}</span>
                                <span className="w-20 text-right" style={{ color: "rgba(255,255,255,0.6)" }}>
                                  {fmt(q.avg_score, 1)}
                                </span>
                                <span className="w-16 text-right" style={{ color: "rgba(255,255,255,0.6)" }}>
                                  {q.player_count}
                                </span>
                                <span className="w-20 text-right" style={{ color: "rgba(255,255,255,0.6)" }}>
                                  {q.question_count}
                                </span>
                                <span className="w-8 flex justify-center" style={{ color: "rgba(255,255,255,0.4)" }}>
                                  {isExpanded ? (
                                    <ChevronDown className="w-4 h-4" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4" />
                                  )}
                                </span>
                              </div>
                              {isExpanded && (
                                <div className="px-2 pb-3">
                                  <QuestionDrillDown quizId={q.id} />
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </motion.div>

          {/* ============================================================== */}
          {/* 5. Engagement                                                  */}
          {/* ============================================================== */}

          <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
            <SectionCard className="mb-8">
              <h3 className="text-lg font-bold text-white mb-5">Engagement</h3>

              {engagementLoading && <LoadingDots />}
              {engagementError && <ErrorBox message="Failed to load engagement data." />}

              {engagement && (
                <div className="space-y-6">
                  {/* Avg Game Duration card */}
                  <div
                    className="inline-flex items-center gap-3 rounded-xl px-4 py-3"
                    style={{
                      background: "rgba(245,200,66,0.08)",
                      border: "1px solid rgba(245,200,66,0.15)",
                    }}
                  >
                    <Clock className="w-5 h-5" style={{ color: "#f5c842" }} />
                    <div>
                      <p className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>Avg Game Duration</p>
                      <p className="text-xl font-black text-white">
                        {formatDuration(engagement.avg_game_duration_seconds)}
                      </p>
                    </div>
                  </div>

                  {/* Peak Hours Heatmap */}
                  {heatmapGrid && (
                    <div>
                      <p className="text-sm font-semibold text-white mb-3">Peak Hours</p>
                      <div className="overflow-x-auto">
                        <div className="inline-block">
                          {/* Hour labels row */}
                          <div className="flex items-center mb-1">
                            <div className="w-10" />
                            {Array.from({ length: 24 }, (_, h) => (
                              <div
                                key={h}
                                className="text-center"
                                style={{
                                  width: 24,
                                  fontSize: 9,
                                  color: "rgba(255,255,255,0.3)",
                                }}
                              >
                                {h}
                              </div>
                            ))}
                          </div>

                          {/* Rows */}
                          {heatmapGrid.map((row, dayIdx) => (
                            <div key={dayIdx} className="flex items-center mb-0.5">
                              <div
                                className="w-10 text-xs font-medium pr-2 text-right"
                                style={{ color: "rgba(255,255,255,0.5)" }}
                              >
                                {DAY_LABELS[dayIdx]}
                              </div>
                              {row.map((count, hourIdx) => (
                                <div
                                  key={hourIdx}
                                  className="rounded-sm"
                                  style={{
                                    width: 22,
                                    height: 22,
                                    margin: 1,
                                    background: heatColor(count, heatmapMax),
                                    transition: "background 0.2s",
                                  }}
                                  title={`${DAY_LABELS[dayIdx]} ${hourIdx}:00 — ${count} game${count !== 1 ? "s" : ""}`}
                                />
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </SectionCard>
          </motion.div>
        </>
      )}
    </div>
  );
}
