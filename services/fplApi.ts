import {
  FPLBootstrapStaticResponse,
  FPLLiveGameweekResponse,
  FPLPicksResponse,
  FPLFixture,
} from '../types/fpl';

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
   */
  getBootstrapStatic: async (): Promise<FPLBootstrapStaticResponse> => {
    return fplFetch<FPLBootstrapStaticResponse>('/bootstrap-static/');
  },

  /**
   * Fetches real-time stats, BPS, and provisional points for a specific Gameweek.
   */
  getLiveGameweek: async (gameweekId: number): Promise<FPLLiveGameweekResponse> => {
    return fplFetch<FPLLiveGameweekResponse>(`/event/${gameweekId}/live/`);
  },

  /**
   * Fetches the entire season fixture list with Fixture Difficulty Ratings (FDR).
   */
  getFixtures: async (): Promise<FPLFixture[]> => {
    return fplFetch<FPLFixture[]>('/fixtures/');
  },

  /**
   * Fetches the squad picks for a specific manager entry and gameweek.
   */
  getSquadPicks: async (teamId: number, gameweekId: number): Promise<FPLPicksResponse> => {
    return fplFetch<FPLPicksResponse>(`/entry/${teamId}/event/${gameweekId}/picks/`);
  },
};