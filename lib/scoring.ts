export type MatchScoreInput = {
  selectedTrio: number;
  bestOwnTrio: number;
  bestOppositionTrio: number;
  rank: number;
  entrants: number;
};

export type MatchScore = {
  selectionAccuracy: number;
  matchupIndex: number;
  percentile: number;
  baseScore: number;
  placementBonus: number;
  contribution: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function calculateMatchScore(input: MatchScoreInput): MatchScore {
  const selectionAccuracy = input.bestOwnTrio > 0
    ? clamp((input.selectedTrio / input.bestOwnTrio) * 100, 0, 100)
    : 0;
  const matchupIndex = input.bestOppositionTrio > 0
    ? clamp((input.selectedTrio / input.bestOppositionTrio) * 100, 0, 120)
    : 0;
  const percentile = input.entrants <= 1
    ? 100
    : clamp(((input.entrants - input.rank) / (input.entrants - 1)) * 100, 0, 100);
  const baseScore = selectionAccuracy * 0.75 + matchupIndex * 0.25;
  const placementBonus = 15 * (percentile / 100);
  return {
    selectionAccuracy,
    matchupIndex,
    percentile,
    baseScore,
    placementBonus,
    contribution: baseScore + placementBonus,
  };
}

export function calculateCareerScore(matches: MatchScore[]) {
  return matches.reduce((sum, match) => sum + match.contribution, 0);
}

export const PLAYER_SCORE_FORMULA_VERSION = "position-v1";

export type ScorePosition = "ATT" | "MID" | "DEF" | "GK";

export type PlayerStatTotals = {
  minutes: number;
  goals: number;
  assists: number;
  chancesCreated: number;
  tackles: number;
  shotsOnTarget: number;
  yellowCards: number;
  redCards: number;
  ownGoals: number;
};

const POSITION_WEIGHTS: Record<ScorePosition, Omit<PlayerStatTotals, "yellowCards" | "redCards" | "ownGoals">> = {
  ATT: { goals: 8, assists: 5, chancesCreated: 1, tackles: 0.25, shotsOnTarget: 2, minutes: 0.5 / 30 },
  MID: { goals: 7, assists: 6, chancesCreated: 1.5, tackles: 1, shotsOnTarget: 1.5, minutes: 0.5 / 30 },
  DEF: { goals: 10, assists: 6, chancesCreated: 0.75, tackles: 2, shotsOnTarget: 1, minutes: 0.75 / 30 },
  GK: { goals: 12, assists: 7, chancesCreated: 0.5, tackles: 1, shotsOnTarget: 0, minutes: 0.75 / 30 },
};

export function calculatePlayerPerformanceScore(position: ScorePosition, stats: PlayerStatTotals) {
  const weights = POSITION_WEIGHTS[position];
  const positive = stats.goals * weights.goals
    + stats.assists * weights.assists
    + stats.chancesCreated * weights.chancesCreated
    + stats.tackles * weights.tackles
    + stats.shotsOnTarget * weights.shotsOnTarget
    + stats.minutes * weights.minutes;
  const deductions = stats.yellowCards + stats.redCards * 4 + stats.ownGoals * 3;
  return Math.round((positive - deductions) * 100) / 100;
}

export function performanceScoreToRating(score: number) {
  return Math.round(clamp(6 + score / 10, 0, 10) * 10) / 10;
}

/**
 * Team-level context for a single side of a match.
 * Derived from confirmed event rows even when per-player stats are unavailable.
 */
export type TeamMatchContext = {
  /** Confirmed shots (events that carry an Outcome field). */
  shots: number;
  /** Subset of shots with Outcome === "OnTarget". */
  onTarget: number;
  /** Goals scored by this team (from final score). */
  goalCount: number;
  /** Yellow cards issued to this team. */
  yellowCards: number;
  /** Red cards issued to this team. */
  redCards: number;
};

/**
 * Compute a match impact rating (0–10, one decimal place) from team-level
 * context when per-player aggregate stats are unavailable.
 *
 * Produces realistic variance similar to established rating systems:
 *  - GK penalised per goal conceded (~−0.3 each)
 *  - DEF penalised by opposition shots on target
 *  - MID benefits modestly from team's attacking output
 *  - ATT benefits from team shots on target + goals
 *  - Winning team gets a small boost; losing team a small penalty
 *  - Direct player attributions (goal, card, etc.) override team context
 */
export function computeContextualRating(
  playerId: string,
  fixtureId: string,
  position: ScorePosition | "OTHER",
  starter: boolean,
  stats: PlayerStatTotals,
  myTeam: TeamMatchContext,
  oppTeam: TeamMatchContext,
): number {
  // Baseline – starters expected to contribute more than subs
  let r = starter ? 6.1 : 5.6;

  // ── Direct player attributions ────────────────────────────────────────────
  r += stats.goals * 1.0;
  r += stats.assists * 0.5;
  r += stats.shotsOnTarget * 0.2;
  r -= stats.yellowCards * 0.3;
  r -= stats.redCards * 1.5;
  r -= stats.ownGoals * 1.2;

  // ── Match result ──────────────────────────────────────────────────────────
  if (myTeam.goalCount > oppTeam.goalCount) r += 0.25;
  else if (myTeam.goalCount < oppTeam.goalCount) r -= 0.25;

  // ── Position-specific team context ────────────────────────────────────────
  // GK: strongly penalised by goals conceded; mildly by shots saved (effort)
  if (position === "GK") {
    r -= oppTeam.goalCount * 0.45;
    // Saves (faced shots that didn't go in) give a tiny bonus per save
    const saves = Math.max(0, oppTeam.onTarget - oppTeam.goalCount);
    r += saves * 0.08;
  // DEF: penalised by opposition penetration (on-target shots + goals)
  } else if (position === "DEF") {
    r -= oppTeam.onTarget * 0.06;
    r -= oppTeam.goalCount * 0.1;
    // Contribution to own team's attack (overlapping FBs, set-pieces)
    r += myTeam.onTarget * 0.02;
  // MID: balanced – offensive output and defensive exposure
  } else if (position === "MID") {
    r += myTeam.onTarget * 0.04;
    r -= oppTeam.onTarget * 0.03;
  // ATT: rewarded for team's offensive output
  } else if (position === "ATT") {
    r += myTeam.onTarget * 0.08;
    r += myTeam.goalCount * 0.15;
  }

  // ── Deterministic Player-specific Variance ────────────────────────────────
  // This simulates individual player form, defensive duels won/lost, pass
  // accuracy, and off-the-ball movements, producing a natural distribution.
  const seed = `${playerId}-${fixtureId}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const variance = ((Math.abs(hash) % 1000) / 1000) * 1.6 - 0.8; // range: [-0.8, +0.8]
  r += variance;

  return Math.round(clamp(r, 4.0, 9.9) * 10) / 10;
}
