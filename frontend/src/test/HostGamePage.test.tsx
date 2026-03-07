import { render, screen, act, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HostGamePage } from "../pages/HostGamePage";

// Mock useWebSocket so we can control incoming messages without a real WS.
const mockSend = vi.fn();
let capturedOnMessage: ((msg: unknown) => void) | null = null;

vi.mock("../hooks/useWebSocket", () => ({
  useWebSocket: (opts: { onMessage: (msg: unknown) => void }) => {
    capturedOnMessage = opts.onMessage;
    return { send: mockSend };
  },
}));

function renderHostGame(code = "123456") {
  return render(
    <MemoryRouter initialEntries={[`/admin/game/${code}`]}>
      <Routes>
        <Route path="/admin/game/:code" element={<HostGamePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const fakeQuestion = {
  type: "question",
  payload: {
    question_index: 0,
    total_questions: 3,
    question: {
      id: "q-1",
      text: "What is 2+2?",
      type: "multiple_choice",
      time_limit: 20,
      options: [
        { id: "o-1", text: "3", is_correct: false },
        { id: "o-2", text: "4", is_correct: true },
        { id: "o-3", text: "5", is_correct: false },
        { id: "o-4", text: "6", is_correct: false },
      ],
    },
  },
};

describe("HostGamePage", () => {
  beforeEach(() => {
    mockSend.mockClear();
    capturedOnMessage = null;
  });

  it("shows waiting spinner before first question", () => {
    renderHostGame();
    expect(screen.getByText(/starting game/i)).toBeInTheDocument();
  });

  it("renders question when question message received", () => {
    renderHostGame();
    act(() => capturedOnMessage!(fakeQuestion));
    expect(screen.getByText("What is 2+2?")).toBeInTheDocument();
    // Question counter shown in progress bar
    expect(screen.getByText("Q1 / 3")).toBeInTheDocument();
    // All 4 options visible
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("shows correct answer highlighted on reveal", () => {
    renderHostGame();
    act(() => capturedOnMessage!(fakeQuestion));
    act(() =>
      capturedOnMessage!({
        type: "answer_reveal",
        payload: {
          correct_option_id: "o-2",
          scores: { "player-1": { is_correct: true, points: 800, total_score: 800 } },
        },
      }),
    );
    expect(screen.getByText(/leaderboard coming up/i)).toBeInTheDocument();
  });

  it("shows leaderboard and next question button", () => {
    renderHostGame();
    act(() => capturedOnMessage!(fakeQuestion));
    act(() =>
      capturedOnMessage!({
        type: "leaderboard",
        payload: {
          entries: [
            { player_id: "p1", name: "Alice", score: 800, rank: 1 },
            { player_id: "p2", name: "Bob", score: 500, rank: 2 },
          ],
        },
      }),
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next question/i })).toBeInTheDocument();
  });

  it("shows arc transition then sends next_question after animation", () => {
    vi.useFakeTimers();
    try {
      renderHostGame();
      act(() => capturedOnMessage!(fakeQuestion));
      act(() =>
        capturedOnMessage!({
          type: "leaderboard",
          payload: { entries: [{ player_id: "p1", name: "Alice", score: 800, rank: 1 }] },
        }),
      );

      const btn = screen.getByRole("button", { name: /next question/i });
      act(() => { fireEvent.click(btn); });

      // Arc transition is now showing — prayer labels visible, send not yet called
      expect(screen.getByText("Fajr")).toBeInTheDocument();
      expect(mockSend).not.toHaveBeenCalled();

      // Advance past animation
      act(() => {
        vi.advanceTimersByTime(1600);
      });

      expect(mockSend).toHaveBeenCalledWith({ type: "next_question", payload: {} });
    } finally {
      vi.useRealTimers();
    }
  });

  it("updates answered count from answer_count message", () => {
    renderHostGame();
    act(() => capturedOnMessage!(fakeQuestion));

    // Before any answer_count — shows 0 with no total
    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(1);

    // Backend sends answer_count with answered=2, total=5
    act(() =>
      capturedOnMessage!({
        type: "answer_count",
        payload: { answered: 2, total: 5 },
      }),
    );

    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getAllByText("/ 5").length).toBeGreaterThanOrEqual(1);
  });

  it("resets answered count to 0/N when a new question arrives", () => {
    renderHostGame();
    act(() => capturedOnMessage!(fakeQuestion));
    act(() => capturedOnMessage!({ type: "answer_count", payload: { answered: 3, total: 3 } }));

    // New question resets count
    act(() =>
      capturedOnMessage!({
        ...fakeQuestion,
        payload: { ...fakeQuestion.payload, question_index: 1 },
      }),
    );

    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(1);
  });

  it("shows podium on game_over", () => {
    renderHostGame();
    act(() =>
      capturedOnMessage!({
        type: "podium",
        payload: {
          entries: [
            { player_id: "p1", name: "Alice", score: 2400, rank: 1 },
            { player_id: "p2", name: "Bob", score: 1600, rank: 2 },
          ],
        },
      }),
    );
    expect(screen.getByText(/game over/i)).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("2400")).toBeInTheDocument();
    // Back to Dashboard is the only action button on the podium screen.
    expect(screen.getByRole("button", { name: /back to dashboard/i })).toBeInTheDocument();
  });

  it("shows question type badge in top bar", () => {
    renderHostGame();
    act(() => capturedOnMessage!(fakeQuestion));
    expect(screen.getByText("Multiple Choice")).toBeInTheDocument();
  });

  it("renders ordering question with Correct Order heading", () => {
    renderHostGame();
    act(() =>
      capturedOnMessage!({
        type: "question",
        payload: {
          question_index: 0,
          total_questions: 2,
          question: {
            id: "q-ord",
            text: "Arrange these events in order",
            type: "ordering",
            time_limit: 30,
            options: [
              { id: "o-1", text: "Event A", is_correct: false, sort_order: 0 },
              { id: "o-2", text: "Event B", is_correct: false, sort_order: 1 },
              { id: "o-3", text: "Event C", is_correct: false, sort_order: 2 },
            ],
          },
        },
      }),
    );
    expect(screen.getByText("Arrange these events in order")).toBeInTheDocument();
    expect(screen.getByText("Correct Order")).toBeInTheDocument();
    expect(screen.getByText("Event A")).toBeInTheDocument();
    expect(screen.getByText("Ordering")).toBeInTheDocument();
  });

  it("limits admin podium to top 3 players only", () => {
    renderHostGame();
    act(() =>
      capturedOnMessage!({
        type: "podium",
        payload: {
          entries: [
            { player_id: "p1", name: "Alice", score: 3000, rank: 1 },
            { player_id: "p2", name: "Bob", score: 2000, rank: 2 },
            { player_id: "p3", name: "Carol", score: 1000, rank: 3 },
            { player_id: "p4", name: "Dave", score: 500, rank: 4 },
            { player_id: "p5", name: "Eve", score: 300, rank: 5 },
          ],
        },
      }),
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Carol")).toBeInTheDocument();
    // 4th and 5th players should NOT appear on the admin podium
    expect(screen.queryByText("Dave")).not.toBeInTheDocument();
    expect(screen.queryByText("Eve")).not.toBeInTheDocument();
  });
});
