export interface Admin {
  id: string;
  email: string;
  created_at: string;
}

export type QuestionType = "multiple_choice" | "multi_select" | "true_false" | "image_choice" | "ordering";

export interface Option {
  id: string;
  question_id: string;
  text: string;
  is_correct?: boolean; // only visible to host
  image_url?: string;
  sort_order?: number;
}

export interface Question {
  id: string;
  quiz_id: string;
  text: string;
  type: QuestionType;
  time_limit: number;
  order: number;
  image_url?: string;
  options: Option[];
}

export interface Quiz {
  id: string;
  admin_id: string;
  title: string;
  created_at: string;
  questions?: Question[];
}

export type GameStatus = "waiting" | "active" | "finished";

export interface GameSession {
  id: string;
  quiz_id: string;
  code: string;
  status: GameStatus;
  started_at?: string;
  ended_at?: string;
  created_at: string;
}

export interface SessionSummary {
  id: string;
  quiz_id: string;
  quiz_title: string;
  code: string;
  status: GameStatus;
  player_count: number;
  started_at?: string;
  ended_at?: string;
  created_at: string;
}

export interface GamePlayer {
  id: string;
  session_id: string;
  name: string;
  score: number;
  joined_at: string;
}

export interface LeaderboardEntry {
  player_id: string;
  name: string;
  score: number;
  rank: number;
}

// WebSocket message types (mirrored from backend)
export type MessageType =
  | "player_joined"
  | "player_left"
  | "game_started"
  | "question"
  | "answer_submitted"
  | "answer_reveal"
  | "leaderboard"
  | "next_question"
  | "game_over"
  | "podium"
  | "error"
  | "ping"
  | "answer_count"
  | "player_kicked"
  | "kick_player";

export interface WsMessage<T = unknown> {
  type: MessageType;
  payload: T;
}

export interface QuestionPayload {
  question_index: number;
  total_questions: number;
  question: {
    id: string;
    text: string;
    type: QuestionType;
    time_limit: number;
    image_url?: string;
    options: Array<{ id: string; text: string; image_url?: string }>;
  };
}

export interface RevealScoreEntry {
  is_correct: boolean;
  points: number;
  total_score: number;
}

export interface AnswerRevealPayload {
  correct_option_id?: string;
  correct_option_ids?: string[];
  correct_order?: string[];
  scores: Record<string, RevealScoreEntry>;
}

export interface PodiumEntry {
  player_id: string;
  name: string;
  score: number;
  rank: number;
}

export interface PlayerResultQuestion {
  question_id: string;
  question_text: string;
  question_type?: QuestionType;
  question_order: number;
  selected_option_id: string;
  selected_option_text: string;
  correct_option_id: string;
  correct_option_text: string;
  correct_option_ids?: string[];
  correct_option_texts?: string[];
  answer_data?: string[];
  is_correct: boolean;
  points: number;
}

export interface PlayerResults {
  player_id: string;
  name: string;
  score: number;
  rank: number;
  questions: PlayerResultQuestion[];
}

// Analytics types
export interface OverviewStats {
  total_quizzes: number;
  total_games: number;
  total_players: number;
  total_answers: number;
  avg_players_per_game: number;
  avg_score: number;
}

export interface TimeSeriesPoint {
  date: string;
  games: number;
  players: number;
}

export interface QuizStats {
  id: string;
  title: string;
  plays: number;
  avg_score: number;
  player_count: number;
  question_count: number;
  created_at: string;
}

export interface OptionDistribution {
  text: string;
  count: number;
  pct: number;
}

export interface QuestionStats {
  id: string;
  text: string;
  type: string;
  order: number;
  correct_pct: number;
  avg_points: number;
  total_answers: number;
  options: OptionDistribution[];
}

export interface PlayerStats {
  name: string;
  total_score: number;
  games_played: number;
  avg_score: number;
  avg_speed_ms: number;
}

export interface PeakHourBucket {
  day_of_week: number;
  hour: number;
  count: number;
}

export interface EngagementData {
  peak_hours: PeakHourBucket[];
  avg_game_duration_seconds: number;
}

// Platform metrics types (superadmin only)
export interface PlatformOverview {
  total_admins: number;
  total_quizzes: number;
  total_games: number;
  total_players: number;
  total_answers: number;
  avg_players_per_game: number;
  avg_game_duration_seconds: number;
  avg_questions_per_quiz: number;
  game_completion_rate: number;
  games_this_week: number;
  games_last_week: number;
  games_wow_change: number;
  players_this_week: number;
  players_last_week: number;
  players_wow_change: number;
}

export interface FunnelStage {
  label: string;
  count: number;
  pct: number;
}

export interface DistributionBucket {
  label: string;
  count: number;
}

export interface PlatformKPIs {
  funnel: FunnelStage[];
  player_count_distribution: DistributionBucket[];
  admin_retention_7d: number;
  admin_retention_30d: number;
}

export interface PlatformGrowthPoint {
  date: string;
  admins: number;
  quizzes: number;
  games: number;
}

export interface PlatformAdminStats {
  id: string;
  email: string;
  quiz_count: number;
  game_count: number;
  player_count: number;
  last_active: string | null;
  created_at: string;
}

export interface PlatformAIStats {
  total_quizzes: number;
}

export interface PlatformEngagement {
  peak_hours: PeakHourBucket[];
  avg_game_duration_seconds: number;
  total_active_days: number;
}
