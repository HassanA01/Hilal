import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { GenerateQuizModal } from "../components/GenerateQuizModal";

describe("GenerateQuizModal", () => {
  const defaultProps = {
    onClose: vi.fn(),
    onGenerated: vi.fn(),
  };

  it("renders the modal with form fields", () => {
    render(<GenerateQuizModal {...defaultProps} />);
    expect(screen.getByText("Generate with AI")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/islamic history/i)).toBeInTheDocument();
    expect(screen.getByRole("spinbutton")).toBeInTheDocument();
  });

  it("caps question count input at max 10", () => {
    render(<GenerateQuizModal {...defaultProps} />);
    const input = screen.getByRole("spinbutton");
    expect(input).toHaveAttribute("max", "10");
    expect(input).toHaveAttribute("min", "1");
  });

  it("shows inline error when question count exceeds 10", async () => {
    render(<GenerateQuizModal {...defaultProps} />);
    const input = screen.getByRole("spinbutton");
    await userEvent.clear(input);
    await userEvent.type(input, "15");
    expect(screen.getByText("Maximum 10 questions for AI generation.")).toBeInTheDocument();
  });

  it("does not show inline error when question count is valid", () => {
    render(<GenerateQuizModal {...defaultProps} />);
    expect(screen.queryByText("Maximum 10 questions for AI generation.")).not.toBeInTheDocument();
  });

  it("blocks submit when count exceeds 10", async () => {
    const onGenerated = vi.fn();
    render(<GenerateQuizModal onClose={vi.fn()} onGenerated={onGenerated} />);
    const countInput = screen.getByRole("spinbutton");
    await userEvent.clear(countInput);
    await userEvent.type(countInput, "11");
    const topicInput = screen.getByPlaceholderText(/islamic history/i);
    await userEvent.type(topicInput, "Science");
    fireEvent.submit(screen.getByRole("button", { name: /generate quiz/i }));
    expect(onGenerated).not.toHaveBeenCalled();
  });
});
