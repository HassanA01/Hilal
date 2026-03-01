import { useLayoutEffect, useRef, useState, useEffect } from "react";
import type { LeaderboardEntry } from "../types";

interface Props {
  entries: LeaderboardEntry[];
  /** Previous leaderboard — when provided, items animate from their old rank to their new rank. */
  prevEntries?: LeaderboardEntry[];
  highlightPlayerId?: string;
  maxEntries?: number;
}

const MEDALS = ["🥇", "🥈", "🥉"];

export function LeaderboardDisplay({
  entries,
  prevEntries,
  highlightPlayerId,
  maxEntries = 5,
}: Props) {
  const shown = entries.slice(0, maxEntries);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Capture initial prop values so the one-shot layout effect can use them.
  const initRef = useRef({ prevEntries, shown, maxEntries });

  const hasPrev = !!(prevEntries && prevEntries.length > 0);

  // --- Entrance animation (first leaderboard, no rank-change history) ---
  // Items slide up with a stagger. Only runs when there is no prior data.
  const [visible, setVisible] = useState(hasPrev);
  useEffect(() => {
    if (hasPrev) return;
    const t = setTimeout(() => setVisible(true), 0);
    return () => clearTimeout(t);
  }, [hasPrev]);

  // --- FLIP animation (subsequent leaderboards) ---
  // On mount, each item is already at its NEW position in the DOM.
  // We calculate where it was in the PREVIOUS layout and apply an inverse
  // transform so it visually starts at its old position, then animate to 0.
  useLayoutEffect(() => {
    const { prevEntries: prev, shown: currentShown, maxEntries: limit } = initRef.current;
    if (!prev || prev.length === 0) return;

    // Measure actual DOM tops for the new layout.
    const currentTops = new Map<string, number>();
    itemRefs.current.forEach((el, id) => {
      if (el) currentTops.set(id, el.offsetTop);
    });

    // Derive the per-item step size from the DOM (item height + gap).
    const sortedTops = [...currentTops.values()].sort((a, b) => a - b);
    const stepSize = sortedTops.length > 1 ? sortedTops[1] - sortedTops[0] : 60;

    // Build a map of player_id → previous rank index (0-based, within the slice).
    const prevRankMap = new Map<string, number>();
    prev.slice(0, limit).forEach((e, i) => {
      prevRankMap.set(e.player_id, i);
    });

    itemRefs.current.forEach((el, playerId) => {
      if (!el) return;
      const prevIdx = prevRankMap.get(playerId);
      if (prevIdx === undefined) return; // new entrant — no FLIP needed

      const currentIdx = currentShown.findIndex((e) => e.player_id === playerId);
      if (currentIdx === -1) return;

      // delta > 0  → item moved UP   (apply positive offset so it starts below, slides up)
      // delta < 0  → item moved DOWN (apply negative offset so it starts above, slides down)
      const delta = (prevIdx - currentIdx) * stepSize;
      if (Math.abs(delta) < 2) return;

      // Invert: place the element at its old visual position.
      el.style.transition = "none";
      el.style.transform = `translateY(${delta}px)`;
      el.getBoundingClientRect(); // flush: forces the browser to acknowledge the no-transition state
      // Animate to its actual (new) position.
      el.style.transition = "transform 0.45s cubic-bezier(0.4, 0, 0.2, 1)";
      el.style.transform = "translateY(0)";
    });
  }, []); // intentionally mount-only — initRef holds the initial prop snapshot

  const setRef = (playerId: string) => (el: HTMLDivElement | null) => {
    if (el) itemRefs.current.set(playerId, el);
    else itemRefs.current.delete(playerId);
  };

  return (
    <div className="space-y-2">
      {shown.map((entry, i) => {
        const isHighlighted = !!highlightPlayerId && entry.player_id === highlightPlayerId;
        const rank = MEDALS[i] ?? `#${entry.rank}`;

        return (
          <div
            key={entry.player_id}
            ref={setRef(entry.player_id)}
            style={
              !hasPrev
                ? {
                    transitionDelay: `${i * 80}ms`,
                    transition: "opacity 0.4s ease, transform 0.4s ease",
                  }
                : undefined
            }
            className={[
              "rounded-xl px-5 py-3 flex items-center justify-between",
              !hasPrev
                ? visible
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-4"
                : "opacity-100",
              isHighlighted
                ? "bg-indigo-900/50 border border-indigo-600"
                : "bg-gray-900",
            ].join(" ")}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-8 text-center font-black text-lg shrink-0">{rank}</span>
              <span className="font-medium truncate">{entry.name}</span>
              {isHighlighted && (
                <span className="text-xs text-indigo-400 shrink-0">(you)</span>
              )}
            </div>
            <span className="font-bold text-indigo-300 tabular-nums shrink-0 ml-2">{entry.score}</span>
          </div>
        );
      })}
    </div>
  );
}
