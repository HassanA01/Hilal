import { useState, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSessionByCode, listSessionPlayers } from "../api/sessions";
import { useWebSocket } from "../hooks/useWebSocket";
import type { WsMessage } from "../types";

const WS_BASE = import.meta.env.VITE_WS_BASE_URL ?? "ws://localhost:8081";

interface PlayerInfo {
  id: string;
  name: string;
}

interface WsPlayerEvent {
  type: "joined" | "left";
  player_id: string;
  name: string;
}

export function PlayerLobbyPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  const playerId = sessionStorage.getItem("player_id") ?? "";
  const playerName = sessionStorage.getItem("player_name") ?? "";

  const [wsReady, setWsReady] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const [wsEvents, setWsEvents] = useState<WsPlayerEvent[]>([]);

  // Validate session exists
  const {
    data: session,
    isLoading: sessionLoading,
    isError: sessionError,
  } = useQuery({
    queryKey: ["session-by-code", code],
    queryFn: () => getSessionByCode(code!),
    enabled: !!code,
    retry: false,
  });

  // Fetch initial player list once session is known
  const { data: initialPlayers } = useQuery({
    queryKey: ["session-players", session?.id],
    queryFn: () => listSessionPlayers(session!.id),
    enabled: !!session?.id,
  });

  // Derive player list: initial DB snapshot + WS deltas (deduplicated)
  const players: PlayerInfo[] = useMemo(() => {
    let result: PlayerInfo[] = (initialPlayers ?? []).map((p) => ({
      id: p.id,
      name: p.name,
    }));
    for (const ev of wsEvents) {
      if (ev.type === "joined" && !result.some((p) => p.id === ev.player_id)) {
        result.push({ id: ev.player_id, name: ev.name });
      } else if (ev.type === "left") {
        result = result.filter((p) => p.id !== ev.player_id);
      }
    }
    return result;
  }, [initialPlayers, wsEvents]);

  const handleMessage = useCallback(
    (msg: WsMessage) => {
      if (msg.type === "player_joined") {
        const payload = msg.payload as { player_id: string; name: string };
        setWsEvents((prev) => [
          ...prev,
          { type: "joined", player_id: payload.player_id, name: payload.name },
        ]);
      } else if (msg.type === "player_left") {
        const payload = msg.payload as { player_id: string };
        setWsEvents((prev) => [
          ...prev,
          { type: "left", player_id: payload.player_id, name: "" },
        ]);
      } else if (msg.type === "game_started") {
        navigate(`/game/${code}/play`);
      }
    },
    [code, navigate],
  );

  const wsUrl = `${WS_BASE}/api/v1/ws/player/${code}?player_id=${playerId}&name=${encodeURIComponent(playerName)}`;

  useWebSocket({
    url: wsUrl,
    onMessage: handleMessage,
    onOpen: () => {
      setWsReady(true);
      setDisconnected(false);
    },
    onClose: () => {
      setWsReady(false);
      setDisconnected(true);
    },
    // Only connect once session is confirmed valid and player identity exists
    enabled: !!session && !!playerId && !!code,
  });

  // --- Loading ---
  if (sessionLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400">Looking up game…</p>
      </div>
    );
  }

  // --- Invalid / not found ---
  if (sessionError || !session) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="text-center space-y-4">
          <h1 className="text-3xl font-bold text-white">Game not found</h1>
          <p className="text-gray-400">
            The code <span className="font-mono text-indigo-400">{code}</span> doesn't match any
            active game.
          </p>
          <a
            href="/join"
            className="inline-block bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-6 py-3 rounded-lg transition"
          >
            ← Try a different code
          </a>
        </div>
      </div>
    );
  }

  // --- No player identity (e.g. direct URL access without joining first) ---
  if (!playerId || !playerName) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-white">Enter your name to join</h1>
          <a
            href={`/join?code=${code}`}
            className="inline-block bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-6 py-3 rounded-lg transition"
          >
            Join Game
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8 text-center">
        {/* Player identity */}
        <div>
          <div className="w-16 h-16 rounded-full bg-indigo-600 flex items-center justify-center text-2xl font-black mx-auto mb-4">
            {playerName[0].toUpperCase()}
          </div>
          <h1 className="text-2xl font-bold">{playerName}</h1>
          <p className="text-gray-400 text-sm mt-1">Room {code}</p>
        </div>

        {disconnected ? (
          <div className="bg-red-900/30 border border-red-700 rounded-xl p-4">
            <p className="text-red-400 text-sm">Disconnected. Reconnecting…</p>
          </div>
        ) : (
          <div className="bg-gray-900 rounded-xl p-6">
            <div className="flex items-center justify-center gap-2 mb-4">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <p className="text-gray-300 font-medium">
                {wsReady ? "Waiting for host to start…" : "Connecting…"}
              </p>
            </div>

            {players.length > 0 && (
              <div className="mt-4 text-left">
                <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">
                  In the room ({players.length})
                </p>
                <ul className="space-y-1">
                  {players.map((p) => (
                    <li key={p.id} className="text-sm text-gray-300 flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-indigo-700 flex items-center justify-center text-xs font-bold">
                        {p.name[0].toUpperCase()}
                      </span>
                      {p.name}
                      {p.id === playerId && (
                        <span className="text-xs text-indigo-400">(you)</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
