import { apiClient } from "./client";
import type { Admin } from "../types";

export interface AuthResponse {
  token: string;
  admin: Admin;
  is_superadmin: boolean;
}

export async function register(email: string, password: string): Promise<AuthResponse> {
  const { data } = await apiClient.post<AuthResponse>("/auth/register", { email, password });
  return data;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const { data } = await apiClient.post<AuthResponse>("/auth/login", { email, password });
  return data;
}
