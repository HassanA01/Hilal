import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Admin } from "../types";

interface AuthState {
  token: string | null;
  admin: Admin | null;
  setAuth: (token: string, admin: Admin) => void;
  clearAuth: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      admin: null,
      setAuth: (token, admin) => set({ token, admin }),
      clearAuth: () => set({ token: null, admin: null }),
      isAuthenticated: () => !!get().token,
    }),
    {
      name: "hilal-auth",
      partialize: (state) => ({ token: state.token, admin: state.admin }),
    }
  )
);
