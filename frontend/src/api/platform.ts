import { apiClient } from "./client";
import type {
  PlatformOverview,
  PlatformGrowthPoint,
  PlatformAdminStats,
  PlatformAIStats,
  PlatformEngagement,
  PlatformKPIs,
} from "../types";

export async function fetchPlatformOverview(): Promise<PlatformOverview> {
  const { data } = await apiClient.get<PlatformOverview>("/platform/overview");
  return data;
}

export async function fetchPlatformGrowth(
  period: string,
  range: string,
): Promise<PlatformGrowthPoint[]> {
  const { data } = await apiClient.get<PlatformGrowthPoint[]>(
    "/platform/growth",
    { params: { period, range } },
  );
  return data;
}

export async function fetchPlatformAdmins(
  sort: string,
  order: string,
): Promise<PlatformAdminStats[]> {
  const { data } = await apiClient.get<PlatformAdminStats[]>(
    "/platform/admins",
    { params: { sort, order } },
  );
  return data;
}

export async function fetchPlatformAIStats(): Promise<PlatformAIStats> {
  const { data } = await apiClient.get<PlatformAIStats>("/platform/ai-stats");
  return data;
}

export async function fetchPlatformEngagement(): Promise<PlatformEngagement> {
  const { data } = await apiClient.get<PlatformEngagement>(
    "/platform/engagement",
  );
  return data;
}

export async function fetchPlatformKPIs(): Promise<PlatformKPIs> {
  const { data } = await apiClient.get<PlatformKPIs>("/platform/kpis");
  return data;
}
