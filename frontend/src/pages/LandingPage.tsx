import { useEffect, useRef } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import { useNavigate } from "react-router-dom";

/* ─── Star field ─────────────────────────────────────────────────────────── */
const STARS = Array.from({ length: 120 }, (_, i) => ({
  id: i,
  x: ((i * 137.508 + 23) % 100),
  y: ((i * 97.3 + 11) % 100),
  size: i % 7 === 0 ? 2.5 : i % 3 === 0 ? 1.8 : 1.2,
  delay: (i * 0.23) % 4,
  duration: 2.5 + (i % 5) * 0.7,
}));

/* ─── Crescent Moon SVG ──────────────────────────────────────────────────── */
function CrescentMoon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden="true">
      <defs>
        <radialGradient id="moonGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#f5c842" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#f5c842" stopOpacity="0" />
        </radialGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
      {/* Halo */}
      <circle cx="60" cy="60" r="58" fill="url(#moonGlow)" />
      {/* Moon body */}
      <circle cx="60" cy="60" r="38" fill="#f5c842" filter="url(#glow)" opacity="0.95" />
      {/* Mask circle for crescent */}
      <circle cx="80" cy="50" r="34" fill="#06091a" />
    </svg>
  );
}

/* ─── Lantern SVG ────────────────────────────────────────────────────────── */
function Lantern({ className, glowColor = "#f5c842" }: { className?: string; glowColor?: string }) {
  return (
    <svg viewBox="0 0 40 72" className={className} aria-hidden="true">
      <defs>
        <radialGradient id={`lg-${glowColor}`} cx="50%" cy="60%" r="50%">
          <stop offset="0%" stopColor={glowColor} stopOpacity="0.5" />
          <stop offset="100%" stopColor={glowColor} stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Glow */}
      <ellipse cx="20" cy="44" rx="26" ry="30" fill={`url(#lg-${glowColor})`} />
      {/* Top cap */}
      <rect x="14" y="2" width="12" height="4" rx="2" fill={glowColor} opacity="0.8" />
      {/* String */}
      <line x1="20" y1="0" x2="20" y2="6" stroke={glowColor} strokeWidth="1.5" opacity="0.6" />
      {/* Body */}
      <rect x="8" y="12" width="24" height="36" rx="4" fill={glowColor} opacity="0.15" stroke={glowColor} strokeWidth="1" strokeOpacity="0.6" />
      {/* Ribs */}
      {[18, 26, 34].map((y) => (
        <line key={y} x1="8" y1={y} x2="32" y2={y} stroke={glowColor} strokeWidth="0.8" strokeOpacity="0.4" />
      ))}
      {/* Inner glow */}
      <ellipse cx="20" cy="30" rx="8" ry="10" fill={glowColor} opacity="0.25" />
      {/* Bottom fringe */}
      {[10, 15, 20, 25, 30].map((x) => (
        <line key={x} x1={x} y1="48" x2={x - 1} y2="56" stroke={glowColor} strokeWidth="1" strokeOpacity="0.5" />
      ))}
      {/* Bottom cap */}
      <rect x="12" y="48" width="16" height="4" rx="2" fill={glowColor} opacity="0.7" />
    </svg>
  );
}

/* ─── Geometric ornament ─────────────────────────────────────────────────── */
function StarOrnament({ size = 32, color = "#f5c842", opacity = 0.3 }: { size?: number; color?: string; opacity?: number }) {
  const arms = 8;
  const outer = size / 2;
  const inner = outer * 0.4;
  const cx = outer;
  const cy = outer;
  const pts = Array.from({ length: arms * 2 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const angle = (i * Math.PI) / arms - Math.PI / 2;
    return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
  }).join(" ");
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <polygon points={pts} fill={color} opacity={opacity} />
    </svg>
  );
}

/* ─── Section divider ────────────────────────────────────────────────────── */
function GeoDivider() {
  return (
    <div className="flex items-center gap-4 justify-center py-2">
      <div style={{ height: 1, flex: 1, background: "linear-gradient(to right, transparent, rgba(245,200,66,0.3))" }} />
      <StarOrnament size={20} opacity={0.6} />
      <StarOrnament size={12} opacity={0.4} />
      <StarOrnament size={20} opacity={0.6} />
      <div style={{ height: 1, flex: 1, background: "linear-gradient(to left, transparent, rgba(245,200,66,0.3))" }} />
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────────────────── */
export function LandingPage() {
  const navigate = useNavigate();
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const moonY = useTransform(scrollYProgress, [0, 1], [0, -80]);
  const moonOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);

  // Noise grain canvas
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = 256, H = 256;
    canvas.width = W;
    canvas.height = H;
    const img = ctx.createImageData(W, H);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 18;
    }
    ctx.putImageData(img, 0, 0);
  }, []);

  return (
    <div style={{ background: "#06091a", color: "#faf3e0", minHeight: "100vh", overflowX: "hidden" }}>
      {/* Grain overlay */}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{
          position: "fixed", inset: 0, width: "100%", height: "100%",
          backgroundRepeat: "repeat", opacity: 0.4, pointerEvents: "none",
          zIndex: 1, mixBlendMode: "overlay",
        }}
      />

      {/* ── NAV ───────────────────────────────────────────────────────────── */}
      <motion.nav
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 50,
          padding: "20px 40px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "linear-gradient(to bottom, rgba(6,9,26,0.9) 0%, transparent 100%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <CrescentMoon className="w-8 h-8" />
          <span style={{
            fontFamily: "'Poppins', sans-serif",
            fontWeight: 800,
            fontSize: 20,
            letterSpacing: "0.08em",
            color: "#f5c842",
          }}>
            IFTAROOT
          </span>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={() => navigate("/join")}
            style={{
              padding: "8px 20px", borderRadius: 8,
              border: "1px solid rgba(245,200,66,0.4)",
              background: "rgba(245,200,66,0.08)",
              color: "#f5c842", fontWeight: 600, fontSize: 13,
              letterSpacing: "0.05em", cursor: "pointer",
              fontFamily: "'Poppins', sans-serif",
              transition: "all 0.2s",
            }}
            onMouseEnter={e => { (e.target as HTMLButtonElement).style.background = "rgba(245,200,66,0.18)"; }}
            onMouseLeave={e => { (e.target as HTMLButtonElement).style.background = "rgba(245,200,66,0.08)"; }}
          >
            Join Game
          </button>
          <button
            onClick={() => navigate("/login")}
            style={{
              padding: "8px 20px", borderRadius: 8,
              background: "#f5c842",
              color: "#06091a", fontWeight: 700, fontSize: 13,
              letterSpacing: "0.05em", cursor: "pointer",
              fontFamily: "'Poppins', sans-serif",
              border: "none", transition: "all 0.2s",
            }}
            onMouseEnter={e => { (e.target as HTMLButtonElement).style.background = "#ffd700"; }}
            onMouseLeave={e => { (e.target as HTMLButtonElement).style.background = "#f5c842"; }}
          >
            Host a Quiz
          </button>
        </div>
      </motion.nav>

      {/* ── HERO ──────────────────────────────────────────────────────────── */}
      <section
        ref={heroRef}
        style={{
          minHeight: "100vh", position: "relative", display: "flex",
          flexDirection: "column", alignItems: "center", justifyContent: "center",
          overflow: "hidden", padding: "120px 24px 80px",
        }}
      >
        {/* Background gradient */}
        <div style={{
          position: "absolute", inset: 0,
          background: "radial-gradient(ellipse 80% 60% at 50% 20%, rgba(30,20,80,0.8) 0%, rgba(6,9,26,0) 70%)",
          pointerEvents: "none",
        }} />

        {/* Stars */}
        {STARS.map(s => (
          <motion.div
            key={s.id}
            style={{
              position: "absolute",
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: s.size,
              height: s.size,
              borderRadius: "50%",
              background: s.id % 11 === 0 ? "#f5c842" : "white",
              pointerEvents: "none",
            }}
            animate={{ opacity: [0.2, 1, 0.2] }}
            transition={{ duration: s.duration, delay: s.delay, repeat: Infinity, ease: "easeInOut" }}
          />
        ))}

        {/* Moon */}
        <motion.div
          style={{ position: "absolute", top: "8%", right: "12%", y: moonY, opacity: moonOpacity }}
        >
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 1.2, ease: "easeOut", delay: 0.3 }}
          >
            <CrescentMoon className="w-36 h-36 sm:w-48 sm:h-48" />
          </motion.div>
        </motion.div>

        {/* Lanterns */}
        <motion.div style={{ position: "absolute", top: "15%", left: "6%", opacity: 0.7 }}
          initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 0.7 }} transition={{ delay: 0.8, duration: 1 }}>
          <motion.div animate={{ rotate: [-3, 3, -3] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}>
            <Lantern className="w-10 h-16" />
          </motion.div>
        </motion.div>
        <motion.div style={{ position: "absolute", top: "10%", left: "16%", opacity: 0.5 }}
          initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 0.5 }} transition={{ delay: 1, duration: 1 }}>
          <motion.div animate={{ rotate: [3, -3, 3] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}>
            <Lantern className="w-7 h-12" glowColor="#ff6b35" />
          </motion.div>
        </motion.div>
        <motion.div style={{ position: "absolute", top: "20%", right: "6%", opacity: 0.5 }}
          initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 0.5 }} transition={{ delay: 1.2, duration: 1 }}>
          <motion.div animate={{ rotate: [2, -4, 2] }} transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}>
            <Lantern className="w-8 h-14" glowColor="#ff6b35" />
          </motion.div>
        </motion.div>

        {/* Ornament row above headline */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.7 }}
          style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28, position: "relative", zIndex: 2 }}
        >
          <StarOrnament size={16} opacity={0.7} />
          <span style={{
            fontSize: 11, letterSpacing: "0.3em", fontWeight: 600,
            color: "#f5c842", textTransform: "uppercase",
            fontFamily: "'Poppins', sans-serif",
          }}>
            Ramadan 2026
          </span>
          <StarOrnament size={16} opacity={0.7} />
        </motion.div>

        {/* Headline */}
        <div style={{ position: "relative", zIndex: 2, textAlign: "center", maxWidth: 780 }}>
          <motion.h1
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            style={{
              fontFamily: "'Poppins', sans-serif",
              fontWeight: 900,
              fontSize: "clamp(3rem, 9vw, 7rem)",
              lineHeight: 0.95,
              letterSpacing: "-0.02em",
              color: "#faf3e0",
              marginBottom: 0,
            }}
          >
            CELEBRATE
            <br />
            <span style={{
              WebkitTextStroke: "2px #f5c842",
              color: "transparent",
              display: "block",
            }}>
              RAMADAN.
            </span>
          </motion.h1>

          <motion.h2
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.65, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            style={{
              fontFamily: "'Poppins', sans-serif",
              fontWeight: 900,
              fontSize: "clamp(3rem, 9vw, 7rem)",
              lineHeight: 0.95,
              letterSpacing: "-0.02em",
              color: "#f5c842",
              marginTop: 8,
            }}
          >
            QUIZ YOUR
            <br />WORLD.
          </motion.h2>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1, duration: 0.8 }}
            style={{
              marginTop: 28,
              fontSize: "clamp(1rem, 2.5vw, 1.2rem)",
              color: "rgba(250,243,224,0.65)",
              fontFamily: "'Poppins', sans-serif",
              fontWeight: 400,
              lineHeight: 1.7,
              maxWidth: 520,
              margin: "28px auto 0",
            }}
          >
            A live multiplayer quiz game built for Ramadan nights.
            Challenge friends, test your knowledge, and compete in real time.
          </motion.p>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.2, duration: 0.7 }}
            style={{ marginTop: 44, display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}
          >
            <button
              onClick={() => navigate("/join")}
              style={{
                padding: "16px 36px", borderRadius: 12,
                background: "#f5c842",
                color: "#06091a", fontWeight: 800, fontSize: 15,
                letterSpacing: "0.06em", cursor: "pointer",
                fontFamily: "'Poppins', sans-serif", border: "none",
                boxShadow: "0 0 40px rgba(245,200,66,0.35), 0 8px 24px rgba(0,0,0,0.4)",
                transition: "all 0.2s",
                textTransform: "uppercase",
              }}
              onMouseEnter={e => {
                const b = e.currentTarget;
                b.style.transform = "translateY(-2px)";
                b.style.boxShadow = "0 0 60px rgba(245,200,66,0.5), 0 12px 32px rgba(0,0,0,0.5)";
              }}
              onMouseLeave={e => {
                const b = e.currentTarget;
                b.style.transform = "translateY(0)";
                b.style.boxShadow = "0 0 40px rgba(245,200,66,0.35), 0 8px 24px rgba(0,0,0,0.4)";
              }}
            >
              Join a Game
            </button>
            <button
              onClick={() => navigate("/login")}
              style={{
                padding: "16px 36px", borderRadius: 12,
                background: "transparent",
                color: "#faf3e0", fontWeight: 700, fontSize: 15,
                letterSpacing: "0.06em", cursor: "pointer",
                fontFamily: "'Poppins', sans-serif",
                border: "1.5px solid rgba(250,243,224,0.25)",
                transition: "all 0.2s",
                textTransform: "uppercase",
              }}
              onMouseEnter={e => {
                const b = e.currentTarget;
                b.style.borderColor = "rgba(245,200,66,0.5)";
                b.style.color = "#f5c842";
              }}
              onMouseLeave={e => {
                const b = e.currentTarget;
                b.style.borderColor = "rgba(250,243,224,0.25)";
                b.style.color = "#faf3e0";
              }}
            >
              Host a Quiz
            </button>
          </motion.div>
        </div>

        {/* Scroll hint */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2, duration: 1 }}
          style={{ position: "absolute", bottom: 36, left: "50%", transform: "translateX(-50%)", zIndex: 2 }}
        >
          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}
          >
            <span style={{ fontSize: 10, letterSpacing: "0.25em", color: "rgba(250,243,224,0.3)", fontFamily: "'Poppins', sans-serif" }}>SCROLL</span>
            <div style={{ width: 1, height: 40, background: "linear-gradient(to bottom, rgba(245,200,66,0.5), transparent)" }} />
          </motion.div>
        </motion.div>
      </section>

      {/* ── FEATURES ──────────────────────────────────────────────────────── */}
      <section style={{ padding: "80px 24px", maxWidth: 1100, margin: "0 auto", position: "relative", zIndex: 2 }}>
        <GeoDivider />

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7 }}
          style={{ textAlign: "center", margin: "52px 0 56px" }}
        >
          <p style={{
            fontSize: 11, letterSpacing: "0.3em", fontWeight: 600,
            color: "#f5c842", textTransform: "uppercase",
            fontFamily: "'Poppins', sans-serif", marginBottom: 16,
          }}>
            Why Iftaroot
          </p>
          <h2 style={{
            fontFamily: "'Poppins', sans-serif",
            fontWeight: 800, fontSize: "clamp(2rem, 5vw, 3.5rem)",
            color: "#faf3e0", letterSpacing: "-0.02em", lineHeight: 1.1,
          }}>
            Everything Kahoot charges for.<br />
            <span style={{ color: "#f5c842" }}>Free. Forever.</span>
          </h2>
        </motion.div>

        {/* Kahoot comparison hero card */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.7 }}
          style={{
            marginBottom: 32,
            borderRadius: 20,
            overflow: "hidden",
            border: "1px solid rgba(245,200,66,0.15)",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
          }}
        >
          {/* Kahoot column */}
          <div style={{
            padding: "40px 44px",
            background: "rgba(255,255,255,0.02)",
            borderRight: "1px solid rgba(255,255,255,0.06)",
          }}>
            <p style={{
              fontFamily: "'Poppins', sans-serif", fontSize: 11,
              letterSpacing: "0.25em", fontWeight: 700, color: "rgba(250,243,224,0.3)",
              textTransform: "uppercase", marginBottom: 20,
            }}>
              Kahoot
            </p>
            {[
              "Up to 10 players free",
              "Paid plan for more players",
              "No Ramadan theme",
              "Generic quiz experience",
              "Manual quiz creation only",
            ].map((item) => (
              <div key={item} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="8" cy="8" r="7.5" stroke="rgba(244,67,54,0.4)" />
                  <path d="M5 5l6 6M11 5l-6 6" stroke="#f44336" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span style={{
                  fontFamily: "'Poppins', sans-serif", fontSize: 14,
                  color: "rgba(250,243,224,0.4)", fontWeight: 400,
                }}>
                  {item}
                </span>
              </div>
            ))}
          </div>

          {/* Iftaroot column */}
          <div style={{
            padding: "40px 44px",
            background: "rgba(245,200,66,0.04)",
            position: "relative",
            overflow: "hidden",
          }}>
            <div style={{
              position: "absolute", top: 0, left: 0, right: 0, height: 2,
              background: "linear-gradient(to right, #f5c842, #ff6b35)",
            }} />
            <p style={{
              fontFamily: "'Poppins', sans-serif", fontSize: 11,
              letterSpacing: "0.25em", fontWeight: 700, color: "#f5c842",
              textTransform: "uppercase", marginBottom: 20,
            }}>
              Iftaroot
            </p>
            {[
              "Unlimited players, always free",
              "No account needed to play",
              "Built for Ramadan",
              "Real-time, speed-scored competition",
              "AI-powered quiz generation",
            ].map((item) => (
              <div key={item} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="8" cy="8" r="7.5" stroke="rgba(76,175,80,0.5)" />
                  <path d="M4.5 8l2.5 2.5 4.5-5" stroke="#4caf50" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span style={{
                  fontFamily: "'Poppins', sans-serif", fontSize: 14,
                  color: "rgba(250,243,224,0.85)", fontWeight: 500,
                }}>
                  {item}
                </span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Feature strip — 3 compact items */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: "rgba(255,255,255,0.05)", borderRadius: 16, overflow: "hidden" }}>
          {[
            {
              label: "Real-Time",
              title: "Live leaderboards, zero lag",
              body: "WebSocket-powered. Every answer, score update, and reveal happens instantly across all connected players.",
            },
            {
              label: "Ramadan-Themed",
              title: "Designed for the occasion",
              body: "Prayer arc transitions, crescent moon motifs, and golden design tokens — built with intention, not as an afterthought.",
            },
            {
              label: "Speed Scoring",
              title: "Fast answers win more",
              body: "Points scale with response time. Know the answer AND be quick. Every question reshuffles the leaderboard.",
            },
            {
              label: "AI-Powered",
              title: "Generate quizzes instantly",
              body: "Describe your topic and let AI build the questions. Review, edit, and launch — quiz creation in seconds, not minutes.",
            },
          ].map((f, i) => (
            <motion.div
              key={f.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              style={{
                padding: "32px 28px",
                background: "rgba(6,9,26,0.95)",
              }}
            >
              <span style={{
                display: "inline-block",
                fontFamily: "'Poppins', sans-serif", fontSize: 10,
                letterSpacing: "0.25em", fontWeight: 700,
                color: "#f5c842", textTransform: "uppercase",
                marginBottom: 12,
                padding: "3px 10px",
                border: "1px solid rgba(245,200,66,0.25)",
                borderRadius: 4,
              }}>
                {f.label}
              </span>
              <h3 style={{
                fontFamily: "'Poppins', sans-serif", fontWeight: 700,
                fontSize: 16, color: "#faf3e0", marginBottom: 10,
                letterSpacing: "-0.01em", lineHeight: 1.3,
              }}>
                {f.title}
              </h3>
              <p style={{
                fontFamily: "'Poppins', sans-serif", fontSize: 13,
                color: "rgba(250,243,224,0.45)", lineHeight: 1.7,
              }}>
                {f.body}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ──────────────────────────────────────────────────── */}
      <section style={{
        padding: "80px 24px",
        background: "linear-gradient(to bottom, transparent, rgba(20,10,60,0.3), transparent)",
        position: "relative", zIndex: 2,
      }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <GeoDivider />

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.7 }}
            style={{ textAlign: "center", margin: "52px 0 64px" }}
          >
            <p style={{
              fontSize: 11, letterSpacing: "0.3em", fontWeight: 600,
              color: "#f5c842", textTransform: "uppercase",
              fontFamily: "'Poppins', sans-serif", marginBottom: 16,
            }}>
              How it works
            </p>
            <h2 style={{
              fontFamily: "'Poppins', sans-serif",
              fontWeight: 800, fontSize: "clamp(2rem, 5vw, 3.5rem)",
              color: "#faf3e0", letterSpacing: "-0.02em", lineHeight: 1.1,
            }}>
              Three steps to quiz night.
            </h2>
          </motion.div>

          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {[
              {
                n: "01",
                title: "Create your quiz",
                body: "Sign in as a host. Build a quiz with custom questions, multiple-choice options, and time limits. It takes minutes.",
                side: "left",
              },
              {
                n: "02",
                title: "Start a session",
                body: "Launch a live game session. Share the 6-digit code with your players — no accounts, no downloads, just a link.",
                side: "right",
              },
              {
                n: "03",
                title: "Play, compete, celebrate",
                body: "Questions appear in real time. The prayer arc counts you in. Scores update live. Crown your Ramadan champion.",
                side: "left",
              },
            ].map((step, i) => (
              <motion.div
                key={step.n}
                initial={{ opacity: 0, x: step.side === "left" ? -30 : 30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.7, delay: 0.1 }}
                style={{
                  display: "flex",
                  gap: 40,
                  alignItems: "flex-start",
                  justifyContent: step.side === "right" ? "flex-end" : "flex-start",
                  padding: "40px 0",
                  borderBottom: i < 2 ? "1px solid rgba(245,200,66,0.08)" : "none",
                  flexDirection: step.side === "right" ? "row-reverse" : "row",
                }}
              >
                <div style={{
                  fontFamily: "'Poppins', sans-serif",
                  fontWeight: 900,
                  fontSize: "clamp(4rem, 10vw, 8rem)",
                  lineHeight: 1,
                  letterSpacing: "-0.04em",
                  WebkitTextStroke: "1px rgba(245,200,66,0.25)",
                  color: "transparent",
                  flexShrink: 0,
                  userSelect: "none",
                }}>
                  {step.n}
                </div>
                <div style={{ maxWidth: 480, paddingTop: 16 }}>
                  <h3 style={{
                    fontFamily: "'Poppins', sans-serif", fontWeight: 800,
                    fontSize: "clamp(1.3rem, 3vw, 1.9rem)", color: "#faf3e0",
                    letterSpacing: "-0.02em", marginBottom: 14,
                  }}>
                    {step.title}
                  </h3>
                  <p style={{
                    fontFamily: "'Poppins', sans-serif", fontSize: 15,
                    color: "rgba(250,243,224,0.55)", lineHeight: 1.8,
                  }}>
                    {step.body}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA FOOTER ────────────────────────────────────────────────────── */}
      <section style={{ padding: "100px 24px 80px", textAlign: "center", position: "relative", zIndex: 2, overflow: "hidden" }}>
        {/* Background moon glow */}
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          width: 600, height: 600,
          background: "radial-gradient(circle, rgba(245,200,66,0.08) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 32 }}>
            <CrescentMoon className="w-20 h-20" />
          </div>

          <h2 style={{
            fontFamily: "'Poppins', sans-serif",
            fontWeight: 900,
            fontSize: "clamp(2.5rem, 7vw, 5.5rem)",
            color: "#faf3e0",
            letterSpacing: "-0.03em",
            lineHeight: 1.05,
            marginBottom: 20,
          }}>
            Ready to play?
          </h2>

          <p style={{
            fontFamily: "'Poppins', sans-serif",
            fontSize: 16, color: "rgba(250,243,224,0.5)",
            lineHeight: 1.7, maxWidth: 440, margin: "0 auto 44px",
          }}>
            Ramadan Mubarak. Enter a game code to join your host's session.
          </p>

          <button
            onClick={() => navigate("/join")}
            style={{
              padding: "18px 52px", borderRadius: 14,
              background: "#f5c842",
              color: "#06091a", fontWeight: 800, fontSize: 16,
              letterSpacing: "0.08em", cursor: "pointer",
              fontFamily: "'Poppins', sans-serif", border: "none",
              boxShadow: "0 0 60px rgba(245,200,66,0.4), 0 12px 40px rgba(0,0,0,0.5)",
              textTransform: "uppercase",
              transition: "all 0.2s",
            }}
            onMouseEnter={e => {
              const b = e.currentTarget;
              b.style.transform = "translateY(-3px) scale(1.02)";
              b.style.boxShadow = "0 0 80px rgba(245,200,66,0.6), 0 16px 48px rgba(0,0,0,0.6)";
            }}
            onMouseLeave={e => {
              const b = e.currentTarget;
              b.style.transform = "translateY(0) scale(1)";
              b.style.boxShadow = "0 0 60px rgba(245,200,66,0.4), 0 12px 40px rgba(0,0,0,0.5)";
            }}
          >
            Join a Game
          </button>
        </motion.div>

        {/* Footer line */}
        <div style={{ marginTop: 80 }}>
          <GeoDivider />
          <div style={{ marginTop: 28, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <p style={{
              fontFamily: "'Poppins', sans-serif",
              fontSize: 12, color: "rgba(250,243,224,0.2)",
              letterSpacing: "0.1em",
            }}>
              Built by{" "}
              <a
                href="https://github.com/HassanA01"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "rgba(245,200,66,0.5)", textDecoration: "none", fontWeight: 600 }}
                onMouseEnter={e => { (e.target as HTMLAnchorElement).style.color = "#f5c842"; }}
                onMouseLeave={e => { (e.target as HTMLAnchorElement).style.color = "rgba(245,200,66,0.5)"; }}
              >
                HassanA01
              </a>
            </p>
            <p style={{
              fontFamily: "'Poppins', sans-serif",
              fontSize: 11, color: "rgba(250,243,224,0.15)",
              letterSpacing: "0.08em",
            }}>
              © {new Date().getFullYear()} Iftaroot. All rights reserved.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
