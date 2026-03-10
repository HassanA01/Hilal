import { useState, useRef, type FormEvent } from "react";
import { motion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, X, Upload, FileText, Trash2 } from "lucide-react";
import { generateQuiz, generateQuizFromUpload, type GenerateQuizResponse } from "../api/ai";
import { fetchAppConfig } from "../api/config";

interface Props {
  onClose: () => void;
  onGenerated: (data: GenerateQuizResponse) => void;
}

const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md"];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export function GenerateQuizModal({ onClose, onGenerated }: Props) {
  const [mode, setMode] = useState<"topic" | "upload">("topic");
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(5);
  const [context, setContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [loadingStep, setLoadingStep] = useState("");
  const [questionTypes, setQuestionTypes] = useState<Record<string, boolean>>({
    multiple_choice: true,
    true_false: true,
    ordering: true,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: appConfig } = useQuery({
    queryKey: ["appConfig"],
    queryFn: fetchAppConfig,
    staleTime: 5 * 60 * 1000,
  });
  const maxQuestions = appConfig?.max_ai_questions ?? 20;

  const activeTypes = Object.keys(questionTypes).filter((k) => questionTypes[k]);

  function toggleType(key: string) {
    // Prevent deselecting the last active type
    if (questionTypes[key] && activeTypes.length <= 1) return;
    setQuestionTypes((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const inputStyle = {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(245,200,66,0.2)",
    color: "white",
  };

  const countInvalid = count < 1 || count > maxQuestions;

  function validateFile(selected: File): boolean {
    setFileError(null);
    const ext = "." + selected.name.split(".").pop()?.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      setFileError("Unsupported file type. Use PDF, DOCX, TXT, or MD.");
      return false;
    }
    if (selected.size > MAX_FILE_SIZE) {
      setFileError("File too large. Maximum size is 5MB.");
      return false;
    }
    return true;
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;
    if (validateFile(selected)) {
      setFile(selected);
      setError(null);
    } else {
      setFile(null);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (!dropped) return;
    if (validateFile(dropped)) {
      setFile(dropped);
      setError(null);
    } else {
      setFile(null);
    }
  }

  function handleError(err: unknown) {
    const axiosErr = err as { response?: { status?: number; data?: { error?: string } } };
    let msg: string;
    if (axiosErr?.response?.status === 429) {
      msg = axiosErr.response.data?.error ?? "Rate limit exceeded. Please try again later.";
    } else {
      msg = axiosErr?.response?.data?.error ?? "Something went wrong. Please try again.";
    }
    setError(msg);
  }

  async function handleTopicSubmit(e: FormEvent) {
    e.preventDefault();
    if (countInvalid) {
      setError(`Maximum ${maxQuestions} questions for AI generation.`);
      return;
    }
    setError(null);
    setLoading(true);
    setLoadingStep("Summoning questions from the stars...");
    try {
      const data = await generateQuiz({ topic: topic.trim(), question_count: count, context: context.trim(), question_types: activeTypes });
      onGenerated(data);
    } catch (err: unknown) {
      handleError(err);
    } finally {
      setLoading(false);
      setLoadingStep("");
    }
  }

  async function handleUploadSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) { setError("Please select a file."); return; }
    if (countInvalid) { setError(`Maximum ${maxQuestions} questions for AI generation.`); return; }
    setError(null);
    setLoading(true);
    setLoadingStep("Extracting text from document...");

    const timer = setTimeout(() => setLoadingStep("Generating questions..."), 3000);

    try {
      const data = await generateQuizFromUpload(file, count, activeTypes);
      onGenerated(data);
    } catch (err: unknown) {
      handleError(err);
    } finally {
      clearTimeout(timer);
      setLoading(false);
      setLoadingStep("");
    }
  }

  const TYPE_LABELS: Record<string, string> = {
    multiple_choice: "Multiple Choice",
    true_false: "True / False",
    ordering: "Ordering",
  };

  const typeChips = (
    <div>
      <label className="block text-sm font-medium mb-1.5" style={{ color: "rgba(255,255,255,0.7)" }}>
        Question types
      </label>
      <div className="flex gap-2">
        {Object.entries(TYPE_LABELS).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => toggleType(key)}
            className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer"
            style={{
              background: questionTypes[key] ? "rgba(245,200,66,0.2)" : "rgba(255,255,255,0.05)",
              border: `1px solid ${questionTypes[key] ? "rgba(245,200,66,0.5)" : "rgba(255,255,255,0.1)"}`,
              color: questionTypes[key] ? "#f5c842" : "rgba(255,255,255,0.3)",
            }}
            aria-pressed={questionTypes[key]}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );

  const tabStyle = (active: boolean) => ({
    color: active ? "#f5c842" : "rgba(255,255,255,0.4)",
    borderBottom: active ? "2px solid #f5c842" : "2px solid transparent",
    background: "transparent",
  });

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
          <div className="flex items-center justify-between mb-4">
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
                {mode === "upload" ? (
                  <Upload className="w-8 h-8" style={{ color: "#f5c842" }} />
                ) : (
                  <Sparkles className="w-8 h-8" style={{ color: "#f5c842" }} />
                )}
              </motion.div>
              <p className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.7)" }}>
                {loadingStep}
              </p>
            </div>
          ) : (
            <>
              {/* Tabs */}
              <div className="flex gap-0 mb-5" style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                <button
                  type="button"
                  onClick={() => { setMode("topic"); setError(null); }}
                  className="flex-1 pb-2.5 text-sm font-semibold transition-colors cursor-pointer"
                  style={tabStyle(mode === "topic")}
                >
                  Topic
                </button>
                <button
                  type="button"
                  onClick={() => { setMode("upload"); setError(null); }}
                  className="flex-1 pb-2.5 text-sm font-semibold transition-colors cursor-pointer"
                  style={tabStyle(mode === "upload")}
                >
                  Upload Document
                </button>
              </div>

              {mode === "topic" ? (
                <form onSubmit={handleTopicSubmit} className="space-y-4">
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
                      max={maxQuestions}
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
                        Maximum {maxQuestions} questions for AI generation.
                      </p>
                    )}
                  </div>

                  {typeChips}

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
              ) : (
                <form onSubmit={handleUploadSubmit} className="space-y-4">
                  {/* File drop zone */}
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.docx,.txt,.md"
                      onChange={handleFileChange}
                      className="hidden"
                      data-testid="file-input"
                    />

                    {!file ? (
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={handleDrop}
                        className="rounded-xl p-8 flex flex-col items-center gap-3 cursor-pointer transition-colors"
                        style={{
                          border: "2px dashed rgba(245,200,66,0.3)",
                          background: "rgba(255,255,255,0.03)",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.borderColor = "rgba(245,200,66,0.5)")}
                        onMouseLeave={(e) => (e.currentTarget.style.borderColor = "rgba(245,200,66,0.3)")}
                      >
                        <Upload className="w-8 h-8" style={{ color: "rgba(245,200,66,0.6)" }} />
                        <p className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.7)" }}>
                          Drop a file or click to browse
                        </p>
                        <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                          PDF, DOCX, TXT, MD (max 5MB)
                        </p>
                      </div>
                    ) : (
                      <div
                        className="rounded-xl px-4 py-3 flex items-center gap-3"
                        style={{
                          background: "rgba(245,200,66,0.08)",
                          border: "1px solid rgba(245,200,66,0.25)",
                        }}
                      >
                        <FileText className="w-5 h-5 shrink-0" style={{ color: "#f5c842" }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{file.name}</p>
                          <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                            {formatFileSize(file.size)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => { setFile(null); setFileError(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                          className="p-1.5 rounded-lg transition cursor-pointer"
                          style={{ color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.05)" }}
                          aria-label="Remove file"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}

                    {fileError && (
                      <p className="text-xs mt-1.5" style={{ color: "#f44336" }}>
                        {fileError}
                      </p>
                    )}
                  </div>

                  {/* Question count */}
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: "rgba(255,255,255,0.7)" }}>
                      Number of questions
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={maxQuestions}
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
                        Maximum {maxQuestions} questions for AI generation.
                      </p>
                    )}
                  </div>

                  {typeChips}

                  {error && (
                    <div className="text-sm rounded-xl px-4 py-3"
                      style={{ background: "rgba(244,67,54,0.1)", border: "1px solid rgba(244,67,54,0.3)", color: "#f44336" }}>
                      {error}
                    </div>
                  )}

                  <motion.button
                    type="submit"
                    disabled={!file}
                    className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                      background: "linear-gradient(135deg, #f5c842 0%, #ff6b35 100%)",
                      color: "white",
                      boxShadow: file ? "0 6px 24px rgba(245,200,66,0.35)" : "none",
                    }}
                    whileHover={file ? { scale: 1.02, boxShadow: "0 8px 30px rgba(245,200,66,0.5)" } : {}}
                    whileTap={file ? { scale: 0.98 } : {}}>
                    <Upload className="w-4 h-4" />
                    Generate from Document
                  </motion.button>
                </form>
              )}
            </>
          )}
        </motion.div>
    </motion.div>
  );
}
