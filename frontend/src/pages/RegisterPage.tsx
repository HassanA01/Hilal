import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { CrescentIcon, LanternIcon } from "../components/icons";
import { register } from "../api/auth";
import { useAuthStore } from "../stores/authStore";

export function RegisterPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      const { token, admin, is_superadmin } = await register(email, password);
      setAuth(token, admin, is_superadmin);
      navigate("/admin", { replace: true });
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Registration failed. Please try again.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full relative overflow-hidden flex items-center justify-center px-4" style={{ background: "#1a0a2e" }}>
      <div className="ramadan-pattern" />

      {/* Floating lanterns */}
      <div className="absolute top-8 left-1/2 -translate-x-1/2 flex gap-24 pointer-events-none">
        {[{ delay: 0, rot: [-5, 5, -5] as [number, number, number] }, { delay: 0.5, rot: [5, -5, 5] as [number, number, number] }].map((l, i) => (
          <motion.div key={i} animate={{ y: [0, -12, 0], rotate: l.rot }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: l.delay }}>
            <LanternIcon className="w-10 h-10 drop-shadow-[0_0_15px_rgba(245,200,66,0.6)]" style={{ color: "#f5c842" }} />
          </motion.div>
        ))}
      </div>

      <div className="relative z-10 w-full max-w-sm">
        {/* Logo */}
        <motion.div className="text-center mb-8" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="relative">
              <CrescentIcon className="w-10 h-10" style={{ color: "#f5c842" }} />
              <LanternIcon className="w-5 h-5 absolute -bottom-1 -right-1" style={{ color: "#f5c842" }} />
            </div>
            <span className="text-3xl font-black" style={{ color: "#f5c842", textShadow: "0 0 20px rgba(245,200,66,0.4)" }}>
              Hilal
            </span>
          </div>
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>Create an admin account</p>
        </motion.div>

        {/* Card */}
        <motion.div
          className="rounded-2xl p-8 space-y-5"
          style={{
            background: "linear-gradient(135deg, rgba(42,20,66,0.9) 0%, rgba(30,15,50,0.95) 100%)",
            border: "1px solid rgba(245,200,66,0.2)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
          }}
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>

          {error && (
            <motion.div
              className="text-sm rounded-xl px-4 py-3"
              style={{ background: "rgba(244,67,54,0.1)", border: "1px solid rgba(244,67,54,0.3)", color: "#f44336" }}
              initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>
              {error}
            </motion.div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: "rgba(255,255,255,0.7)" }}>
                Email
              </label>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl px-4 py-3 text-sm text-white outline-none transition"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(245,200,66,0.2)" }}
                onFocus={(e) => (e.target.style.borderColor = "rgba(245,200,66,0.6)")}
                onBlur={(e) => (e.target.style.borderColor = "rgba(245,200,66,0.2)")}
                placeholder="admin@example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: "rgba(255,255,255,0.7)" }}>
                Password <span className="font-normal" style={{ color: "rgba(255,255,255,0.35)" }}>(min. 8 chars)</span>
              </label>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl px-4 py-3 text-sm text-white outline-none transition"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(245,200,66,0.2)" }}
                onFocus={(e) => (e.target.style.borderColor = "rgba(245,200,66,0.6)")}
                onBlur={(e) => (e.target.style.borderColor = "rgba(245,200,66,0.2)")}
                placeholder="••••••••"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: "rgba(255,255,255,0.7)" }}>
                Confirm password
              </label>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-xl px-4 py-3 text-sm text-white outline-none transition"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(245,200,66,0.2)" }}
                onFocus={(e) => (e.target.style.borderColor = "rgba(245,200,66,0.6)")}
                onBlur={(e) => (e.target.style.borderColor = "rgba(245,200,66,0.2)")}
                placeholder="••••••••"
              />
            </div>

            <motion.button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl font-bold text-sm disabled:cursor-not-allowed text-white"
              style={{
                background: loading ? "rgba(255,107,53,0.4)" : "linear-gradient(135deg, #ff6b35 0%, #ff8c5a 100%)",
                boxShadow: loading ? "none" : "0 8px 25px rgba(255,107,53,0.35)",
              }}
              whileHover={!loading ? { scale: 1.02 } : {}}
              whileTap={!loading ? { scale: 0.98 } : {}}>
              {loading ? "Creating account…" : "Create account"}
            </motion.button>
          </form>

          <p className="text-center text-sm pt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
            Already have an account?{" "}
            <Link to="/login" className="font-semibold transition" style={{ color: "#f5c842" }}>
              Sign in
            </Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
