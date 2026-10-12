import { FPLPlayer, FPLFixture } from '../types/fpl';

export interface UpcomingMatch {
  gameweek: number;
  opponentShort: string;
  isHome: boolean;
  fdr: number;
}

export interface PositionRecommendation {
  player: FPLPlayer;
  projectedScore: number; // 0 - 100
  avgFDR: number;
  upcomingMatches: UpcomingMatch[];
  per90Metric: number; // xGI90 for Att/Mid, CS+Save baseline for Def/Gk
}

export function generateMultiGameweekPicks(
  players: FPLPlayer[],
  fixtures: FPLFixture[],
  teamsMap: Map<number, string>,
  startGwId: number,
  elementType: number // 1: GKP, 2: DEF, 3: MID, 4: FWD
): PositionRecommendation[] {
  const targetGameweeks = [startGwId, startGwId + 1, startGwId + 2, startGwId + 3];

  return players
    .filter((p) => p.element_type === elementType && (p.status === 'a' || p.status === 'd'))
    .map((player) => {
      // 1. Gather fixtures across the 4-Gameweek horizon
      const upcomingMatches: UpcomingMatch[] = [];
      let totalFDR = 0;
      let weightedRunScore = 0;

      targetGameweeks.forEach((gwId, index) => {
        const gwFixtures = fixtures.filter((f) => f.event === gwId);
        const fix = gwFixtures.find((f) => f.team_h === player.team || f.team_a === player.team);

        if (fix) {
          const isHome = fix.team_h === player.team;
          const oppId = isHome ? fix.team_a : fix.team_h;
          const fdr = isHome ? fix.team_h_difficulty : fix.team_a_difficulty;
          const oppShort = teamsMap.get(oppId) ?? 'TBD';

          upcomingMatches.push({ gameweek: gwId, opponentShort: oppShort, isHome, fdr });
          totalFDR += fdr;

          // Time-decay weighting: Near games matter more
          const weight = 1 / Math.sqrt(index + 1);
          const ease = 5 - fdr; // FDR 1 => 4 pts, FDR 5 => 0 pts
          weightedRunScore += (ease + (isHome ? 0.75 : 0)) * weight;
        } else {
          // Blank gameweek penalty
          totalFDR += 4;
        }
      });

      const avgFDR = upcomingMatches.length ? totalFDR / upcomingMatches.length : 3;

      // 2. Compute underlying per-90 baselines
      const mins = Math.max(player.minutes, 1);
      const nineties = mins / 90;
      const xG = parseFloat(player.expected_goals) || 0;
      const xA = parseFloat(player.expected_assists) || 0;
      const xGC = parseFloat(player.expected_goals_conceded) || 0;
      const form = parseFloat(player.form) || 0;

      let baselineMetric = 0;
      let modelScore = 0;

      if (elementType === 1 || elementType === 2) {
        // DEFENDERS & GOALKEEPERS: Emphasize xGC resilience, Clean Sheets, and Form
        const xGC90 = xGC / nineties;
        const csRate = player.clean_sheets / nineties;
        baselineMetric = Math.max(0, 2.5 - xGC90) + csRate * 2;

        const fixtureFactor = Math.min(weightedRunScore * 5.5, 45); // up to 45 pts
        const defensiveForm = Math.min(form * 4, 30); // up to 30 pts
        const underlyingDef = Math.min(baselineMetric * 10, 25); // up to 25 pts

        modelScore = fixtureFactor + defensiveForm + underlyingDef;
      } else {
        // MIDFIELDERS & FORWARDS: Emphasize xGI90, Goal Involvement, and Form
        const xGI90 = (xG + xA) / nineties;
        baselineMetric = xGI90;

        const fixtureFactor = Math.min(weightedRunScore * 4.5, 35); // up to 35 pts
        const attackingForm = Math.min(form * 4, 30); // up to 30 pts
        const underlyingAtt = Math.min(xGI90 * 35, 35); // up to 35 pts

        modelScore = fixtureFactor + attackingForm + underlyingAtt;
      }

      return {
        player,
        projectedScore: Math.min(Math.round(modelScore), 100),
        avgFDR: parseFloat(avgFDR.toFixed(1)),
        upcomingMatches,
        per90Metric: parseFloat(baselineMetric.toFixed(2)),
      };
    })
    .sort((a, b) => b.projectedScore - a.projectedScore);
}