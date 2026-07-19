/**
 * Player Repository — Shared Types
 *
 * Central type definitions for the player data repository.
 * All types here are derived from the database schema and
 * represent the application-level view of player data.
 */

// ── Position Types ──────────────────────────────────────────────────────────

export type PositionGroup = "ATT" | "MID" | "DEF" | "GK";
export type PositionOrOther = PositionGroup | "OTHER";

// ── Spider Chart ────────────────────────────────────────────────────────────

export interface SpiderProfile {
  form: number | null;
  impact: number | null;
  threat: number | null;
  bigMoments: number | null;
  reliability: number | null;
  discipline: number | null;
  availableAxes: string[];
  sampleQuality: "none" | "low" | "medium" | "high";
}

// ── Rating ──────────────────────────────────────────────────────────────────

export interface RatingContribution {
  key: string;
  rawValue: number;
  ratingDelta: number;
}

export interface RatingResult {
  rating: number | null;
  performanceScore: number | null;
  version: string;
  availableMetrics: string[];
  contributions: RatingContribution[];
}

// ── Match Stats ─────────────────────────────────────────────────────────────

export interface PlayerMatchRecord {
  fixtureId: string;
  playerId: string;
  teamId: string;
  position: PositionOrOther;
  starter: boolean;
  officialSubstitute: boolean;
  enteredMatch: boolean;
  minuteOn: number | null;
  minuteOff: number | null;
  minutesPlayed: number;
  goals: number | null;
  assists: number | null;
  shots: number | null;
  shotsOnTarget: number | null;
  chancesCreated: number | null;
  tackles: number | null;
  yellowCards: number | null;
  redCards: number | null;
  ownGoals: number | null;
  penaltyAttempts: number | null;
  penaltyGoals: number | null;
  liveRating: number | null;
  finalRating: number | null;
  performanceScore: number | null;
  availableMetrics: string[];
  finalised: boolean;
}

// ── Tournament Summary ──────────────────────────────────────────────────────

export type FormTrend = "rising" | "stable" | "declining" | "insufficient_data";
export type SampleQuality = "none" | "low" | "medium" | "high";

export interface PlayerTournamentSummary {
  playerId: string;
  competitionId: string;
  teamId: string;
  position: PositionOrOther;

  matchesNamed: number;
  appearances: number;
  starts: number;
  substituteAppearances: number;
  totalMinutes: number;

  totalGoals: number | null;
  totalAssists: number | null;
  totalShots: number | null;
  totalShotsOnTarget: number | null;
  totalChancesCreated: number | null;
  totalTackles: number | null;
  totalYellowCards: number | null;
  totalRedCards: number | null;
  totalOwnGoals: number | null;
  totalPenaltyAttempts: number | null;
  totalPenaltyGoals: number | null;

  goalsPer90: number | null;
  assistsPer90: number | null;
  shotsPer90: number | null;
  shotsOnTargetPer90: number | null;
  chancesCreatedPer90: number | null;
  tacklesPer90: number | null;

  minutesWeightedRating: number | null;
  simpleAverageRating: number | null;
  bestRating: number | null;
  worstRating: number | null;
  recentFormRating: number | null;
  consistencyScore: number | null;
  formTrend: FormTrend;

  spider: SpiderProfile;

  positionRank: number | null;
  teamRank: number | null;
  qualifiedForPercentiles: boolean;

  availableMetrics: string[];
  sampleQuality: SampleQuality;
  ratingVersion: string | null;
}

// ── Player Trait ────────────────────────────────────────────────────────────

export type TraitKey =
  | "IN_FORM"
  | "RISING"
  | "CONSISTENT"
  | "NAILED_STARTER"
  | "SUPER_SUB"
  | "IRON_MAN"
  | "GOAL_THREAT"
  | "BIG_GAME_PLAYER"
  | "LATE_HERO"
  | "DISCIPLINE_RISK";

export const TRAIT_LABELS: Record<TraitKey, string> = {
  IN_FORM: "In Form",
  RISING: "Rising",
  CONSISTENT: "Consistent",
  NAILED_STARTER: "Nailed Starter",
  SUPER_SUB: "Super Sub",
  IRON_MAN: "Iron Man",
  GOAL_THREAT: "Goal Threat",
  BIG_GAME_PLAYER: "Big-Game Player",
  LATE_HERO: "Late Hero",
  DISCIPLINE_RISK: "Discipline Risk",
};

export interface PlayerTrait {
  traitKey: TraitKey;
  traitStrength: number;
  evidence: Record<string, unknown>;
  label: string;
}

// ── Player Passport (Full View) ─────────────────────────────────────────────

export interface PlayerIdentity {
  id: string;
  normativeId: string | null;
  preferredName: string | null;
  displayName: string;
  teamId: string;
  position: PositionOrOther;
  primaryPosition: PositionOrOther | null;
  shirtNumber: number | null;
  photoUrl: string | null;
}

export interface PlayerMatchHistoryItem {
  fixtureId: string;
  opponent: string;
  opponentId: string;
  date: string;
  competitionStage: string | null;
  teamScore: number | null;
  opponentScore: number | null;
  starter: boolean;
  enteredMatch: boolean;
  minutesPlayed: number;
  finalRating: number | null;
  goals: number | null;
  assists: number | null;
  yellowCards: number | null;
  redCards: number | null;
  availableStats: string[];
  ratingContributions: RatingContribution[];
}

export interface UserPlayerHistory {
  timesSelected: number;
  completedSelections: number;
  averageRatingWhenSelected: number | null;
  positionComparisonsWon: number;
  supporterPointsGenerated: number;
  bestFixtureId: string | null;
  lastSelectedFixtureId: string | null;
}

export interface PlayerPassportResponse {
  player: PlayerIdentity;
  tournament: PlayerTournamentSummary | null;
  spider: SpiderProfile | null;
  traits: PlayerTrait[];
  matchHistory: PlayerMatchHistoryItem[];
  availableMetrics: string[];
  personalHistory?: UserPlayerHistory;
}

// ── Repository List Response ────────────────────────────────────────────────

export interface PlayerRepositoryListItem {
  player: {
    id: string;
    displayName: string;
    photoUrl: string | null;
    teamId: string;
    position: string;
    name?: string;
    sofascoreId?: number | null;
  };
  matchdayStatus?: {
    starter: boolean;
    officialSubstitute: boolean;
    shirtNumber: number | null;
  };
  tournament: {
    appearances: number;
    starts: number;
    totalMinutes: number;
    tournamentRating: number | null;
    recentFormRating: number | null;
    formTrend: string;
    sampleQuality: string;
    keyStats: Array<{
      key: string;
      label: string;
      value: number | string;
    }>;
  };
  traits: Array<{
    key: string;
    label: string;
  }>;
  personalHistory?: {
    timesSelected: number;
    averageRatingWhenSelected: number | null;
  };
}

// ── Thresholds ──────────────────────────────────────────────────────────────

/** Minimum total minutes for percentile qualification */
export const PERCENTILE_MIN_MINUTES = 90;

/** Sample quality thresholds based on total minutes */
export function sampleQualityFromMinutes(minutes: number): SampleQuality {
  if (minutes <= 0) return "none";
  if (minutes < 90) return "low";
  if (minutes < 270) return "medium";
  return "high";
}

/** Minimum completed appearances for form/trend calculation */
export const FORM_MIN_APPEARANCES = 3;

/** Weights for recent form calculation (latest → oldest) */
export const FORM_WEIGHTS = [0.5, 0.3, 0.2];

// ── Capability Registry ─────────────────────────────────────────────────────

export interface MetricCapability {
  metric: string;
  available: boolean;
  reliable: boolean;
  playerAttributionRate: number;
  fixturePresenceRate: number;
}

export interface CapabilityRegistry {
  generatedAt: string;
  metrics: Record<string, MetricCapability>;
}
