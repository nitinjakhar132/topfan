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
