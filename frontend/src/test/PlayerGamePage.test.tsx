import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PlayerGamePage } from "../pages/PlayerGamePage";
import * as sessionsApi from "../api/sessions";
import type { PlayerResults } from "../types";

vi.mock("../api/sessions", () => ({
  getPlayerResults: vi.fn(),
}));

const PLAYER_ID = "player-123";
const SESSION_ID = "session-456";
const mockSend = vi.fn();
let capturedOnMessage: ((msg: unknown) => void) | null = null;

vi.mock("../hooks/useWebSocket", () => ({
  useWebSocket: (opts: { onMessage: (msg: unknown) => void }) => {
    capturedOnMessage = opts.onMessage;
    return { send: mockSend };
  },
}));

beforeEach(() => {
  mockSend.mockClear();
  capturedOnMessage = null;
  vi.mocked(sessionsApi.getPlayerResults).mockResolvedValue({
    player_id: PLAYER_ID,
    name: "Alice",
    score: 2700,
    rank: 1,
    questions: [],
  } as PlayerResults);
  // Simulate player identity in sessionStorage.
  sessionStorage.setItem("player_id", PLAYER_ID);
  sessionStorage.setItem("player_name", "Alice");
  sessionStorage.setItem("session_id", SESSION_ID);
});

function renderPlayerGame(code = "123456") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/game/${code}/play`]}>
        <Routes>
          <Route path="/game/:code/play" element={<PlayerGamePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
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
      time_limit: 20,
      options: [
        { id: "o-1", text: "3" },
        { id: "o-2", text: "4" },
        { id: "o-3", text: "5" },
        { id: "o-4", text: "6" },
      ],
    },
  },
};

describe("PlayerGamePage", () => {
  it("shows waiting spinner initially", () => {
    renderPlayerGame();
    expect(screen.getByText(/get ready/i)).toBeInTheDocument();
  });

  it("displays question and options on question message", () => {
    renderPlayerGame();
    act(() => capturedOnMessage!(fakeQuestion));
    expect(screen.getByText("What is 2+2?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /3/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /4/i })).toBeInTheDocument();
  });

  it("sends answer_submitted and replaces options with locked-in waiting state", async () => {
    renderPlayerGame();
    act(() => capturedOnMessage!(fakeQuestion));

    await userEvent.click(screen.getByRole("button", { name: /4/i }));

    expect(mockSend).toHaveBeenCalledWith({
      type: "answer_submitted",
      payload: { question_id: "q-1", option_id: "o-2" },
    });

    // Option buttons are replaced by the locked-in waiting card
    expect(screen.getByText(/answer locked in/i)).toBeInTheDocument();
    expect(screen.getByText(/waiting for others/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("does not show correct/incorrect feedback before answer_reveal message", async () => {
    renderPlayerGame();
    act(() => capturedOnMessage!(fakeQuestion));

    await userEvent.click(screen.getByRole("button", { name: /4/i }));

    // No reveal feedback — phase is still "question"
    expect(screen.queryByText("Correct!")).not.toBeInTheDocument();
    expect(screen.queryByText("Incorrect")).not.toBeInTheDocument();
    // Neutral waiting state shown
    expect(screen.getByText(/answer locked in/i)).toBeInTheDocument();
    expect(screen.getByText(/waiting for others/i)).toBeInTheDocument();
  });

  it("shows reveal with correct feedback for this player", () => {
    renderPlayerGame();
    act(() => capturedOnMessage!(fakeQuestion));
    act(() =>
      capturedOnMessage!({
        type: "answer_reveal",
        payload: {
          correct_option_id: "o-2",
          scores: {
            [PLAYER_ID]: { is_correct: true, points: 900, total_score: 900 },
          },
        },
      }),
    );
    expect(screen.getByText("Correct!")).toBeInTheDocument();
    expect(screen.getByText("+900")).toBeInTheDocument();
  });

  it("shows incorrect feedback when player chose wrong answer", () => {
    renderPlayerGame();
    act(() => capturedOnMessage!(fakeQuestion));
    act(() =>
      capturedOnMessage!({
        type: "answer_reveal",
        payload: {
          correct_option_id: "o-2",
          scores: {
            [PLAYER_ID]: { is_correct: false, points: 0, total_score: 500 },
          },
        },
      }),
    );
    expect(screen.getByText("Incorrect")).toBeInTheDocument();
  });

  it("shows leaderboard with player highlighted", () => {
    renderPlayerGame();
    act(() =>
      capturedOnMessage!({
        type: "leaderboard",
        payload: {
          entries: [
            { player_id: PLAYER_ID, name: "Alice", score: 900, rank: 1 },
            { player_id: "other", name: "Bob", score: 400, rank: 2 },
          ],
        },
      }),
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText(/waiting for host/i)).toBeInTheDocument();
  });

  it("shows podium screen on game_over", () => {
    renderPlayerGame();
    act(() =>
      capturedOnMessage!({
        type: "podium",
        payload: {
          entries: [
            { player_id: PLAYER_ID, name: "Alice", score: 2700, rank: 1 },
            { player_id: "other", name: "Bob", score: 1800, rank: 2 },
          ],
        },
      }),
    );
    expect(screen.getByText(/game over/i)).toBeInTheDocument();
    // Alice is rank 1 — her score appears on the podium block.
    expect(screen.getAllByText("2700").length).toBeGreaterThanOrEqual(1);
    // Rank 1 player sees their name on the podium (with "(you)" suffix) and the gold medal.
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText("🥇")).toBeInTheDocument();
  });

  it("shows play again link on podium screen", () => {
    renderPlayerGame();
    act(() =>
      capturedOnMessage!({
        type: "podium",
        payload: {
          entries: [{ player_id: PLAYER_ID, name: "Alice", score: 2700, rank: 1 }],
        },
      }),
    );
    const link = screen.getByRole("link", { name: /play again/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/join");
  });

  // --- Option grid layout ---

  it("renders 4 buttons for a 4-option question", () => {
    renderPlayerGame();
    act(() => capturedOnMessage!(fakeQuestion));
    expect(screen.getAllByRole("button")).toHaveLength(4);
  });

  it("renders 3 buttons (no placeholder button) for a 3-option question", () => {
    renderPlayerGame();
    act(() =>
      capturedOnMessage!({
        type: "question",
        payload: {
          question_index: 0,
          total_questions: 1,
          question: {
            id: "q-3opt",
            text: "Pick one",
            time_limit: 20,
            options: [
              { id: "o-1", text: "A" },
              { id: "o-2", text: "B" },
              { id: "o-3", text: "C" },
            ],
          },
        },
      }),
    );
    // Only 3 interactive buttons — the placeholder is a div, not a button
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.getAllByText("A").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("B").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("C").length).toBeGreaterThanOrEqual(1);
  });

  it("renders 2 buttons for a 2-option question", () => {
    renderPlayerGame();
    act(() =>
      capturedOnMessage!({
        type: "question",
        payload: {
          question_index: 0,
          total_questions: 1,
          question: {
            id: "q-2opt",
            text: "True or false?",
            time_limit: 20,
            options: [
              { id: "o-1", text: "True" },
              { id: "o-2", text: "False" },
            ],
          },
        },
      }),
    );
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByText("True")).toBeInTheDocument();
    expect(screen.getByText("False")).toBeInTheDocument();
  });

  it("fetches player results when podium is shown", async () => {
    const fakeResults: PlayerResults = {
      player_id: PLAYER_ID,
      name: "Alice",
      score: 2700,
      rank: 1,
      questions: [
        {
          question_id: "q-1",
          question_text: "What is 2+2?",
          question_order: 1,
          selected_option_id: "o-2",
          selected_option_text: "4",
          correct_option_id: "o-2",
          correct_option_text: "4",
          is_correct: true,
          points: 900,
        },
        {
          question_id: "q-2",
          question_text: "Capital of France?",
          question_order: 2,
          selected_option_id: "o-3",
          selected_option_text: "Berlin",
          correct_option_id: "o-4",
          correct_option_text: "Paris",
          is_correct: false,
          points: 0,
        },
      ],
    };
    vi.mocked(sessionsApi.getPlayerResults).mockResolvedValue(fakeResults);

    renderPlayerGame();
    act(() =>
      capturedOnMessage!({
        type: "podium",
        payload: {
          entries: [{ player_id: PLAYER_ID, name: "Alice", score: 2700, rank: 1 }],
        },
      }),
    );

    expect(sessionsApi.getPlayerResults).toHaveBeenCalledWith(SESSION_ID, PLAYER_ID);

    // Wait for query to resolve — "See how you scored" button appears once results are ready
    const seeScoreBtn = await screen.findByRole("button", { name: /see how you scored/i });
    fireEvent.click(seeScoreBtn);
    await screen.findByTestId("player-results-breakdown");
    expect(screen.getByText(/What is 2\+2\?/)).toBeInTheDocument();
    expect(screen.getByText(/Capital of France\?/)).toBeInTheDocument();
    expect(screen.getByText("+900")).toBeInTheDocument();
    expect(screen.getByText("Paris")).toBeInTheDocument();
  });
});
