import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  Shield,
  BookOpen,
  Gamepad2,
  Users,
  UserCheck,
  Clock,
  Calendar,
  TrendingUp,
  CheckCircle,
  HelpCircle,
  RefreshCw,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  fetchPlatformOverview,
  fetchPlatformGrowth,
  fetchPlatformAdmins,
  fetchPlatformEngagement,
  fetchPlatformKPIs,
} from "../api/platform";
import { useAuthStore } from "../stores/authStore";
import type {
  PeakHourBucket,
  FunnelStage,
  DistributionBucket,
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

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
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

function SectionCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl p-5 sm:p-6 ${className}`}
      style={{
        background:
          "linear-gradient(135deg, rgba(42,20,66,0.7) 0%, rgba(30,15,50,0.8) 100%)",
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
// WoW change badge
// ---------------------------------------------------------------------------

function WoWBadge({ change }: { change: number }) {
  if (change === 0) return null;
  const isUp = change > 0;
  return (
    <span
      className="inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full ml-2"
      style={{
        background: isUp ? "rgba(76,175,80,0.15)" : "rgba(244,67,54,0.15)",
        color: isUp ? "#4caf50" : "#f44336",
      }}
    >
      {isUp ? "\u2191" : "\u2193"} {Math.abs(change).toFixed(1)}%
    </span>
  );
}

// ---------------------------------------------------------------------------
// Conversion Funnel
// ---------------------------------------------------------------------------

function FunnelChart({ stages }: { stages: FunnelStage[] }) {
  return (
    <div className="space-y-2">
      {stages.map((stage, i) => (
        <div key={stage.label} className="flex items-center gap-3">
          <div className="w-28 text-right">
            <p className="text-xs font-medium text-white">{stage.label}</p>
          </div>
          <div className="flex-1 relative">
            <div
              className="h-8 rounded-lg flex items-center px-3 transition-all"
              style={{
                width: `${Math.max(stage.pct, 5)}%`,
                background: `rgba(245,200,66,${0.1 + (1 - stage.pct / 100) * 0.3})`,
                border: "1px solid rgba(245,200,66,0.2)",
              }}
            >
              <span className="text-xs font-bold text-white whitespace-nowrap">
                {stage.count.toLocaleString()} ({stage.pct.toFixed(1)}%)
              </span>
            </div>
          </div>
          {i > 0 && (
            <span className="text-xs w-16 text-right" style={{ color: "#f44336" }}>
              -{(stages[i - 1].pct - stage.pct).toFixed(1)}%
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Player Count Distribution
// ---------------------------------------------------------------------------

function DistributionBars({ data }: { data: DistributionBucket[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-3">
          <div className="w-12 text-right">
            <span className="text-xs font-medium" style={{ color: "rgba(255,255,255,0.6)" }}>
              {d.label}
            </span>
          </div>
          <div className="flex-1">
            <div
              className="h-6 rounded-md flex items-center px-2"
              style={{
                width: `${Math.max((d.count / max) * 100, 3)}%`,
                background: "rgba(245,200,66,0.25)",
                border: "1px solid rgba(245,200,66,0.15)",
              }}
            >
              <span className="text-xs font-bold text-white">{d.count}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom Recharts tooltip
// ---------------------------------------------------------------------------

function GrowthTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  const labelMap: Record<string, string> = {
    admins: "Admins",
    quizzes: "Quizzes",
    games: "Games",
  };

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
        <p key={p.dataKey} style={{ color: p.color }}>
          {labelMap[p.dataKey] ?? p.dataKey}:{" "}
          <span className="font-bold text-white">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview cards config
// ---------------------------------------------------------------------------

const OVERVIEW_CARDS: {
  key: string;
  label: string;
  icon: React.ElementType;
  decimal?: number;
  wow?: string;
  format?: "duration" | "percent";
}[] = [
  { key: "total_games", label: "Total Games", icon: Gamepad2, wow: "games_wow_change" },
  { key: "total_players", label: "Total Players", icon: Users, wow: "players_wow_change" },
  { key: "avg_players_per_game", label: "Avg Players / Game", icon: UserCheck, decimal: 1 },
  { key: "avg_game_duration_seconds", label: "Avg Game Duration", icon: Clock, format: "duration" },
  { key: "total_quizzes", label: "Total Quizzes", icon: BookOpen },
  { key: "total_admins", label: "Total Admins", icon: Shield },
  { key: "game_completion_rate", label: "Completion Rate", icon: CheckCircle, format: "percent" },
  { key: "avg_questions_per_quiz", label: "Avg Questions / Quiz", icon: HelpCircle, decimal: 1 },
];

// ---------------------------------------------------------------------------
// Peak-hours heatmap helpers
// ---------------------------------------------------------------------------

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function buildHeatmapGrid(buckets: PeakHourBucket[]): number[][] {
  const grid: number[][] = Array.from({ length: 7 }, () =>
    Array(24).fill(0),
  );
  for (const b of buckets) {
    grid[b.day_of_week][b.hour] = b.count;
  }
  return grid;
}

function heatColor(count: number, max: number): string {
  if (max === 0 || count === 0) return "rgba(245,200,66,0.04)";
  const intensity = count / max;
  const alpha = 0.1 + intensity * 0.8;
  return `rgba(245,200,66,${alpha.toFixed(2)})`;
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export function PlatformDashboardPage() {
  const isSuperadmin = useAuthStore((s) => s.isSuperadmin);

  // Growth chart controls
  const [period, setPeriod] = useState("day");
  const [dateRange, setDateRange] = useState("30d");

  // Admin table sort
  const [adminSort, setAdminSort] = useState("quiz_count");
  const [adminOrder, setAdminOrder] = useState("desc");

  // -----------------------------------------------------------------------
  // Auth guard
  // -----------------------------------------------------------------------

  if (!isSuperadmin) {
    return (
      <div className="text-center py-16">
        <p className="text-white text-lg">Access denied</p>
        <p style={{ color: "rgba(255,255,255,0.4)" }}>
          This page is only available to platform administrators.
        </p>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /* eslint-disable react-hooks/rules-of-hooks */
  const {
    data: overview,
    isLoading: overviewLoading,
    isError: overviewError,
  } = useQuery({
    queryKey: ["platform", "overview"],
    queryFn: fetchPlatformOverview,
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: kpis,
    isLoading: kpisLoading,
    isError: kpisError,
  } = useQuery({
    queryKey: ["platform", "kpis"],
    queryFn: fetchPlatformKPIs,
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: growth,
    isLoading: growthLoading,
    isError: growthError,
  } = useQuery({
    queryKey: ["platform", "growth", period, dateRange],
    queryFn: () => fetchPlatformGrowth(period, dateRange),
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: admins,
    isLoading: adminsLoading,
    isError: adminsError,
  } = useQuery({
    queryKey: ["platform", "admins", adminSort, adminOrder],
    queryFn: () => fetchPlatformAdmins(adminSort, adminOrder),
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: engagement,
    isLoading: engagementLoading,
    isError: engagementError,
  } = useQuery({
    queryKey: ["platform", "engagement"],
    queryFn: fetchPlatformEngagement,
    staleTime: 5 * 60 * 1000,
  });
  /* eslint-enable react-hooks/rules-of-hooks */

  // -----------------------------------------------------------------------
  // Derived
  // -----------------------------------------------------------------------

  const heatmapGrid = engagement?.peak_hours
    ? buildHeatmapGrid(engagement.peak_hours)
    : null;
  const heatmapMax = heatmapGrid ? Math.max(...heatmapGrid.flat(), 1) : 1;

  // -----------------------------------------------------------------------
  // Admin sort toggle helper
  // -----------------------------------------------------------------------

  function handleAdminSort(field: string) {
    if (adminSort === field) {
      setAdminOrder((prev) => (prev === "desc" ? "asc" : "desc"));
    } else {
      setAdminSort(field);
      setAdminOrder("desc");
    }
  }

  // -----------------------------------------------------------------------
  // Card value formatter
  // -----------------------------------------------------------------------

  function formatCardValue(card: (typeof OVERVIEW_CARDS)[number], value: number): string {
    if (card.format === "duration") return formatDuration(value);
    if (card.format === "percent") return `${fmt(value * 100, 1)}%`;
    return fmt(value, card.decimal ?? 0);
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
        Platform Metrics
      </motion.h2>

      {/* ============================================================== */}
      {/* 1. Overview Cards                                              */}
      {/* ============================================================== */}

      {overviewLoading && <LoadingDots />}
      {overviewError && (
        <ErrorBox message="Failed to load platform overview." />
      )}

      {overview && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            {OVERVIEW_CARDS.map((card, i) => {
              const Icon = card.icon;
              const value = (overview as unknown as Record<string, number>)[card.key] ?? 0;
              const wowChange = card.wow
                ? (overview as unknown as Record<string, number>)[card.wow] ?? 0
                : undefined;
              return (
                <motion.div
                  key={card.key}
                  className="rounded-2xl p-4 sm:p-5"
                  style={{
                    background:
                      "linear-gradient(135deg, rgba(42,20,66,0.7) 0%, rgba(30,15,50,0.8) 100%)",
                    border: "1px solid rgba(245,200,66,0.12)",
                  }}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Icon
                      className="w-5 h-5"
                      style={{ color: "#f5c842" }}
                    />
                    {card.wow && (
                      <TrendingUp
                        className="w-3.5 h-3.5"
                        style={{ color: "rgba(255,255,255,0.3)" }}
                      />
                    )}
                  </div>
                  <p className="text-2xl sm:text-3xl font-black text-white leading-tight">
                    {formatCardValue(card, value)}
                    {wowChange !== undefined && <WoWBadge change={wowChange} />}
                  </p>
                  <p
                    className="text-xs mt-1"
                    style={{ color: "rgba(255,255,255,0.45)" }}
                  >
                    {card.label}
                  </p>
                </motion.div>
              );
            })}
          </div>

          {/* ============================================================== */}
          {/* 2. Conversion Funnel                                           */}
          {/* ============================================================== */}

          {kpisLoading && <LoadingDots />}
          {kpisError && (
            <ErrorBox message="Failed to load platform KPIs." />
          )}

          {kpis && (
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
            >
              <SectionCard className="mb-8">
                <h3 className="text-lg font-bold text-white mb-5">
                  Conversion Funnel
                </h3>
                {kpis.funnel && kpis.funnel.length > 0 ? (
                  <FunnelChart stages={kpis.funnel} />
                ) : (
                  <p
                    className="text-center text-sm py-8"
                    style={{ color: "rgba(255,255,255,0.4)" }}
                  >
                    No funnel data available.
                  </p>
                )}
              </SectionCard>
            </motion.div>
          )}

          {/* ============================================================== */}
          {/* 3. Player Count Distribution + Admin Retention                  */}
          {/* ============================================================== */}

          {kpis && (
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                {/* Player Count Distribution */}
                <SectionCard>
                  <h3 className="text-lg font-bold text-white mb-5">
                    Players per Game
                  </h3>
                  {kpis.player_count_distribution &&
                  kpis.player_count_distribution.length > 0 ? (
                    <DistributionBars data={kpis.player_count_distribution} />
                  ) : (
                    <p
                      className="text-center text-sm py-8"
                      style={{ color: "rgba(255,255,255,0.4)" }}
                    >
                      No distribution data available.
                    </p>
                  )}
                </SectionCard>

                {/* Admin Retention */}
                <SectionCard>
                  <h3 className="text-lg font-bold text-white mb-5">
                    Admin Retention
                  </h3>
                  <div className="flex flex-wrap gap-4">
                    <div
                      className="inline-flex items-center gap-3 rounded-xl px-4 py-3"
                      style={{
                        background: "rgba(245,200,66,0.08)",
                        border: "1px solid rgba(245,200,66,0.15)",
                      }}
                    >
                      <RefreshCw
                        className="w-5 h-5"
                        style={{ color: "#f5c842" }}
                      />
                      <div>
                        <p
                          className="text-xs"
                          style={{
                            color: "rgba(255,255,255,0.45)",
                          }}
                        >
                          7-day Retention
                        </p>
                        <p className="text-xl font-black text-white">
                          {fmt(kpis.admin_retention_7d * 100, 1)}%
                        </p>
                      </div>
                    </div>

                    <div
                      className="inline-flex items-center gap-3 rounded-xl px-4 py-3"
                      style={{
                        background: "rgba(245,200,66,0.08)",
                        border: "1px solid rgba(245,200,66,0.15)",
                      }}
                    >
                      <RefreshCw
                        className="w-5 h-5"
                        style={{ color: "#f5c842" }}
                      />
                      <div>
                        <p
                          className="text-xs"
                          style={{
                            color: "rgba(255,255,255,0.45)",
                          }}
                        >
                          30-day Retention
                        </p>
                        <p className="text-xl font-black text-white">
                          {fmt(kpis.admin_retention_30d * 100, 1)}%
                        </p>
                      </div>
                    </div>
                  </div>
                </SectionCard>
              </div>
            </motion.div>
          )}

          {/* ============================================================== */}
          {/* 4. Platform Growth Chart                                       */}
          {/* ============================================================== */}

          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
          >
            <SectionCard className="mb-8">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
                <h3 className="text-lg font-bold text-white">
                  Platform Growth
                </h3>
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

              {growthLoading && <LoadingDots />}
              {growthError && (
                <ErrorBox message="Failed to load growth data." />
              )}

              {growth && growth.length === 0 && (
                <p
                  className="text-center text-sm py-8"
                  style={{ color: "rgba(255,255,255,0.4)" }}
                >
                  No growth data for this range.
                </p>
              )}

              {growth && growth.length > 0 && (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart
                    data={growth}
                    margin={{ top: 5, right: 5, left: -10, bottom: 5 }}
                  >
                    <defs>
                      <linearGradient
                        id="goldGradPlatform"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="#f5c842"
                          stopOpacity={0.4}
                        />
                        <stop
                          offset="100%"
                          stopColor="#f5c842"
                          stopOpacity={0.02}
                        />
                      </linearGradient>
                      <linearGradient
                        id="orangeGradPlatform"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="#ff6b35"
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="100%"
                          stopColor="#ff6b35"
                          stopOpacity={0.02}
                        />
                      </linearGradient>
                      <linearGradient
                        id="greenGradPlatform"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="#4caf50"
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="100%"
                          stopColor="#4caf50"
                          stopOpacity={0.02}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      stroke="rgba(255,255,255,0.06)"
                      strokeDasharray="3 3"
                    />
                    <XAxis
                      dataKey="date"
                      tick={{
                        fill: "rgba(255,255,255,0.4)",
                        fontSize: 12,
                      }}
                      stroke="rgba(255,255,255,0.1)"
                      tickLine={false}
                    />
                    <YAxis
                      tick={{
                        fill: "rgba(255,255,255,0.4)",
                        fontSize: 12,
                      }}
                      stroke="rgba(255,255,255,0.1)"
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip content={<GrowthTooltip />} />
                    <Legend
                      wrapperStyle={{
                        fontSize: 12,
                        color: "rgba(255,255,255,0.6)",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="admins"
                      name="Admins"
                      stroke="#f5c842"
                      strokeWidth={2}
                      fill="url(#goldGradPlatform)"
                    />
                    <Area
                      type="monotone"
                      dataKey="quizzes"
                      name="Quizzes"
                      stroke="#ff6b35"
                      strokeWidth={2}
                      fill="url(#orangeGradPlatform)"
                    />
                    <Area
                      type="monotone"
                      dataKey="games"
                      name="Games"
                      stroke="#4caf50"
                      strokeWidth={2}
                      fill="url(#greenGradPlatform)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </SectionCard>
          </motion.div>

          {/* ============================================================== */}
          {/* 5. Admin Activity Table                                        */}
          {/* ============================================================== */}

          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <SectionCard className="mb-8">
              <h3 className="text-lg font-bold text-white mb-5">
                Admin Activity
              </h3>

              {adminsLoading && <LoadingDots />}
              {adminsError && (
                <ErrorBox message="Failed to load admin data." />
              )}

              {admins && admins.length === 0 && (
                <p
                  className="text-center text-sm py-8"
                  style={{ color: "rgba(255,255,255,0.4)" }}
                >
                  No admin data yet.
                </p>
              )}

              {admins && admins.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ color: "rgba(255,255,255,0.4)" }}>
                        <th className="text-left py-2 px-2 font-medium">
                          Email
                        </th>
                        <th
                          className="text-right py-2 px-2 font-medium cursor-pointer select-none hover:text-white transition-colors"
                          onClick={() => handleAdminSort("quiz_count")}
                        >
                          Quizzes{" "}
                          {adminSort === "quiz_count"
                            ? adminOrder === "desc"
                              ? "\u2193"
                              : "\u2191"
                            : ""}
                        </th>
                        <th
                          className="text-right py-2 px-2 font-medium cursor-pointer select-none hover:text-white transition-colors"
                          onClick={() => handleAdminSort("game_count")}
                        >
                          Games{" "}
                          {adminSort === "game_count"
                            ? adminOrder === "desc"
                              ? "\u2193"
                              : "\u2191"
                            : ""}
                        </th>
                        <th className="text-right py-2 px-2 font-medium">
                          Players
                        </th>
                        <th
                          className="text-right py-2 px-2 font-medium cursor-pointer select-none hover:text-white transition-colors"
                          onClick={() => handleAdminSort("last_active")}
                        >
                          Last Active{" "}
                          {adminSort === "last_active"
                            ? adminOrder === "desc"
                              ? "\u2193"
                              : "\u2191"
                            : ""}
                        </th>
                        <th className="text-right py-2 px-2 font-medium">
                          Joined
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {admins.map((a) => (
                        <tr
                          key={a.id}
                          className="transition-colors"
                          style={{
                            borderTop:
                              "1px solid rgba(255,255,255,0.05)",
                          }}
                        >
                          <td className="py-2.5 px-2 text-white font-medium truncate max-w-[200px]">
                            {a.email}
                          </td>
                          <td className="py-2.5 px-2 text-right text-white">
                            {a.quiz_count}
                          </td>
                          <td className="py-2.5 px-2 text-right text-white">
                            {a.game_count}
                          </td>
                          <td
                            className="py-2.5 px-2 text-right"
                            style={{
                              color: "rgba(255,255,255,0.6)",
                            }}
                          >
                            {a.player_count}
                          </td>
                          <td
                            className="py-2.5 px-2 text-right"
                            style={{
                              color: "rgba(255,255,255,0.6)",
                            }}
                          >
                            {formatDate(a.last_active)}
                          </td>
                          <td
                            className="py-2.5 px-2 text-right"
                            style={{
                              color: "rgba(255,255,255,0.6)",
                            }}
                          >
                            {formatDate(a.created_at)}
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
          {/* 6. Engagement                                                  */}
          {/* ============================================================== */}

          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <SectionCard className="mb-8">
              <h3 className="text-lg font-bold text-white mb-5">
                Engagement
              </h3>

              {engagementLoading && <LoadingDots />}
              {engagementError && (
                <ErrorBox message="Failed to load engagement data." />
              )}

              {engagement && (
                <div className="space-y-6">
                  {/* Stat pills */}
                  <div className="flex flex-wrap gap-4">
                    <div
                      className="inline-flex items-center gap-3 rounded-xl px-4 py-3"
                      style={{
                        background: "rgba(245,200,66,0.08)",
                        border: "1px solid rgba(245,200,66,0.15)",
                      }}
                    >
                      <Clock
                        className="w-5 h-5"
                        style={{ color: "#f5c842" }}
                      />
                      <div>
                        <p
                          className="text-xs"
                          style={{
                            color: "rgba(255,255,255,0.45)",
                          }}
                        >
                          Avg Game Duration
                        </p>
                        <p className="text-xl font-black text-white">
                          {formatDuration(
                            engagement.avg_game_duration_seconds,
                          )}
                        </p>
                      </div>
                    </div>

                    <div
                      className="inline-flex items-center gap-3 rounded-xl px-4 py-3"
                      style={{
                        background: "rgba(245,200,66,0.08)",
                        border: "1px solid rgba(245,200,66,0.15)",
                      }}
                    >
                      <Calendar
                        className="w-5 h-5"
                        style={{ color: "#f5c842" }}
                      />
                      <div>
                        <p
                          className="text-xs"
                          style={{
                            color: "rgba(255,255,255,0.45)",
                          }}
                        >
                          Total Active Days
                        </p>
                        <p className="text-xl font-black text-white">
                          {engagement.total_active_days}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Peak Hours Heatmap */}
                  {heatmapGrid && (
                    <div>
                      <p className="text-sm font-semibold text-white mb-3">
                        Peak Hours
                      </p>
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
                            <div
                              key={dayIdx}
                              className="flex items-center mb-0.5"
                            >
                              <div
                                className="w-10 text-xs font-medium pr-2 text-right"
                                style={{
                                  color: "rgba(255,255,255,0.5)",
                                }}
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
                                    background: heatColor(
                                      count,
                                      heatmapMax,
                                    ),
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
