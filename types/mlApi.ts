import type { FPLPlayer } from './fpl';

export interface PlayerProjection {
  player: FPLPlayer;
  xP: number;
  matchXP?: number[];
  haulProbability: number;
  fixtureCount: number;
  matchups: {
    opponentShort: string;
    isHome: boolean;
    fdr: number;
  }[];
  minutesExpected: number;
}

export interface OptimizedSquadOutput {
  starters: PlayerProjection[];
  bench: PlayerProjection[];
  captain: PlayerProjection;
  viceCaptain: PlayerProjection;
  transferSuggestions: {
    sellCandidate: PlayerProjection;
    buyCandidate: FPLPlayer;
    deltaXP: number;
  }[];
}

export interface UpcomingMatch {
  gameweek: number;
  opponentShort: string;
  isHome: boolean;
  fdr: number;
  isDouble?: boolean;
  isBlank?: boolean;
}

export interface PositionRecommendation {
  player: FPLPlayer;
  projectedScore: number;
  avgFDR: number;
  upcomingMatches: UpcomingMatch[];
  per90Metric: number;
  fixtureCount: number;
  projectedXP?: number | null;
}

export interface OptimizeSquadRequest {
  team_id: number;
  gameweek: number;
  free_transfers: number;
}

export interface RetrainRequest {
  completed_gameweek?: number;
}

export interface RetrainResponse {
  status: 'ready';
  model_version: string;
  trained_at: string;
  training_sample_count: number;
  metrics: Record<string, { sample_count: number; validation_mae: number }>;
}

export interface RecommendationsQuery {
  start_gw: number;
  position: 1 | 2 | 3 | 4;
}

export interface HealthResponse {
  status: 'ok';
  service: string;
  api_version: string;
}

export interface ModelStatusResponse {
  status: 'ready' | 'untrained' | 'loading';
  model_version: string | null;
}

export type ApiErrorCode =
  | 'validation_error'
  | 'not_found'
  | 'upstream_error'
  | 'model_unavailable'
  | 'optimization_failed'
  | 'internal_error';

export interface ApiFieldError {
  field: string;
  message: string;
}

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: ApiFieldError[];
    request_id: string;
  };
}
