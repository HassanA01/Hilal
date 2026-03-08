import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { HostLobbyPage } from "../pages/HostLobbyPage";

vi.mock("../api/sessions", () => ({
  getSessionByCode: vi.fn().mockResolvedValue({ id: "s1", code: "ABC123", status: "waiting" }),
  listSessionPlayers: vi.fn().mockResolvedValue([]),
  startSession: vi.fn(),
}));

vi.mock("../hooks/useWebSocket", () => ({
  useWebSocket: () => ({}),
}));

vi.mock("../hooks/useLobbyAudio", () => ({
  useLobbyAudio: () => ({ muted: false, toggleMute: vi.fn() }),
}));

function renderLobby(code = "ABC123") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/admin/lobby/${code}`]}>
        <Routes>
          <Route path="/admin/lobby/:code" element={<HostLobbyPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("HostLobbyPage", () => {
  it("renders the room code", () => {
    renderLobby();
    expect(screen.getByText("ABC123")).toBeInTheDocument();
  });

  it("renders the join URL with the session code", () => {
    renderLobby();
    expect(screen.getByText(/\/join\?code=ABC123/)).toBeInTheDocument();
  });

  it("renders a QR code", () => {
    renderLobby();
    const qr = document.querySelector('[data-testid="lobby-qr-code"]');
    expect(qr).toBeInTheDocument();
  });

  it("QR code is an SVG element", () => {
    renderLobby();
    const qr = document.querySelector('[data-testid="lobby-qr-code"]');
    expect(qr?.tagName.toLowerCase()).toBe("svg");
  });
});
