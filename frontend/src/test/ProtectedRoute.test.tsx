import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, beforeEach } from "vitest";
import { ProtectedRoute } from "../components/ProtectedRoute";
import { useAuthStore } from "../stores/authStore";
import type { Admin } from "../types";

const mockAdmin: Admin = {
  id: "abc-123",
  email: "admin@test.com",
  created_at: new Date().toISOString(),
};

function renderWithRouter(isAuthed: boolean) {
  if (isAuthed) {
    useAuthStore.getState().setAuth("tok123", mockAdmin, false);
  } else {
    useAuthStore.getState().clearAuth();
  }

  return render(
    <MemoryRouter initialEntries={["/admin"]}>
      <Routes>
        <Route path="/login" element={<div>Login Page</div>} />
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <div>Admin Dashboard</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  useAuthStore.getState().clearAuth();
});

describe("ProtectedRoute", () => {
  it("renders children when authenticated", () => {
    renderWithRouter(true);
    expect(screen.getByText("Admin Dashboard")).toBeInTheDocument();
  });

  it("redirects to /login when not authenticated", () => {
    renderWithRouter(false);
    expect(screen.getByText("Login Page")).toBeInTheDocument();
    expect(screen.queryByText("Admin Dashboard")).not.toBeInTheDocument();
  });
});
