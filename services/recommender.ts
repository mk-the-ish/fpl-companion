import { FPLPlayer, FPLFixture } from '../types/fpl';

export interface ScoredCandidate {
  player: FPLPlayer;
  score: number;
  fdr: number;
  isHome: boolean;
  opponentShortName: string;
}

export function calculateCaptaincyPicks(
  candidates: FPLPlayer[],
  fixtures: FPLFixture[],
  teamsMap: Map<number, string>,
  nextGwId: number
): ScoredCandidate[] {
  // Filter fixtures for next round
  const nextFixtures = fixtures.filter((f) => f.event === nextGwId);

  return candidates
    .filter((p) => p.status === 'a' || p.status === 'd') // Ignore red-flagged/injured
    .map((player) => {
      // Find upcoming fixture
      const fixture = nextFixtures.find(
        (f) => f.team_h === player.team || f.team_a === player.team
      );

      const isHome = fixture ? fixture.team_h === player.team : false;
      const opponentId = fixture
        ? isHome
          ? fixture.team_a
          : fixture.team_h
        : null;

      // FDR: 1 (easy) to 5 (very tough)
      const fdr = fixture
        ? isHome
          ? fixture.team_h_difficulty
          : fixture.team_a_difficulty
        : 3;

      const opponentShortName = opponentId
        ? teamsMap.get(opponentId) ?? 'TBD'
        : 'TBD';

      // Parse numerical stats
      const form = parseFloat(player.form) || 0;
      const xG = parseFloat(player.expected_goals) || 0;
      const xA = parseFloat(player.expected_assists) || 0;
      const xGI = xG + xA;

      // Heuristic Scoring Weights:
      // - Recent Form: up to 35 pts
      // - xGI production: up to 30 pts
      // - FDR ease: up to 25 pts (lower FDR gives more pts)
      // - Home advantage: 10 pts bonus
      const formScore = Math.min(form * 4, 35);
      const xgiScore = Math.min((xGI / Math.max(player.minutes / 90, 1)) * 30, 30);
      const fdrScore = (5 - fdr) * 6.25; // 1 -> 25pts, 5 -> 0pts
      const venueBonus = isHome ? 10 : 0;

      const totalScore = Math.round(formScore + xgiScore + fdrScore + venueBonus);

      return {
        player,
        score: Math.min(totalScore, 100),
        fdr,
        isHome,
        opponentShortName,
      };
    })
    .sort((a, b) => b.score - a.score);
}