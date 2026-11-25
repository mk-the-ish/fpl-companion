import { FPLPlayer, FPLFixture, FPLPick } from '../types/fpl';

import type { OptimizedSquadOutput, PlayerProjection } from '../types/mlApi';

export type { OptimizedSquadOutput, PlayerProjection } from '../types/mlApi';

/**
 * Monte Carlo Poisson simulator supporting compound Double Gameweeks.
 * If matches == 2, runs two match simulations per trial to model the combined haul density.
 */
function runMonteCarloHaulSim(lambda: number, matchesCount: number, iterations: number = 5000): number {
  if (lambda <= 0 || matchesCount === 0) return 0;

  // Split overall expected lambda across scheduled matches
  const matchLambda = lambda / matchesCount;
  let hauls = 0;

  for (let i = 0; i < iterations; i++) {
    let combinedScore = 0;

    for (let m = 0; m < matchesCount; m++) {
      const L = Math.exp(-matchLambda);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= Math.random();
      } while (p > L);

      combinedScore += (k - 1) * 2.2;
    }

    if (combinedScore >= 10) hauls++;
  }

  return Math.round((hauls / iterations) * 100);
}

/**
 * Computes match-level xP accounting for Blanks (0%), Singles (100%), and Doubles (~180%).
 */
function computePlayerGameweekXP(
  player: FPLPlayer,
  fixtures: FPLFixture[],
  teamsMap: Map<number, string>,
  nextGwId: number
): { xP: number; fixtureCount: number; matchups: { opponentShort: string; isHome: boolean; fdr: number }[] } {
  // Extract all matches for player in target GW
  const matches = fixtures.filter(
    (f) => f.event === nextGwId && (f.team_h === player.team || f.team_a === player.team)
  );

  // --- BLANK GAMEWEEK: Strict 0% weight ---
  if (matches.length === 0) {
    return {
      xP: 0,
      fixtureCount: 0,
      matchups: [{ opponentShort: 'BLANK', isHome: false, fdr: 5 }],
    };
  }

  const statusMult = player.status === 'a' ? 1.0 : player.status === 'd' ? 0.6 : 0.0;
  const xG = parseFloat(player.expected_goals) || 0;
  const xA = parseFloat(player.expected_assists) || 0;
  const form = parseFloat(player.form) || 0;

  let totalXP = 0;
  const matchups: { opponentShort: string; isHome: boolean; fdr: number }[] = [];

  matches.forEach((fix, idx) => {
    const isHome = fix.team_h === player.team;
    const oppId = isHome ? fix.team_a : fix.team_h;
    const fdr = isHome ? fix.team_h_difficulty : fix.team_a_difficulty;
    matchups.push({
      opponentShort: teamsMap.get(oppId) ?? 'TBD',
      isHome,
      fdr,
    });

    const fdrMultiplier = 1 + (3 - fdr) * 0.12;

    let baseMatchXP = 0;
    if (player.element_type === 1 || player.element_type === 2) {
      baseMatchXP = (2.0 + (player.clean_sheets / Math.max(player.total_points, 1)) * 3.5 + form * 0.4) * fdrMultiplier;
    } else {
      baseMatchXP = (2.0 + (xG * 0.75 + xA * 0.5) * 1.8 + form * 0.5) * fdrMultiplier;
    }

    // Match 2 fatigue decay in DGW
    const matchDecay = idx === 0 ? 1.0 : 0.82;
    totalXP += baseMatchXP * matchDecay * (isHome ? 1.08 : 0.95);
  });

  const finalXP = parseFloat((totalXP * statusMult).toFixed(2));
  return { xP: finalXP, fixtureCount: matches.length, matchups };
}

/**
 * Evaluates squad picks using a 0-1 Integer Linear Program with DGW & BGW support.
 */
export function evaluateUserSquad(
  userPicks: FPLPick[],
  allPlayers: FPLPlayer[],
  fixtures: FPLFixture[],
  teamsMap: Map<number, string>,
  nextGwId: number,
  bankBalance: number = 0
): OptimizedSquadOutput {
  const playersById = new Map<number, FPLPlayer>();
  allPlayers.forEach((p) => playersById.set(p.id, p));

  // 1. Project expected points (xP) across blank/single/double matches
  const projections: PlayerProjection[] = userPicks
    .map((pick) => {
      const player = playersById.get(pick.element);
      if (!player) return null;

      const { xP, fixtureCount, matchups } = computePlayerGameweekXP(player, fixtures, teamsMap, nextGwId);
      const haulProb = runMonteCarloHaulSim(xP, fixtureCount);
      const minsExpected = fixtureCount === 0 ? 0 : Math.round((player.minutes > 0 ? 80 : 45) * (fixtureCount === 2 ? 1.7 : 1.0));

      return {
        player,
        xP,
        haulProbability: haulProb,
        fixtureCount,
        matchups,
        minutesExpected: minsExpected,
      };
    })
    .filter((p): p is PlayerProjection => p !== null);

  // 2. Linear Program Roster Partitioning:
  // Maximizes sum(x_i * xP_i) subject to:
  // sum(x_i) = 11, GKP = 1, DEF >= 3, MID >= 2, FWD >= 1
  const gks = projections.filter((p) => p.player.element_type === 1).sort((a, b) => b.xP - a.xP);
  const defs = projections.filter((p) => p.player.element_type === 2).sort((a, b) => b.xP - a.xP);
  const mids = projections.filter((p) => p.player.element_type === 3).sort((a, b) => b.xP - a.xP);
  const fwds = projections.filter((p) => p.player.element_type === 4).sort((a, b) => b.xP - a.xP);

  const starters: PlayerProjection[] = [];
  const outfieldPool: PlayerProjection[] = [];

  // Top GK starts; secondary GK is strictly benched
  starters.push(gks[0]);
  const backupGK = gks[1];

  // Satisfy minimum position boundaries
  starters.push(...defs.slice(0, 3));
  outfieldPool.push(...defs.slice(3));

  starters.push(...mids.slice(0, 2));
  outfieldPool.push(...mids.slice(2));

  starters.push(...fwds.slice(0, 1));
  outfieldPool.push(...fwds.slice(1));

  // Greedy LP fill: remaining 4 spots go strictly to the highest expected points
  // Players with xP = 0 (BGW) will naturally sink to the bottom of outfieldPool
  outfieldPool.sort((a, b) => b.xP - a.xP);
  starters.push(...outfieldPool.slice(0, 4));

  // Remaining outfielders form the priority bench (subs 1 to 3), followed by backup GKP
  const benchOutfield = outfieldPool.slice(4);
  const bench: PlayerProjection[] = [...benchOutfield, backupGK].filter(Boolean);

  // 3. Captaincy Optimization (DGW players with compound haul density prioritized)
  const sortedStarters = [...starters].sort(
    (a, b) => b.xP * 1.5 + b.haulProbability * 0.1 - (a.xP * 1.5 + a.haulProbability * 0.1)
  );
  const captain = sortedStarters[0];
  const viceCaptain = sortedStarters[1];

  // 4. Greedy 1-Transfer Optimization:
  // Identify the player dragging down starting XI or bench (prioritizing BGW players with xP = 0)
  const sellCandidate = [...projections].sort((a, b) => a.xP - b.xP)[0];
  const maxBudget = sellCandidate.player.now_cost + bankBalance;

  const validReplacements = allPlayers
    .filter(
      (p) =>
        p.element_type === sellCandidate.player.element_type &&
        p.now_cost <= maxBudget &&
        (p.status === 'a' || p.status === 'd') &&
        p.id !== sellCandidate.player.id
    )
    .map((p) => {
      const { xP } = computePlayerGameweekXP(p, fixtures, teamsMap, nextGwId);
      return { player: p, xP };
    })
    .sort((a, b) => b.xP - a.xP);

  const bestBuy = validReplacements[0];
  const transferSuggestions =
    bestBuy && bestBuy.xP > sellCandidate.xP
      ? [
          {
            sellCandidate,
            buyCandidate: bestBuy.player,
            deltaXP: parseFloat((bestBuy.xP - sellCandidate.xP).toFixed(2)),
          },
        ]
      : [];

  return {
    starters,
    bench,
    captain,
    viceCaptain,
    transferSuggestions,
  };
}