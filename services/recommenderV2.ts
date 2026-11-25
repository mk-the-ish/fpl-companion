import { FPLPlayer, FPLFixture } from '../types/fpl';

import type { PositionRecommendation, UpcomingMatch } from '../types/mlApi';

export type { PositionRecommendation, UpcomingMatch } from '../types/mlApi';

/**
 * Calculates decayed points expectation across arbitrary fixture configurations
 * (BGW: 0 fixtures, SGW: 1 fixture, DGW: 2 fixtures).
 */
export function generateMultiGameweekPicks(
  players: FPLPlayer[],
  fixtures: FPLFixture[],
  teamsMap: Map<number, string>,
  startGwId: number,
  elementType: number
): PositionRecommendation[] {
  const targetGameweeks = [startGwId, startGwId + 1, startGwId + 2, startGwId + 3];

  return players
    .filter((p) => p.element_type === elementType && (p.status === 'a' || p.status === 'd'))
    .map((player) => {
      const upcomingMatches: UpcomingMatch[] = [];
      let totalFDR = 0;
      let weightedRunScore = 0;
      let totalFixturesCount = 0;

      targetGameweeks.forEach((gwId, index) => {
        // Find ALL fixtures for player's team in this gameweek (0 = Blank, 1 = Single, 2 = Double)
        const teamMatches = fixtures.filter(
          (f) => f.event === gwId && (f.team_h === player.team || f.team_a === player.team)
        );

        const gwWeight = 1 / Math.sqrt(index + 1); // Hyperbolic time-decay

        if (teamMatches.length === 0) {
          // --- BLANK GAMEWEEK (0% Weight) ---
          upcomingMatches.push({
            gameweek: gwId,
            opponentShort: 'BLANK',
            isHome: false,
            fdr: 5,
            isBlank: true,
          });
          // Blanket penalty for blanks in the run
          weightedRunScore -= 1.5 * gwWeight;
        } else {
          // --- SINGLE OR DOUBLE GAMEWEEK ---
          teamMatches.forEach((fix, matchIdx) => {
            totalFixturesCount++;
            const isHome = fix.team_h === player.team;
            const oppId = isHome ? fix.team_a : fix.team_h;
            const fdr = isHome ? fix.team_h_difficulty : fix.team_a_difficulty;
            const oppShort = teamsMap.get(oppId) ?? 'TBD';

            upcomingMatches.push({
              gameweek: gwId,
              opponentShort: oppShort,
              isHome,
              fdr,
              isDouble: teamMatches.length > 1,
            });

            totalFDR += fdr;

            // In DGWs, apply rotation/fatigue discount to 2nd match (~0.8x yield)
            const fatigueScalar = matchIdx === 0 ? 1.0 : 0.82;
            const ease = 5 - fdr + (isHome ? 0.75 : 0);

            weightedRunScore += ease * fatigueScalar * gwWeight;
          });
        }
      });

      const avgFDR = totalFixturesCount > 0 ? totalFDR / totalFixturesCount : 5;

      // Underlying per-90 metrics
      const mins = Math.max(player.minutes, 1);
      const nineties = mins / 90;
      const xG = parseFloat(player.expected_goals) || 0;
      const xA = parseFloat(player.expected_assists) || 0;
      const xGC = parseFloat(player.expected_goals_conceded) || 0;
      const form = parseFloat(player.form) || 0;

      let baselineMetric = 0;
      let modelScore = 0;

      if (elementType === 1 || elementType === 2) {
        // Defensive Assets (Clean Sheet / xGC focus)
        const xGC90 = xGC / nineties;
        const csRate = player.clean_sheets / nineties;
        baselineMetric = Math.max(0, 2.5 - xGC90) + csRate * 2;

        const fixtureFactor = Math.max(0, weightedRunScore * 5.2);
        const defensiveForm = Math.min(form * 3.5, 25);
        const underlyingDef = Math.min(baselineMetric * 10, 25);

        modelScore = fixtureFactor + defensiveForm + underlyingDef;
      } else {
        // Attacking Assets (xGI / Goal Involvement focus)
        const xGI90 = (xG + xA) / nineties;
        baselineMetric = xGI90;

        const fixtureFactor = Math.max(0, weightedRunScore * 4.5);
        const attackingForm = Math.min(form * 3.5, 25);
        const underlyingAtt = Math.min(xGI90 * 35, 35);

        modelScore = fixtureFactor + attackingForm + underlyingAtt;
      }

      return {
        player,
        projectedScore: Math.min(Math.round(modelScore), 100),
        avgFDR: parseFloat(avgFDR.toFixed(1)),
        upcomingMatches,
        per90Metric: parseFloat(baselineMetric.toFixed(2)),
        fixtureCount: totalFixturesCount,
      };
    })
    .sort((a, b) => b.projectedScore - a.projectedScore);
}