import { apiClient } from "./client";
import type {
  OverviewStats,
  TimeSeriesPoint,
  QuizStats,
  QuestionStats,
  PlayerStats,
  EngagementData,
} from "../types";

export async function fetchOverview(): Promise<OverviewStats> {
  const { data } = await apiClient.get<OverviewStats>("/analytics/overview");
  return data;
}

export async function fetchGamesOverTime(period: string, range: string): Promise<TimeSeriesPoint[]> {
  const { data } = await apiClient.get<TimeSeriesPoint[]>("/analytics/games-over-time", {
    params: { period, range },
  });
  return data;
}

export async function fetchQuizPerformance(sort: string, order: string): Promise<QuizStats[]> {
  const { data } = await apiClient.get<QuizStats[]>("/analytics/quizzes", {
    params: { sort, order },
  });
  return data;
}

export async function fetchQuizQuestions(quizId: string): Promise<QuestionStats[]> {
  const { data } = await apiClient.get<QuestionStats[]>(`/analytics/quizzes/${quizId}/questions`);
  return data;
}

export async function fetchTopPlayers(sort: string, limit: number): Promise<PlayerStats[]> {
  const { data } = await apiClient.get<PlayerStats[]>("/analytics/players", {
    params: { sort, limit },
  });
  return data;
}

export async function fetchEngagement(): Promise<EngagementData> {
  const { data } = await apiClient.get<EngagementData>("/analytics/engagement");
  return data;
}
