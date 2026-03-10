import { apiClient } from "./client";

export interface AppConfig {
  max_ai_questions: number;
}

export async function fetchAppConfig(): Promise<AppConfig> {
  const { data } = await apiClient.get<AppConfig>("/config");
  return data;
}
