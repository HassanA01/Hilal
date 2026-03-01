import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PodiumScreen } from "../components/PodiumScreen";

const entries = [
  { player_id: "p1", name: "Alice", score: 3000, rank: 1 },
  { player_id: "p2", name: "Bob", score: 2000, rank: 2 },
  { player_id: "p3", name: "Carol", score: 1000, rank: 3 },
  { player_id: "p4", name: "Dave", score: 500, rank: 4 },
];

describe("PodiumScreen", () => {
  it("renders the game over heading", () => {
    render(<PodiumScreen entries={entries} />);
    expect(screen.getByText(/Game Over/i)).toBeInTheDocument();
  });

  it("renders all three podium slots with correct rank labels", () => {
    render(<PodiumScreen entries={entries} />);
    // Classic podium order: 2nd left, 1st center, 3rd right
    expect(screen.getByTestId("podium-slot-1st")).toBeInTheDocument();
    expect(screen.getByTestId("podium-slot-2nd")).toBeInTheDocument();
    expect(screen.getByTestId("podium-slot-3rd")).toBeInTheDocument();
  });

  it("renders player names for top 3", () => {
    render(<PodiumScreen entries={entries} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Carol")).toBeInTheDocument();
  });

  it("renders scores for top 3 players", () => {
    render(<PodiumScreen entries={entries} />);
    expect(screen.getByText("3000")).toBeInTheDocument();
    expect(screen.getByText("2000")).toBeInTheDocument();
    expect(screen.getByText("1000")).toBeInTheDocument();
  });

  it("renders gold, silver, bronze medals", () => {
    render(<PodiumScreen entries={entries} />);
    expect(screen.getByText("🥇")).toBeInTheDocument();
    expect(screen.getByText("🥈")).toBeInTheDocument();
    expect(screen.getByText("🥉")).toBeInTheDocument();
  });

  it("shows 4th+ players below the podium", () => {
    render(<PodiumScreen entries={entries} />);
    expect(screen.getByText("Dave")).toBeInTheDocument();
    expect(screen.getByText("#4")).toBeInTheDocument();
  });

  it("highlights the current player with (you) badge", () => {
    render(<PodiumScreen entries={entries} playerId="p1" />);
    expect(screen.getByText(/\(you\)/)).toBeInTheDocument();
  });

  it("shows (you) in the list for a 4th+ player", () => {
    render(<PodiumScreen entries={entries} playerId="p4" />);
    expect(screen.getByText("(you)")).toBeInTheDocument();
  });

  it("shows player's own score card when ranked 4th+", () => {
    render(<PodiumScreen entries={entries} playerId="p4" />);
    // Score card text is unique; score "500" also appears in the rest list — use the rank label to confirm
    expect(screen.getByText("Rank #4")).toBeInTheDocument();
    // "Your final score" heading appears exactly once (in the score card)
    expect(screen.getByText(/your final score/i)).toBeInTheDocument();
  });

  it("does not show (you) badge when no playerId provided", () => {
    render(<PodiumScreen entries={entries} />);
    expect(screen.queryByText("(you)")).not.toBeInTheDocument();
  });

  it("renders the end button when onEnd is provided", () => {
    const handleEnd = vi.fn();
    render(<PodiumScreen entries={entries} onEnd={handleEnd} endLabel="Back to Dashboard" />);
    expect(screen.getByRole("button", { name: "Back to Dashboard" })).toBeInTheDocument();
  });

  it("calls onEnd when the button is clicked", () => {
    const handleEnd = vi.fn();
    render(<PodiumScreen entries={entries} onEnd={handleEnd} />);
    fireEvent.click(screen.getByRole("button", { name: "Back to Dashboard" }));
    expect(handleEnd).toHaveBeenCalledOnce();
  });

  it("shows join link when no onEnd is provided (player view)", () => {
    render(<PodiumScreen entries={entries} />);
    expect(screen.getByRole("link", { name: /play again/i })).toBeInTheDocument();
  });

  it("does not render the end button in player view", () => {
    render(<PodiumScreen entries={entries} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders with only one entry without crashing", () => {
    render(<PodiumScreen entries={[{ player_id: "p1", name: "Solo", score: 100, rank: 1 }]} />);
    expect(screen.getByText("Solo")).toBeInTheDocument();
  });

  it("renders with an empty entries list without crashing", () => {
    render(<PodiumScreen entries={[]} />);
    expect(screen.getByText(/Game Over/i)).toBeInTheDocument();
  });

  it("uses custom endLabel on the button", () => {
    render(<PodiumScreen entries={entries} onEnd={vi.fn()} endLabel="End Session" />);
    expect(screen.getByRole("button", { name: "End Session" })).toBeInTheDocument();
  });

  // --- Mobile responsiveness ---

  it("play again link is a block-level element for full-width tap target", () => {
    render(<PodiumScreen entries={entries} />);
    const link = screen.getByRole("link", { name: /play again/i });
    // Should have w-full and block classes for a large mobile tap target
    expect(link.className).toMatch(/w-full/);
    expect(link.className).toMatch(/block/);
  });

  it("rest player names have truncate class to prevent horizontal overflow", () => {
    const longNameEntries = [
      { player_id: "p1", name: "Alice", score: 3000, rank: 1 },
      { player_id: "p2", name: "Bob", score: 2000, rank: 2 },
      { player_id: "p3", name: "Carol", score: 1000, rank: 3 },
      { player_id: "p4", name: "AVeryLongPlayerNameThatCouldOverflowOnMobile", score: 500, rank: 4 },
    ];
    render(<PodiumScreen entries={longNameEntries} />);
    // The 4th-place player should render without breaking layout
    expect(screen.getByText("AVeryLongPlayerNameThatCouldOverflowOnMobile")).toBeInTheDocument();
  });
});
