import { useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { Sparkles, X } from "lucide-react";
import { generateQuiz, type GenerateQuizResponse } from "../api/ai";

interface Props {
  onClose: () => void;
  onGenerated: (data: GenerateQuizResponse) => void;
}

export function GenerateQuizModal({ onClose, onGenerated }: Props) {
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(5);
  const [context, setContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputStyle = {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(245,200,66,0.2)",
    color: "white",
  };

  const countInvalid = count < 1 || count > 10;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (countInvalid) {
      setError("Maximum 10 questions for AI generation.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const data = await generateQuiz({ topic: topic.trim(), question_count: count, context: context.trim() });
      onGenerated(data);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Something went wrong. Please try again.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
        <motion.div
          className="w-full max-w-md rounded-2xl p-6 relative"
          style={{
            background: "linear-gradient(135deg, rgba(42,20,66,0.98) 0%, rgba(20,10,40,0.99) 100%)",
            border: "1px solid rgba(245,200,66,0.3)",
            boxShadow: "0 0 40px rgba(245,200,66,0.15)",
          }}
          initial={{ scale: 0.92, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.92, opacity: 0, y: 20 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5" style={{ color: "#f5c842" }} />
              <h3 className="text-lg font-black text-white">Generate with AI</h3>
            </div>
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg transition"
              style={{ color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.05)" }}>
              <X className="w-4 h-4" />
            </button>
          </div>

          {loading ? (
            <div className="py-10 flex flex-col items-center gap-4">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}>
                <Sparkles className="w-8 h-8" style={{ color: "#f5c842" }} />
              </motion.div>
              <p className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.7)" }}>
                Summoning questions from the stars...
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: "rgba(255,255,255,0.7)" }}>
                  Topic <span style={{ color: "#f44336" }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g. Islamic history, photosynthesis, Premier League"
                  className="w-full rounded-xl px-4 py-3 text-sm outline-none transition"
                  style={inputStyle}
                  onFocus={(e) => (e.target.style.borderColor = "rgba(245,200,66,0.6)")}
                  onBlur={(e) => (e.target.style.borderColor = "rgba(245,200,66,0.2)")}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: "rgba(255,255,255,0.7)" }}>
                  Number of questions
                </label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                  className="w-full rounded-xl px-4 py-3 text-sm outline-none transition"
                  style={{
                    ...inputStyle,
                    borderColor: countInvalid ? "rgba(244,67,54,0.5)" : inputStyle.border.split(" ").pop(),
                  }}
                  onFocus={(e) => (e.target.style.borderColor = countInvalid ? "rgba(244,67,54,0.7)" : "rgba(245,200,66,0.6)")}
                  onBlur={(e) => (e.target.style.borderColor = countInvalid ? "rgba(244,67,54,0.5)" : "rgba(245,200,66,0.2)")}
                />
                {countInvalid && (
                  <p className="text-xs mt-1" style={{ color: "#f44336" }}>
                    Maximum 10 questions for AI generation.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: "rgba(255,255,255,0.7)" }}>
                  Additional context <span style={{ color: "rgba(255,255,255,0.3)" }}>(optional)</span>
                </label>
                <textarea
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  rows={3}
                  placeholder="e.g. hard difficulty, university level, avoid trick questions"
                  className="w-full rounded-xl px-4 py-3 text-sm outline-none transition resize-none"
                  style={inputStyle}
                  onFocus={(e) => (e.target.style.borderColor = "rgba(245,200,66,0.6)")}
                  onBlur={(e) => (e.target.style.borderColor = "rgba(245,200,66,0.2)")}
                />
              </div>

              {error && (
                <div className="text-sm rounded-xl px-4 py-3"
                  style={{ background: "rgba(244,67,54,0.1)", border: "1px solid rgba(244,67,54,0.3)", color: "#f44336" }}>
                  {error}
                </div>
              )}

              <motion.button
                type="submit"
                className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2"
                style={{
                  background: "linear-gradient(135deg, #f5c842 0%, #ff6b35 100%)",
                  color: "white",
                  boxShadow: "0 6px 24px rgba(245,200,66,0.35)",
                }}
                whileHover={{ scale: 1.02, boxShadow: "0 8px 30px rgba(245,200,66,0.5)" }}
                whileTap={{ scale: 0.98 }}>
                <Sparkles className="w-4 h-4" />
                Generate Quiz
              </motion.button>
            </form>
          )}
        </motion.div>
    </motion.div>
  );
}
