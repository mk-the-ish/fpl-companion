// --- Bootstrap Static Types ---

export interface FPLGameweek {
  id: number;
  name: string;
  deadline_time: string;
  average_entry_score: number;
  finished: boolean;
  data_checked: boolean;
  highest_scoring_entry: number | null;
  deadline_time_epoch: number;
  deadline_time_game_offset: number;
  highest_score: number | null;
  is_previous: boolean;
  is_current: boolean;
  is_next: boolean;
  cup_leagues_created: boolean;
  h2h_ko_matches_created: boolean;
  chip_plays: { chip_name: string; num_played: number }[];
  most_selected: number | null;
  most_transferred_in: number | null;
  top_element: number | null;
  transfers_made: number;
  most_captained: number | null;
  most_vice_captained: number | null;
}

export interface FPLTeam {
  id: number;
  code: number;
  name: string;
  short_name: string;
  strength: number;
  position: number;
  strength_overall_home: number;
  strength_overall_away: number;
  strength_attack_home: number;
  strength_attack_away: number;
  strength_defence_home: number;
  strength_defence_away: number;
  pulse_id: number;
}

export interface FPLPlayerType {
  id: number; // 1 = GKP, 2 = DEF, 3 = MID, 4 = FWD
  plural_name: string;
  plural_name_short: 'GKP' | 'DEF' | 'MID' | 'FWD';
  singular_name: string;
  singular_name_short: 'GKP' | 'DEF' | 'MID' | 'FWD';
  squad_select: number;
  squad_min_play: number;
  squad_max_play: number;
}

export interface FPLPlayer {
  id: number;
  code: number;
  web_name: string;
  first_name: string;
  second_name: string;
  team: number; // Foreign key -> FPLTeam.id
  team_code: number;
  element_type: number; // Foreign key -> FPLPlayerType.id
  status: 'a' | 'd' | 'i' | 's' | 'u' | 'n'; // Available, Doubtful, Injured, Suspended, Unavailable
  news: string;
  now_cost: number; // Scaled by 10 (e.g. 100 = £10.0m)
  chance_of_playing_next_round: number | null;
  chance_of_playing_this_round: number | null;
  total_points: number;
  event_points: number;
  points_per_game: string;
  selected_by_percent: string;
  form: string;
  value_form: string;
  value_season: string;
  ep_next: string | null;
  ep_this: string | null;
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  goals_conceded: number;
  own_goals: number;
  penalties_saved: number;
  penalties_missed: number;
  yellow_cards: number;
  red_cards: number;
  saves: number;
  bonus: number;
  bps: number;
  influence: string;
  creativity: string;
  threat: string;
  ict_index: string;
  expected_goals: string;
  expected_assists: string;
  expected_goal_involvements: string;
  expected_goals_conceded: string;
}

export interface FPLBootstrapStaticResponse {
  events: FPLGameweek[];
  teams: FPLTeam[];
  elements: FPLPlayer[];
  element_types: FPLPlayerType[];
  total_players: number;
}

// --- Live Gameweek Types ---

export interface FPLLiveStatBreakdown {
  identifier: string; // "goals_scored", "bps", "minutes", etc.
  points: number;
  value: number;
}

export interface FPLLiveExplainItem {
  fixture: number;
  stats: FPLLiveStatBreakdown[];
}

export interface FPLLivePlayerStats {
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  goals_conceded: number;
  own_goals: number;
  penalties_saved: number;
  penalties_missed: number;
  yellow_cards: number;
  red_cards: number;
  saves: number;
  bonus: number;
  bps: number;
  influence: string;
  creativity: string;
  threat: string;
  ict_index: string;
  total_points: number;
  in_dreamteam: boolean;
  expected_goals: string;
  expected_assists: string;
  expected_goal_involvements: string;
  expected_goals_conceded: string;
}

export interface FPLLiveElement {
  id: number; // Matches FPLPlayer.id
  stats: FPLLivePlayerStats;
  explain: FPLLiveExplainItem[];
}

export interface FPLLiveGameweekResponse {
  elements: FPLLiveElement[];
}

export interface FPLPick {
  element: number;
  position: number;
  multiplier: number;
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

export interface FPLFixture {
  id: number;
  event: number | null; // Gameweek ID
  finished: boolean;
  team_h: number; // Home team ID
  team_a: number; // Away team ID
  team_h_difficulty: number; // FDR 1 to 5
  team_a_difficulty: number; // FDR 1 to 5
}

export interface FPLLeagueSummary {
  id: number;
  name: string;
  short_name: string | null;
  created: string;
  closed: boolean;
  rank: number | null;
  max_entries: number | null;
  league_type: string;
  scoring: string;
  admin_entry: number | null;
  start_event: number;
  entry_can_admin: boolean;
  entry_can_invite: boolean;
  entry_can_leave: boolean;
  entry_rank: number;
  entry_last_rank: number;
}

export interface FPLClassicStandingsResult {
  id: number;
  event_total: number;
  player_name: string;
  rank: number;
  last_rank: number;
  rank_sort: number;
  total: number;
  entry: number; // Team ID
  entry_name: string;
}

export interface FPLLeagueStandingsResponse {
  league: FPLLeagueSummary;
  standings: {
    has_next: boolean;
    page: number;
    results: FPLClassicStandingsResult[];
  };
}

export interface FPLEntrySummaryResponse {
  id: number;
  name: string;
  player_first_name: string;
  player_last_name: string;
  summary_overall_points: number;
  summary_overall_rank: number;
  summary_event_points: number;
  summary_event_rank: number;
  current_event: number;
  leagues: {
    classic: FPLLeagueSummary[];
  };
}