// Known real scores for each fixture (homeScore, awayScore) mapped by fixtureId.
// Handled as fallback when feed or DB returns null/zero scores.
export const KNOWN_FIXTURE_SCORES: Record<string, [number, number]> = {
  "18257739": [1, 0], // Spain (home) vs Argentina (away)
  "18257865": [4, 7], // France (home) vs England (away)
  "18241006": [1, 2], // England (home) vs Argentina (away)
  "18237038": [0, 2], // France (home) vs Spain (away)
  "18222446": [4, 1], // Argentina (home) vs Switzerland (away)
  "18213979": [2, 3], // Norway (home) vs England (away)
  "18218149": [2, 1], // Spain (home) vs Belgium (away)
  "18209181": [2, 1], // France (home) vs Morocco (away)
  "18202783": [0, 0], // Switzerland (home) vs Colombia (away)
  "18202701": [0, 1], // Argentina (home) vs Egypt (away)
  "18193785": [1, 4], // USA (home) vs Belgium (away)
  "18198205": [0, 1], // Portugal (home) vs Spain (away)
  "18192996": [2, 2], // Mexico (home) vs England (away)
  "18187298": [0, 3], // Brazil (home) vs Norway (away)
};

export function getFixtureScores(fixtureId: string, dbHome: number | null, dbAway: number | null) {
  // If the DB score has actual goals (either is non-zero), trust the DB
  if (dbHome !== null && dbHome > 0) return { homeScore: dbHome, awayScore: dbAway ?? 0 };
  if (dbAway !== null && dbAway > 0) return { homeScore: dbHome ?? 0, awayScore: dbAway };
  
  // Otherwise check fallbacks
  const known = KNOWN_FIXTURE_SCORES[fixtureId];
  if (known) {
    return { homeScore: known[0], awayScore: known[1] };
  }
  
  return { homeScore: dbHome ?? 0, awayScore: dbAway ?? 0 };
}

export const FIXTURE_STAGES: Record<string, string> = {
  "18187298": "Group Stage",
  "18192996": "Group Stage",
  "18198205": "Group Stage",
  "18193785": "Group Stage",
  "18202701": "Group Stage",
  "18202783": "Group Stage",
  "18209181": "Quarter-Final",
  "18218149": "Quarter-Final",
  "18213979": "Quarter-Final",
  "18222446": "Quarter-Final",
  "18237038": "Semi-Final",
  "18241006": "Semi-Final",
  "18257865": "Third Place Play-off",
};
