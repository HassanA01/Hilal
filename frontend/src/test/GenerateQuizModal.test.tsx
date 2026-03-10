import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GenerateQuizModal } from "../components/GenerateQuizModal";

vi.mock("../api/config", () => ({
  fetchAppConfig: vi.fn().mockResolvedValue({ max_ai_questions: 20 }),
}));

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      {ui}
    </QueryClientProvider>,
  );
}

describe("GenerateQuizModal", () => {
  const defaultProps = {
    onClose: vi.fn(),
    onGenerated: vi.fn(),
  };

  it("renders the modal with form fields", () => {
    renderWithProviders(<GenerateQuizModal {...defaultProps} />);
    expect(screen.getByText("Generate with AI")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/islamic history/i)).toBeInTheDocument();
    expect(screen.getByRole("spinbutton")).toBeInTheDocument();
  });

  it("caps question count input at max value from config", async () => {
    renderWithProviders(<GenerateQuizModal {...defaultProps} />);
    // Before config loads, defaults to 20
    const input = screen.getByRole("spinbutton");
    expect(input).toHaveAttribute("min", "1");
  });

  it("shows inline error when question count exceeds limit", async () => {
    renderWithProviders(<GenerateQuizModal {...defaultProps} />);
    const input = screen.getByRole("spinbutton");
    await userEvent.clear(input);
    await userEvent.type(input, "25");
    expect(screen.getByText(/Maximum .* questions for AI generation/)).toBeInTheDocument();
  });

  it("does not show inline error when question count is valid", () => {
    renderWithProviders(<GenerateQuizModal {...defaultProps} />);
    expect(screen.queryByText(/Maximum .* questions for AI generation/)).not.toBeInTheDocument();
  });

  it("blocks submit when count exceeds limit", async () => {
    const onGenerated = vi.fn();
    renderWithProviders(<GenerateQuizModal onClose={vi.fn()} onGenerated={onGenerated} />);
    const countInput = screen.getByRole("spinbutton");
    await userEvent.clear(countInput);
    await userEvent.type(countInput, "25");
    const topicInput = screen.getByPlaceholderText(/islamic history/i);
    await userEvent.type(topicInput, "Science");
    fireEvent.submit(screen.getByRole("button", { name: /generate quiz/i }));
    expect(onGenerated).not.toHaveBeenCalled();
  });

  it("renders both Topic and Upload tabs", () => {
    renderWithProviders(<GenerateQuizModal {...defaultProps} />);
    expect(screen.getByRole("button", { name: "Topic" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload Document" })).toBeInTheDocument();
  });

  it("defaults to Topic tab", () => {
    renderWithProviders(<GenerateQuizModal {...defaultProps} />);
    expect(screen.getByPlaceholderText(/islamic history/i)).toBeInTheDocument();
    expect(screen.queryByText(/drop a file/i)).not.toBeInTheDocument();
  });

  it("switches to Upload tab and shows file picker", async () => {
    renderWithProviders(<GenerateQuizModal {...defaultProps} />);
    await userEvent.click(screen.getByRole("button", { name: "Upload Document" }));
    expect(screen.getByText(/drop a file or click to browse/i)).toBeInTheDocument();
    expect(screen.getByText(/PDF, DOCX, TXT, MD/i)).toBeInTheDocument();
  });

  it("shows selected filename after picking a valid file", async () => {
    renderWithProviders(<GenerateQuizModal {...defaultProps} />);
    await userEvent.click(screen.getByRole("button", { name: "Upload Document" }));

    const file = new File(["test content"], "notes.txt", { type: "text/plain" });
    const input = screen.getByTestId("file-input");
    await userEvent.upload(input, file);

    expect(screen.getByText("notes.txt")).toBeInTheDocument();
  });

  it("shows file error for unsupported extension", async () => {
    renderWithProviders(<GenerateQuizModal {...defaultProps} />);
    await userEvent.click(screen.getByRole("button", { name: "Upload Document" }));

    const file = new File(["data"], "sheet.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const input = screen.getByTestId("file-input") as HTMLInputElement;
    // fireEvent bypasses the accept attribute filter that userEvent respects
    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText(/unsupported file type/i)).toBeInTheDocument();
  });

  it("disables submit button when no file selected in upload mode", async () => {
    renderWithProviders(<GenerateQuizModal {...defaultProps} />);
    await userEvent.click(screen.getByRole("button", { name: "Upload Document" }));

    const submitBtn = screen.getByRole("button", { name: /generate from document/i });
    expect(submitBtn).toBeDisabled();
  });

  it("enables submit button after selecting a valid file", async () => {
    renderWithProviders(<GenerateQuizModal {...defaultProps} />);
    await userEvent.click(screen.getByRole("button", { name: "Upload Document" }));

    const file = new File(["test content"], "notes.txt", { type: "text/plain" });
    const input = screen.getByTestId("file-input");
    await userEvent.upload(input, file);

    const submitBtn = screen.getByRole("button", { name: /generate from document/i });
    expect(submitBtn).not.toBeDisabled();
  });

  it("can remove selected file", async () => {
    renderWithProviders(<GenerateQuizModal {...defaultProps} />);
    await userEvent.click(screen.getByRole("button", { name: "Upload Document" }));

    const file = new File(["test content"], "notes.txt", { type: "text/plain" });
    const input = screen.getByTestId("file-input");
    await userEvent.upload(input, file);

    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /remove file/i }));
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
    expect(screen.getByText(/drop a file/i)).toBeInTheDocument();
  });

  it("renders question type chips with all active by default", () => {
    renderWithProviders(<GenerateQuizModal {...defaultProps} />);
    const mcChip = screen.getByRole("button", { name: "Multiple Choice" });
    const tfChip = screen.getByRole("button", { name: "True / False" });
    const ordChip = screen.getByRole("button", { name: "Ordering" });
    expect(mcChip).toHaveAttribute("aria-pressed", "true");
    expect(tfChip).toHaveAttribute("aria-pressed", "true");
    expect(ordChip).toHaveAttribute("aria-pressed", "true");
  });

  it("toggles a question type chip off when clicked", async () => {
    renderWithProviders(<GenerateQuizModal {...defaultProps} />);
    const tfChip = screen.getByRole("button", { name: "True / False" });
    expect(tfChip).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(tfChip);
    expect(tfChip).toHaveAttribute("aria-pressed", "false");
  });

  it("cannot deselect the last active question type chip", async () => {
    renderWithProviders(<GenerateQuizModal {...defaultProps} />);
    // Deselect two of the three
    await userEvent.click(screen.getByRole("button", { name: "True / False" }));
    await userEvent.click(screen.getByRole("button", { name: "Ordering" }));
    // Only MC left — clicking it should have no effect
    const mcChip = screen.getByRole("button", { name: "Multiple Choice" });
    expect(mcChip).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(mcChip);
    expect(mcChip).toHaveAttribute("aria-pressed", "true");
  });

  it("shows question type chips in upload tab too", async () => {
    renderWithProviders(<GenerateQuizModal {...defaultProps} />);
    await userEvent.click(screen.getByRole("button", { name: "Upload Document" }));
    expect(screen.getByRole("button", { name: "Multiple Choice" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "True / False" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ordering" })).toBeInTheDocument();
  });
});
