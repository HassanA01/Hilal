import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { motion } from "motion/react";
import { LanternIcon, CrescentIcon } from "../components/icons";
import { joinSession } from "../api/sessions";

export function JoinPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const wasKicked = (location.state as { kicked?: boolean })?.kicked;

  const [code, setCode] = useState((searchParams.get("code") ?? "").replace(/\D/g, "").slice(0, 6));
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isReady = code.length === 6 && name.trim().length > 0;

  function handleCodeChange(value: string) {
    setCode(value.replace(/\D/g, "").slice(0, 6));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isReady) return;
    setError("");
    setLoading(true);
    try {
      const res = await joinSession(code, name.trim());
      sessionStorage.setItem("player_id", res.player_id);
      sessionStorage.setItem("player_name", res.name);
      sessionStorage.setItem("session_id", res.session_id);
      navigate(`/game/${res.code}`);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } }; message?: string };
      setError(axiosErr?.response?.data?.error ?? "Failed to join. Check the code and try again.");
    } finally {
      setLoading(false);
    }
  }

  const inputStyle = {
    background: "rgba(255,255,255,0.08)",
    border: "2px solid rgba(245,200,66,0.25)",
    color: "white",
  };

  return (
    <div className="min-h-screen w-full relative overflow-hidden" style={{ background: "#1a0a2e" }}>
      <div className="ramadan-pattern" />

      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 py-12">
        {/* Floating lanterns */}
        <div className="absolute top-8 left-1/2 -translate-x-1/2 flex gap-24 pointer-events-none">
          {[{ delay: 0, rot: [-5, 5, -5] as [number, number, number] }, { delay: 0.5, rot: [5, -5, 5] as [number, number, number] }].map((l, i) => (
            <motion.div key={i} animate={{ y: [0, -10, 0], rotate: l.rot }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: l.delay }}>
              <LanternIcon className="w-10 h-10 drop-shadow-[0_0_15px_rgba(245,200,66,0.6)]" style={{ color: "#f5c842" }} />
            </motion.div>
          ))}
        </div>

        {/* Kicked banner */}
        {wasKicked && (
          <motion.div
            className="w-full max-w-sm mb-4 px-4 py-3 rounded-xl text-center text-sm font-medium"
            style={{ background: "rgba(244,67,54,0.15)", border: "1px solid rgba(244,67,54,0.3)", color: "#f44336" }}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            You were removed from the game by the host.
          </motion.div>
        )}

        {/* Card */}
        <motion.div
          className="w-full max-w-sm rounded-3xl p-8"
          style={{
            background: "linear-gradient(135deg, rgba(42,20,66,0.9) 0%, rgba(30,15,50,0.95) 100%)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(245,200,66,0.2)",
          }}
          initial={{ opacity: 0, scale: 0.92, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.4 }}>

          {/* Header */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-3 mb-3">
              <CrescentIcon className="w-8 h-8" style={{ color: "#f5c842" }} />
              <h1 className="text-3xl font-black" style={{ color: "#f5c842" }}>Join Game</h1>
            </div>
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>Enter the game code to play</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="room-code" className="block mb-1.5 text-sm font-semibold" style={{ color: "rgba(255,255,255,0.8)" }}>
                Room Code
              </label>
              <input
                id="room-code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => handleCodeChange(e.target.value)}
                className="w-full px-4 py-3 rounded-xl text-center font-bold text-2xl tracking-widest text-white outline-none transition"
                style={inputStyle}
                onFocus={(e) => (e.target.style.borderColor = "#f5c842")}
                onBlur={(e) => (e.target.style.borderColor = "rgba(245,200,66,0.25)")}
                placeholder="000000"
                autoComplete="off"
              />
            </div>

            <div>
              <label htmlFor="your-name" className="block mb-1.5 text-sm font-semibold" style={{ color: "rgba(255,255,255,0.8)" }}>
                Your Name
              </label>
              <input
                id="your-name"
                type="text"
                maxLength={30}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl text-white outline-none transition"
                style={inputStyle}
                onFocus={(e) => (e.target.style.borderColor = "#f5c842")}
                onBlur={(e) => (e.target.style.borderColor = "rgba(245,200,66,0.25)")}
                placeholder="Enter your name…"
                autoComplete="off"
              />
            </div>

            {error && (
              <motion.p className="text-sm text-center" style={{ color: "#f44336" }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                {error}
              </motion.p>
            )}

            <motion.button
              type="submit"
              disabled={!isReady || loading}
              className="w-full py-4 rounded-xl font-bold text-lg text-white disabled:cursor-not-allowed mt-2"
              style={{
                background: isReady && !loading
                  ? "linear-gradient(135deg, #ff6b35 0%, #ff8c5a 100%)"
                  : "rgba(255,107,53,0.3)",
                boxShadow: isReady && !loading ? "0 8px 30px rgba(255,107,53,0.4)" : "none",
              }}
              whileHover={isReady && !loading ? { scale: 1.02 } : {}}
              whileTap={isReady && !loading ? { scale: 0.98 } : {}}>
              {loading ? "Joining…" : "Join Game"}
            </motion.button>
          </form>
        </motion.div>
      </div>
    </div>
  );
}
