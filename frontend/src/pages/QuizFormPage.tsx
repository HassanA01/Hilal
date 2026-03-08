import { useState, type FormEvent } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";
import { Plus, Trash2, Check, Sparkles, ArrowUp, ArrowDown, Image, Loader2, X } from "lucide-react";
import { CrescentIcon } from "../components/icons";
import { getQuiz, createQuiz, updateQuiz } from "../api/quizzes";
import type { Quiz, QuestionType } from "../types";
import type { QuestionInput } from "../api/quizzes";
import { GenerateQuizModal } from "../components/GenerateQuizModal";
import { uploadImage } from "../api/uploads";

interface OptionDraft {
  text: string;
  is_correct: boolean;
  image_url?: string;
}

interface QuestionDraft {
  text: string;
  type: QuestionType;
  time_limit: number;
  image_url?: string;
  options: OptionDraft[];
}

function blankOption(): OptionDraft {
  return { text: "", is_correct: false };
}

function blankQuestion(type: QuestionType = "multiple_choice"): QuestionDraft {
  switch (type) {
    case "true_false":
      return {
        text: "", type, time_limit: 20,
        options: [{ text: "True", is_correct: true }, { text: "False", is_correct: false }],
      };
    case "ordering":
      return {
        text: "", type, time_limit: 30,
        options: [{ text: "", is_correct: false }, { text: "", is_correct: false }, { text: "", is_correct: false }],
      };
    case "image_choice":
      return {
        text: "", type, time_limit: 20, image_url: "",
        options: [
          { text: "", is_correct: true, image_url: "" },
          { text: "", is_correct: false, image_url: "" },
        ],
      };
    default:
      return { text: "", type: "multiple_choice", time_limit: 20, options: [blankOption(), blankOption()] };
  }
}

const OPTION_COLORS = ["#4caf50", "#2196f3", "#ff6b35", "#f44336"];
const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

const TYPE_LABELS: Record<QuestionType, string> = {
  multiple_choice: "Multiple Choice",
  true_false: "True / False",
  image_choice: "Image Choice",
  ordering: "Ordering",
};

// ── Inner form ────────────────────────────────────────────────────────────────

interface QuizFormProps {
  quizID?: string;
  initial: { title: string; questions: QuestionDraft[] };
}

function QuizForm({ quizID, initial }: QuizFormProps) {
  const isEdit = !!quizID;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState(initial.title);
  const [questions, setQuestions] = useState<QuestionDraft[]>(initial.questions);
  const [formError, setFormError] = useState<string | null>(null);
  const [showAIModal, setShowAIModal] = useState(false);
  const [uploadingQuestion, setUploadingQuestion] = useState<number | null>(null);
  const [uploadingOption, setUploadingOption] = useState<{ q: number; o: number } | null>(null);

  const mutation = useMutation({
    mutationFn: (input: { title: string; questions: QuestionInput[] }) =>
      isEdit ? updateQuiz(quizID!, input) : createQuiz(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quizzes"] });
      if (isEdit) queryClient.invalidateQueries({ queryKey: ["quiz", quizID] });
      navigate("/admin/quizzes");
    },
  });

  function validate(): string | null {
    if (!title.trim()) return "Quiz title is required.";
    if (questions.length === 0) return "Add at least one question.";
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.text.trim()) return `Question ${i + 1} needs text.`;
      for (let j = 0; j < q.options.length; j++) {
        if (!q.options[j].text.trim())
          return `Question ${i + 1}, option ${j + 1} needs text.`;
      }

      switch (q.type) {
        case "multiple_choice":
          if (q.options.length < 2 || q.options.length > 4)
            return `Question ${i + 1} must have 2–4 options.`;
          if (q.options.filter((o) => o.is_correct).length !== 1)
            return `Question ${i + 1} must have exactly one correct option.`;
          break;
        case "true_false":
          if (q.options.length !== 2)
            return `Question ${i + 1} must have exactly 2 options.`;
          if (q.options.filter((o) => o.is_correct).length !== 1)
            return `Question ${i + 1} must have exactly one correct option.`;
          break;
        case "image_choice":
          if (q.options.length < 2 || q.options.length > 4)
            return `Question ${i + 1} must have 2–4 options.`;
          if (q.options.filter((o) => o.is_correct).length !== 1)
            return `Question ${i + 1} must have exactly one correct option.`;
          for (let j = 0; j < q.options.length; j++) {
            if (!q.options[j].image_url?.trim())
              return `Question ${i + 1}, option ${j + 1} needs an image URL.`;
          }
          break;
        case "ordering":
          if (q.options.length < 2 || q.options.length > 8)
            return `Question ${i + 1} must have 2–8 items.`;
          break;
      }
    }
    return null;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) { setFormError(err); return; }
    setFormError(null);
    mutation.mutate({
      title: title.trim(),
      questions: questions.map((q, i) => ({
        text: q.text.trim(),
        type: q.type,
        time_limit: q.time_limit,
        order: i + 1,
        image_url: q.image_url || undefined,
        options: q.options.map((o, j) => ({
          text: o.text.trim(),
          is_correct: o.is_correct,
          image_url: o.image_url || undefined,
          sort_order: j,
        })),
      })),
    });
  }

  function updateQuestion(idx: number, patch: Partial<QuestionDraft>) {
    setQuestions((qs) => qs.map((q, i) => (i === idx ? { ...q, ...patch } : q)));
  }
  function changeQuestionType(idx: number, newType: QuestionType) {
    setQuestions((qs) => qs.map((q, i) => (i === idx ? blankQuestion(newType) : q)));
  }
  function addQuestion() { setQuestions((qs) => [...qs, blankQuestion()]); }
  function removeQuestion(idx: number) { setQuestions((qs) => qs.filter((_, i) => i !== idx)); }
  function updateOption(qIdx: number, oIdx: number, patch: Partial<OptionDraft>) {
    setQuestions((qs) => qs.map((q, i) =>
      i !== qIdx ? q : { ...q, options: q.options.map((o, j) => (j === oIdx ? { ...o, ...patch } : o)) }
    ));
  }
  function setCorrect(qIdx: number, oIdx: number) {
    setQuestions((qs) => qs.map((q, i) =>
      i !== qIdx ? q : { ...q, options: q.options.map((o, j) => ({ ...o, is_correct: j === oIdx })) }
    ));
  }
  function addOption(qIdx: number) {
    setQuestions((qs) => qs.map((q, i) => (i !== qIdx ? q : { ...q, options: [...q.options, blankOption()] })));
  }
  function removeOption(qIdx: number, oIdx: number) {
    setQuestions((qs) => qs.map((q, i) =>
      i !== qIdx ? q : { ...q, options: q.options.filter((_, j) => j !== oIdx) }
    ));
  }
  function moveOption(qIdx: number, oIdx: number, direction: -1 | 1) {
    setQuestions((qs) => qs.map((q, i) => {
      if (i !== qIdx) return q;
      const newOpts = [...q.options];
      const target = oIdx + direction;
      if (target < 0 || target >= newOpts.length) return q;
      [newOpts[oIdx], newOpts[target]] = [newOpts[target], newOpts[oIdx]];
      return { ...q, options: newOpts };
    }));
  }

  async function handleImageUpload(qIdx: number, file: File) {
    setUploadingQuestion(qIdx);
    try {
      const { url } = await uploadImage(file);
      updateQuestion(qIdx, { image_url: url });
    } catch {
      setFormError("Failed to upload image. Please try again.");
    } finally {
      setUploadingQuestion(null);
    }
  }
  async function handleOptionImageUpload(qIdx: number, oIdx: number, file: File) {
    setUploadingOption({ q: qIdx, o: oIdx });
    try {
      const { url } = await uploadImage(file);
      updateOption(qIdx, oIdx, { image_url: url });
    } catch {
      setFormError("Failed to upload image. Please try again.");
    } finally {
      setUploadingOption(null);
    }
  }

  const inputStyle = {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(245,200,66,0.2)",
    color: "white",
  };

  function renderOptions(q: QuestionDraft, qIdx: number) {
    const isOrdering = q.type === "ordering";
    const isTF = q.type === "true_false";
    const isImage = q.type === "image_choice";
    const maxOptions = isOrdering ? 8 : 4;

    return (
      <div className="space-y-2">
        {isOrdering && (
          <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
            Items are in correct order. Players will see them shuffled.
          </p>
        )}
        {q.options.map((o, oIdx) => {
          const color = OPTION_COLORS[oIdx % 4];
          return (
            <div key={oIdx} className="flex items-center gap-2">
              {isOrdering ? (
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button type="button" disabled={oIdx === 0} onClick={() => moveOption(qIdx, oIdx, -1)}
                    className="p-0.5 rounded disabled:opacity-20" style={{ color: "#f5c842" }}>
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" disabled={oIdx === q.options.length - 1} onClick={() => moveOption(qIdx, oIdx, 1)}
                    className="p-0.5 rounded disabled:opacity-20" style={{ color: "#f5c842" }}>
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCorrect(qIdx, oIdx)}
                  disabled={isTF && o.is_correct}
                  className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm shrink-0 transition"
                  style={{
                    background: o.is_correct ? color : `${color}22`,
                    border: `2px solid ${o.is_correct ? color : `${color}44`}`,
                    color: o.is_correct ? "white" : color,
                  }}
                  title="Mark as correct">
                  {o.is_correct ? <Check className="w-4 h-4" /> : OPTION_LETTERS[oIdx]}
                </button>
              )}

              <div className="flex-1 flex flex-col gap-1">
                <input
                  type="text"
                  required
                  value={o.text}
                  onChange={(e) => updateOption(qIdx, oIdx, { text: e.target.value })}
                  disabled={isTF}
                  className="w-full rounded-xl px-3 py-2 text-sm outline-none transition disabled:opacity-60"
                  style={inputStyle}
                  onFocus={(e) => (e.target.style.borderColor = color)}
                  onBlur={(e) => (e.target.style.borderColor = "rgba(245,200,66,0.2)")}
                  placeholder={isOrdering ? `Item ${oIdx + 1}` : `Option ${oIdx + 1}`}
                />
                {isImage && (
                  <div className="flex items-center gap-1">
                    {o.image_url ? (
                      <div className="flex items-center gap-1.5 flex-1 rounded-lg px-1.5 py-0.5" style={{ background: "rgba(245,200,66,0.08)", border: "1px solid rgba(245,200,66,0.2)" }}>
                        <img src={o.image_url} alt="Preview" className="w-7 h-7 rounded object-cover shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        <span className="text-[10px] truncate flex-1" style={{ color: "rgba(255,255,255,0.5)" }}>Image</span>
                        <button type="button" onClick={() => updateOption(qIdx, oIdx, { image_url: "" })} className="p-0.5 rounded transition hover:bg-white/10 shrink-0" title="Remove image">
                          <X className="w-3 h-3" style={{ color: "rgba(255,255,255,0.4)" }} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <label className="cursor-pointer shrink-0" title="Upload image">
                          {uploadingOption?.q === qIdx && uploadingOption?.o === oIdx ? (
                            <Loader2 className="w-3 h-3 animate-spin" style={{ color: "#f5c842" }} />
                          ) : (
                            <Image className="w-3 h-3" style={{ color: "rgba(255,255,255,0.4)" }} />
                          )}
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handleOptionImageUpload(qIdx, oIdx, f);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        <input
                          type="url"
                          value={o.image_url ?? ""}
                          onChange={(e) => updateOption(qIdx, oIdx, { image_url: e.target.value })}
                          className="w-full rounded-lg px-2 py-1 text-xs outline-none transition"
                          style={inputStyle}
                          placeholder="Image URL"
                        />
                      </>
                    )}
                  </div>
                )}
              </div>

              {!isTF && q.options.length > 2 && (
                <button type="button" onClick={() => removeOption(qIdx, oIdx)}
                  className="p-1.5 rounded-lg transition shrink-0" style={{ color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.05)" }}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}
        {!isTF && q.options.length < maxOptions && (
          <button type="button" onClick={() => addOption(qIdx)}
            className="text-xs font-medium transition mt-1 flex items-center gap-1"
            style={{ color: "#f5c842" }}>
            <Plus className="w-3 h-3" /> Add {isOrdering ? "item" : "option"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <motion.div className="flex items-center gap-3 mb-8" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <CrescentIcon className="w-6 h-6" style={{ color: "#f5c842" }} />
        <h2 className="text-2xl font-black text-white">{isEdit ? "Edit quiz" : "New quiz"}</h2>
      </motion.div>

      {!isEdit && (
        <>
          <motion.button
            type="button"
            onClick={() => setShowAIModal(true)}
            className="w-full mb-6 py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2.5 relative overflow-hidden"
            style={{
              background: "linear-gradient(135deg, #f5c842 0%, #ff6b35 100%)",
              color: "white",
              boxShadow: "0 6px 28px rgba(245,200,66,0.4)",
            }}
            whileHover={{ scale: 1.01, boxShadow: "0 10px 36px rgba(245,200,66,0.55)" }}
            whileTap={{ scale: 0.99 }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}>
            <motion.span
              className="absolute inset-0 pointer-events-none"
              style={{
                background: "linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.25) 50%, transparent 60%)",
                backgroundSize: "200% 100%",
              }}
              animate={{ backgroundPositionX: ["200%", "-200%"] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: "linear", repeatDelay: 1 }}
            />
            <Sparkles className="w-4 h-4 relative z-10" />
            <span className="relative z-10">Generate with AI</span>
          </motion.button>

          <AnimatePresence>
            {showAIModal && (
              <GenerateQuizModal
                onClose={() => setShowAIModal(false)}
                onGenerated={(data) => {
                  setShowAIModal(false);
                  setTitle(data.title);
                  setQuestions(
                    data.questions.map((q) => ({
                      text: q.text,
                      type: (q.type as QuestionType) || "multiple_choice",
                      time_limit: q.time_limit,
                      options: q.options.map((o) => ({ text: o.text, is_correct: o.is_correct })),
                    }))
                  );
                }}
              />
            )}
          </AnimatePresence>
        </>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Title */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <label className="block text-sm font-medium mb-1.5" style={{ color: "rgba(255,255,255,0.7)" }}>Quiz title</label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-xl px-4 py-3 text-sm outline-none transition"
            style={inputStyle}
            onFocus={(e) => (e.target.style.borderColor = "rgba(245,200,66,0.6)")}
            onBlur={(e) => (e.target.style.borderColor = "rgba(245,200,66,0.2)")}
            placeholder="e.g. General Knowledge"
          />
        </motion.div>

        {/* Questions */}
        <div className="space-y-4">
          {questions.map((q, qIdx) => (
            <motion.div key={qIdx}
              className="p-5 rounded-2xl space-y-4"
              style={{ background: "linear-gradient(135deg, rgba(42,20,66,0.8) 0%, rgba(30,15,50,0.9) 100%)", border: "1px solid rgba(245,200,66,0.15)" }}
              initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: qIdx * 0.04 }}>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold"
                    style={{ background: "rgba(245,200,66,0.2)", color: "#f5c842" }}>
                    {qIdx + 1}
                  </div>
                  <span className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.7)" }}>Question {qIdx + 1}</span>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={q.type}
                    onChange={(e) => changeQuestionType(qIdx, e.target.value as QuestionType)}
                    className="rounded-lg px-2 py-1 text-xs outline-none cursor-pointer"
                    style={{ background: "rgba(245,200,66,0.15)", color: "#f5c842", border: "1px solid rgba(245,200,66,0.3)" }}
                    aria-label="Question type">
                    {(Object.entries(TYPE_LABELS) as [QuestionType, string][]).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                  {questions.length > 1 && (
                    <button type="button" onClick={() => removeQuestion(qIdx)} aria-label="Remove"
                      className="p-1.5 rounded-lg transition" style={{ color: "#f44336", background: "rgba(244,67,54,0.1)" }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <input
                type="text"
                required
                value={q.text}
                onChange={(e) => updateQuestion(qIdx, { text: e.target.value })}
                className="w-full rounded-xl px-4 py-2.5 text-sm outline-none transition"
                style={inputStyle}
                onFocus={(e) => (e.target.style.borderColor = "rgba(245,200,66,0.6)")}
                onBlur={(e) => (e.target.style.borderColor = "rgba(245,200,66,0.2)")}
                placeholder={q.type === "ordering" ? "e.g. Arrange these events in chronological order" : "Question text"}
              />

              <div className="flex items-center gap-2">
                {q.image_url ? (
                  <div className="flex items-center gap-2 flex-1 rounded-lg px-2 py-1" style={{ background: "rgba(245,200,66,0.08)", border: "1px solid rgba(245,200,66,0.2)" }}>
                    <img src={q.image_url} alt="Preview" className="w-10 h-10 rounded object-cover shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    <span className="text-xs truncate flex-1" style={{ color: "rgba(255,255,255,0.5)" }}>Image attached</span>
                    <button type="button" onClick={() => updateQuestion(qIdx, { image_url: "" })} className="p-1 rounded transition hover:bg-white/10 shrink-0" title="Remove image">
                      <X className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.4)" }} />
                    </button>
                  </div>
                ) : (
                  <>
                    <label className="cursor-pointer shrink-0 p-1 rounded-lg transition hover:bg-white/10" title="Upload image">
                      {uploadingQuestion === qIdx ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "#f5c842" }} />
                      ) : (
                        <Image className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.4)" }} />
                      )}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleImageUpload(qIdx, f);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <input
                      type="url"
                      value={q.image_url ?? ""}
                      onChange={(e) => updateQuestion(qIdx, { image_url: e.target.value })}
                      className="flex-1 rounded-lg px-3 py-1.5 text-xs outline-none transition"
                      style={inputStyle}
                      placeholder="Question image URL (optional)"
                    />
                  </>
                )}
              </div>

              <div className="flex items-center gap-3">
                <label className="text-xs whitespace-nowrap" style={{ color: "rgba(255,255,255,0.5)" }}>Time limit (s)</label>
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={q.time_limit}
                  onChange={(e) => updateQuestion(qIdx, { time_limit: Number(e.target.value) })}
                  className="w-20 rounded-lg px-3 py-1.5 text-sm outline-none transition"
                  style={inputStyle}
                  onFocus={(e) => (e.target.style.borderColor = "rgba(245,200,66,0.6)")}
                  onBlur={(e) => (e.target.style.borderColor = "rgba(245,200,66,0.2)")}
                />
              </div>

              {renderOptions(q, qIdx)}
            </motion.div>
          ))}

          <motion.button
            type="button"
            onClick={addQuestion}
            className="w-full py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition"
            style={{ border: "2px dashed rgba(245,200,66,0.3)", color: "rgba(245,200,66,0.7)" }}
            whileHover={{ borderColor: "rgba(245,200,66,0.6)", color: "#f5c842" }}>
            <Plus className="w-4 h-4" /> Add question
          </motion.button>
        </div>

        {(formError || mutation.isError) && (
          <div className="text-sm rounded-xl px-4 py-3"
            style={{ background: "rgba(244,67,54,0.1)", border: "1px solid rgba(244,67,54,0.3)", color: "#f44336" }}>
            {formError ??
              (mutation.error as { response?: { data?: { error?: string } } })?.response?.data?.error ??
              "Something went wrong. Please try again."}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <motion.button
            type="submit"
            disabled={mutation.isPending}
            className="px-6 py-2.5 rounded-xl font-bold text-sm text-white disabled:cursor-not-allowed"
            style={{
              background: mutation.isPending ? "rgba(255,107,53,0.4)" : "linear-gradient(135deg, #ff6b35 0%, #ff8c5a 100%)",
              boxShadow: mutation.isPending ? "none" : "0 6px 20px rgba(255,107,53,0.35)",
            }}
            whileHover={!mutation.isPending ? { scale: 1.02 } : {}}
            whileTap={!mutation.isPending ? { scale: 0.98 } : {}}>
            {mutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Create quiz"}
          </motion.button>
          <button type="button" onClick={() => navigate("/admin/quizzes")}
            className="text-sm transition" style={{ color: "rgba(255,255,255,0.4)" }}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Page wrapper ──────────────────────────────────────────────────────────────

function quizToInitial(quiz: Quiz) {
  return {
    title: quiz.title,
    questions:
      quiz.questions && quiz.questions.length > 0
        ? quiz.questions.map((q) => ({
            text: q.text,
            type: q.type || ("multiple_choice" as QuestionType),
            time_limit: q.time_limit,
            image_url: q.image_url,
            options: q.options.map((o) => ({ text: o.text, is_correct: !!o.is_correct, image_url: o.image_url })),
          }))
        : [blankQuestion()],
  };
}

export function QuizFormPage() {
  const { quizID } = useParams<{ quizID: string }>();
  const location = useLocation();
  const isEdit = !!quizID;

  const { data: existing, isLoading, isError } = useQuery({
    queryKey: ["quiz", quizID],
    queryFn: () => getQuiz(quizID!),
    enabled: isEdit,
  });

  if (isEdit && isLoading) {
    return (
      <div className="flex gap-3 justify-center py-12">
        {[0, 1, 2].map((i) => (
          <motion.div key={i} className="w-3 h-3 rounded-full" style={{ background: "#f5c842" }}
            animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }} />
        ))}
      </div>
    );
  }

  if (isEdit && (isError || !existing)) {
    return <p className="text-center py-12" style={{ color: "#f44336" }}>Quiz not found.</p>;
  }

  const initial = existing
    ? quizToInitial(existing)
    : (location.state as { generated?: { title: string; questions: QuestionDraft[] } })?.generated
      ?? { title: "", questions: [blankQuestion()] };

  return <QuizForm quizID={quizID} initial={initial} />;
}
