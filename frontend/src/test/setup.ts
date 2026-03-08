import "@testing-library/jest-dom";
import { vi } from "vitest";

// canvas-confetti uses HTMLCanvasElement.getContext() which jsdom doesn't support.
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
