import { useState, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Users, Copy, Check, X, Volume2, VolumeOff } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { LanternIcon, CrescentIcon } from "../components/icons";
import { getSessionByCode, listSessionPlayers, startSession } from "../api/sessions";
import { useWebSocket } from "../hooks/useWebSocket";
import { useLobbyAudio } from "../hooks/useLobbyAudio";
import { useGameStore } from "../stores/gameStore";
import type { WsMessage, GamePlayer } from "../types";

const WS_BASE = import.meta.env.VITE_WS_BASE_URL ?? "ws://localhost:8081";

interface WsPlayerEvent {
  type: "joined" | "left";
  player_id: string;
  name: string;
}

const PLAYER_COLORS = [
  "#f5c842", "#ff6b35", "#4caf50", "#2196f3", "#f44336",
  "#9c27b0", "#00bcd4", "#ff9800",
];

export function HostLobbyPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [wsReady, setWsReady] = useState(false);
  const [wsEvents, setWsEvents] = useState<WsPlayerEvent[]>([]);
  const [copied, setCopied] = useState(false);
  const { muted, toggleMute } = useLobbyAudio();

  const { data: session, isError } = useQuery({
    queryKey: ["session-by-code", code],
    queryFn: () => getSessionByCode(code!),
    enabled: !!code,
  });

  const { data: initialPlayers } = useQuery({
    queryKey: ["session-players", session?.id],
    queryFn: () => listSessionPlayers(session!.id),
    enabled: !!session?.id,
  });

  const players: GamePlayer[] = useMemo(() => {
    let result = [...(initialPlayers ?? [])];
    for (const ev of wsEvents) {
      if (ev.type === "joined" && !result.some((p) => p.id === ev.player_id)) {
        result.push({
          id: ev.player_id,
          session_id: session?.id ?? "",
          name: ev.name,
          score: 0,
          joined_at: new Date().toISOString(),
        });
      } else if (ev.type === "left") {
        result = result.filter((p) => p.id !== ev.player_id);
      }
    }
    return result;
  }, [initialPlayers, wsEvents, session?.id]);

  const handleMessage = useCallback((msg: WsMessage) => {
    if (msg.type === "player_joined") {
      const payload = msg.payload as { player_id: string; name: string };
      setWsEvents((prev) => [...prev, { type: "joined", player_id: payload.player_id, name: payload.name }]);
    } else if (msg.type === "player_left") {
      const payload = msg.payload as { player_id: string };
      setWsEvents((prev) => [...prev, { type: "left", player_id: payload.player_id, name: "" }]);
    } else if (msg.type === "game_started") {
      navigate(`/admin/game/${code}`);
    }
  }, [code, navigate]);

  const { send } = useWebSocket({
    url: `${WS_BASE}/api/v1/ws/host/${code}`,
    onMessage: handleMessage,
    onOpen: () => setWsReady(true),
    onClose: () => setWsReady(false),
    enabled: !!code && !!session,
  });

  const setActiveSession = useGameStore((s) => s.setActiveSession);
  const startMutation = useMutation({
    mutationFn: () => startSession(session!.id),
    onSuccess: () => setActiveSession({ sessionId: session!.id, code: code! }),
  });

  const joinUrl = `${window.location.origin}/join?code=${code}`;

  function handleCopyUrl() {
    navigator.clipboard.writeText(joinUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleKick(playerId: string) {
    send({ type: "kick_player", payload: { player_id: playerId } });
  }

  if (isError) {
    return (
      <div className="min-h-screen w-full relative overflow-hidden" style={{ background: "#1a0a2e" }}>
        <div className="ramadan-pattern" />
        <div className="relative z-10 min-h-screen flex items-center justify-center">
          <p style={{ color: "#f44336" }}>Session not found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full relative overflow-hidden" style={{ background: "#1a0a2e" }}>
      <div className="ramadan-pattern" />

      <div className="relative z-10 min-h-screen flex flex-col items-center px-4 sm:px-6 py-8 sm:py-12 max-w-2xl mx-auto">
        {/* Mute toggle */}
        <motion.button onClick={toggleMute} whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
          className="absolute top-4 right-4 p-2 rounded-lg z-20" aria-label={muted ? "Unmute audio" : "Mute audio"}
          style={{ background: "rgba(245,200,66,0.12)", color: muted ? "rgba(255,255,255,0.4)" : "#f5c842", border: "1px solid rgba(245,200,66,0.25)" }}>
          {muted ? <VolumeOff className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
        </motion.button>

        {/* Animated lanterns */}
        <div className="absolute top-8 left-1/2 -translate-x-1/2 flex gap-32">
          {[{ delay: 0 }, { delay: 0.5 }].map((l, i) => (
            <motion.div key={i} animate={{ y: [0, -10, 0], rotate: [i === 0 ? -5 : 5, i === 0 ? 5 : -5, i === 0 ? -5 : 5] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: l.delay }}>
              <LanternIcon className="w-10 h-10 drop-shadow-[0_0_15px_rgba(245,200,66,0.6)]" style={{ color: "#f5c842" }} />
            </motion.div>
          ))}
        </div>

        <div className="w-full mt-16 space-y-6">
          {/* Room code */}
          <motion.div className="text-center" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center justify-center gap-2 mb-3">
              <CrescentIcon className="w-6 h-6" style={{ color: "#f5c842" }} />
              <p className="text-sm font-medium uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.6)" }}>Room Code</p>
            </div>
            <h1 className="text-5xl sm:text-8xl font-black tracking-widest" style={{
              color: "#f5c842",
              textShadow: "0 0 30px rgba(245,200,66,0.6), 0 4px 20px rgba(0,0,0,0.5)",
            }}>
              {code}
            </h1>
            <div className="flex items-center justify-center gap-2 mt-3">
              <span className={`w-2 h-2 rounded-full ${wsReady ? "bg-green-400" : "bg-yellow-400"} animate-pulse`} />
              <p className="text-sm" style={{ color: wsReady ? "#4caf50" : "#f5c842" }}>
                {wsReady ? "Connected" : "Connecting…"}
              </p>
            </div>
          </motion.div>

          {/* Join URL */}
          <motion.div
            className="p-4 rounded-2xl flex items-center gap-3"
            style={{ background: "rgba(245,200,66,0.08)", border: "1px solid rgba(245,200,66,0.2)" }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
            <p className="font-mono text-sm flex-1 truncate" style={{ color: "rgba(255,255,255,0.7)" }}>{joinUrl}</p>
            <motion.button onClick={handleCopyUrl} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
              className="p-2 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: copied ? "rgba(76,175,80,0.2)" : "rgba(245,200,66,0.2)", color: copied ? "#4caf50" : "#f5c842" }}>
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </motion.button>
          </motion.div>

          {/* QR code */}
          <motion.div
            className="flex justify-center"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.25 }}
          >
            <div
              className="p-4 rounded-2xl inline-block"
              style={{ background: "white" }}
            >
              <QRCodeSVG
                value={joinUrl}
                size={200}
                level="M"
                data-testid="lobby-qr-code"
              />
            </div>
          </motion.div>

          {/* Player count */}
          <motion.div className="flex items-center gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
            <Users className="w-5 h-5" style={{ color: "#f5c842" }} />
            <h2 className="text-lg font-bold text-white">
              Players <span style={{ color: "#f5c842" }}>({players.length})</span>
            </h2>
          </motion.div>

          {/* Player list */}
          {players.length === 0 ? (
            <motion.div className="rounded-2xl p-10 text-center"
              style={{ background: "rgba(245,200,66,0.05)", border: "2px dashed rgba(245,200,66,0.2)" }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
              <p style={{ color: "rgba(255,255,255,0.5)" }}>Waiting for players to join…</p>
            </motion.div>
          ) : (
            <motion.div className="space-y-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
              {players.map((player, i) => (
                <motion.div key={player.id}
                  className="px-4 py-3 rounded-xl flex items-center gap-3"
                  style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(245,200,66,0.15)" }}
                  initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-white flex-shrink-0"
                    style={{ background: PLAYER_COLORS[i % PLAYER_COLORS.length] }}>
                    {player.name[0]?.toUpperCase()}
                  </div>
                  <span className="font-medium text-white flex-1">{player.name}</span>
                  <motion.button
                    onClick={() => handleKick(player.id)}
                    className="p-1.5 rounded-lg opacity-30 hover:opacity-100 transition-opacity"
                    style={{ color: "#f44336" }}
                    whileHover={{ scale: 1.1, backgroundColor: "rgba(244,67,54,0.15)" }}
                    whileTap={{ scale: 0.9 }}
                    aria-label={`Kick ${player.name}`}
                  >
                    <X className="w-4 h-4" />
                  </motion.button>
                </motion.div>
              ))}
            </motion.div>
          )}

          {/* Start button */}
          <motion.button
            onClick={() => startMutation.mutate()}
            disabled={players.length === 0 || startMutation.isPending}
            className="w-full py-4 rounded-xl font-bold text-lg disabled:cursor-not-allowed"
            style={{
              background: players.length > 0 && !startMutation.isPending
                ? "linear-gradient(135deg, #ff6b35 0%, #ff8c5a 100%)"
                : "rgba(255,107,53,0.3)",
              color: "white",
              boxShadow: players.length > 0 ? "0 8px 30px rgba(255,107,53,0.4)" : "none",
            }}
            whileHover={players.length > 0 ? { scale: 1.02 } : {}}
            whileTap={players.length > 0 ? { scale: 0.98 } : {}}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
            {startMutation.isPending ? "Starting…" : "Start Game 🚀"}
          </motion.button>

          {startMutation.isError && (
            <p className="text-center text-sm" style={{ color: "#f44336" }}>Failed to start game. Try again.</p>
          )}
        </div>
      </div>
    </div>
  );
}
