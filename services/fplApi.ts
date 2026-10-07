import { FPLBootstrapStaticResponse, FPLLiveGameweekResponse } from '../types/fpl';

const FPL_BASE_URL = 'https://fantasy.premierleague.com/api';

export class FPLApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(`FPL API Error [${statusCode}]: ${message}`);
    this.name = 'FPLApiError';
  }
}

async function fplFetch<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${FPL_BASE_URL}${endpoint}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Mobile; FPLCompanionApp)',
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new FPLApiError(
      response.status,
      `Failed fetching ${endpoint}: ${response.statusText}`
    );
  }

  return response.json();
}

export const fplService = {
  /**
   * Fetches core reference metadata (players, teams, gameweeks, FDR rules).
   * Typically cached for several hours.
   */
  getBootstrapStatic: async (): Promise<FPLBootstrapStaticResponse> => {
    return fplFetch<FPLBootstrapStaticResponse>('/bootstrap-static/');
  },

  /**
   * Fetches real-time stats, BPS, and provisional points for a specific Gameweek.
   * Polled frequently during active match fixtures.
   */
  getLiveGameweek: async (gameweekId: number): Promise<FPLLiveGameweekResponse> => {
    return fplFetch<FPLLiveGameweekResponse>(`/event/${gameweekId}/live/`);
  },
};

// Add to types/fpl.ts:
export interface FPLPick {
  element: number;
  position: number; // 1 to 15
  multiplier: number; // 2 for Captain, 3 for Triple Captain, 0 for benched
  is_captain: boolean;
  is_vice_captain: boolean;
}

export interface FPLPicksResponse {
  active_chip: string | null;
  entry_history: {
    points: number;
    total_points: number;
    rank: number;
    overall_rank: number;
    bank: number;
    value: number;
  };
  picks: FPLPick[];
}

// Add to services/fplApi.ts inside fplService:
getSquadPicks: async (teamId: number, gameweekId: number): Promise<FPLPicksResponse> => {
  return fplFetch<FPLPicksResponse>(`/entry/${teamId}/event/${gameweekId}/picks/`);
},