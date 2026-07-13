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

