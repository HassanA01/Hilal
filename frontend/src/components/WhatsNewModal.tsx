import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, CheckCheck, ListChecks, ImageIcon, Sparkles } from "lucide-react";

const CURRENT_VERSION = "1.3.0";
const STORAGE_KEY = `hilal-whats-new-seen-v${CURRENT_VERSION}`;

const features = [
  {
    icon: CheckCheck,
    title: "Multi-Correct MCQ",
    description:
      "Multiple choice questions can now have more than one correct answer. Players pick one — any correct option counts.",
  },
  {
    icon: ListChecks,
    title: "Multi Select Questions",
    description:
      "New question type where players must select all correct answers to score.",
  },
  {
    icon: ImageIcon,
    title: "Image URL Fix",
    description:
      "Image URL inputs now validate on blur instead of immediately showing 'attached'.",
  },
];

export function WhatsNewModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen) {
      // Small delay so the page renders first
      const timer = setTimeout(() => setOpen(true), 600);
      return () => clearTimeout(timer);
    }
  }, []);

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, "1");
    setOpen(false);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0"
            style={{ background: "rgba(10, 5, 20, 0.8)", backdropFilter: "blur(4px)" }}
            onClick={dismiss}
          />

          {/* Modal */}
          <motion.div
            className="relative w-full max-w-md rounded-2xl overflow-hidden"
            style={{
              background:
                "linear-gradient(160deg, rgba(42,20,66,0.95) 0%, rgba(26,10,46,0.98) 100%)",
              border: "1px solid rgba(245, 200, 66, 0.2)",
              boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
            }}
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
          >
            {/* Close button */}
            <button
              onClick={dismiss}
              className="absolute top-3 right-3 p-1.5 rounded-lg transition hover:bg-white/10"
            >
              <X className="w-4 h-4" style={{ color: "rgba(255,255,255,0.4)" }} />
            </button>

            {/* Header */}
            <div className="px-6 pt-6 pb-4 text-center">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full mb-3" style={{ background: "rgba(245,200,66,0.15)" }}>
                <Sparkles className="w-3.5 h-3.5" style={{ color: "#f5c842" }} />
                <span className="text-xs font-semibold" style={{ color: "#f5c842" }}>
                  v{CURRENT_VERSION}
                </span>
              </div>
              <h2
                className="text-xl font-bold"
                style={{ color: "#ffffff" }}
              >
                What&apos;s New
              </h2>
              <p
                className="text-sm mt-1"
                style={{ color: "rgba(255,255,255,0.5)" }}
              >
                Here&apos;s what we&apos;ve been working on
              </p>
            </div>

            {/* Features */}
            <div className="px-6 pb-2 flex flex-col gap-3">
              {features.map((feature, i) => {
                const Icon = feature.icon;
                return (
                  <motion.div
                    key={feature.title}
                    className="flex gap-3 p-3 rounded-xl"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.06)",
                    }}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * 0.1 }}
                  >
                    <div
                      className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center"
                      style={{ background: "rgba(245,200,66,0.12)" }}
                    >
                      <Icon className="w-4.5 h-4.5" style={{ color: "#f5c842" }} />
                    </div>
                    <div className="min-w-0">
                      <h3
                        className="text-sm font-semibold"
                        style={{ color: "#ffffff" }}
                      >
                        {feature.title}
                      </h3>
                      <p
                        className="text-xs mt-0.5 leading-relaxed"
                        style={{ color: "rgba(255,255,255,0.5)" }}
                      >
                        {feature.description}
                      </p>
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {/* CTA */}
            <div className="px-6 pt-4 pb-6">
              <motion.button
                onClick={dismiss}
                className="w-full py-2.5 rounded-xl text-sm font-bold transition"
                style={{
                  background: "#f5c842",
                  color: "#1a0a2e",
                }}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
              >
                Got it
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
