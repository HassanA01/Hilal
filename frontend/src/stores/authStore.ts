import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Admin } from "../types";

interface AuthState {
  token: string | null;
  admin: Admin | null;
  isSuperadmin: boolean;
  setAuth: (token: string, admin: Admin, isSuperadmin: boolean) => void;
  clearAuth: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      admin: null,
      isSuperadmin: false,
      setAuth: (token, admin, isSuperadmin) => set({ token, admin, isSuperadmin }),
      clearAuth: () => set({ token: null, admin: null, isSuperadmin: false }),
      isAuthenticated: () => !!get().token,
    }),
    {
      name: "hilal-auth",
      partialize: (state) => ({ token: state.token, admin: state.admin, isSuperadmin: state.isSuperadmin }),
    }
  )
);
