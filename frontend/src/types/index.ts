export interface Admin {
  id: string;
  email: string;
  created_at: string;
}

export type QuestionType = "multiple_choice" | "true_false" | "image_choice" | "ordering";

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
  | "answer_count";

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
  question_order: number;
  selected_option_id: string;
  selected_option_text: string;
  correct_option_id: string;
  correct_option_text: string;
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
