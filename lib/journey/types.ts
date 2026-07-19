/**
 * ONE NATION — Supporter Journey Types
 *
 * TypeScript interfaces for the journey system that organise
 * individual match performances into a longitudinal team narrative.
 */

// ─── Journey Event Types ────────────────────────────────────────────────────

export type JourneyEventType =
  | "journey_started"
  | "trio_locked"
  | "match_completed"
  | "rank_milestone"
  | "eligibility_reached"
  | "team_advanced"
  | "team_eliminated"
  | "journey_completed";

// ─── Journey Status ─────────────────────────────────────────────────────────

export type JourneyStatus = "active" | "eliminated" | "completed";

// ─── Team Journey (matches DB entity) ───────────────────────────────────────

export interface SupporterTeamJourney {
  id: string;
  wallet: string;
  competitionId: string;
  teamId: string;

  startedAt: string;
  lastParticipatedAt: string | null;
  status: JourneyStatus;

  eligibleMatches: number;
  matchesFollowed: number;
  consecutiveMatches: number;

  totalJourneyScore: number;
  averageMatchIndex: number | null;
  currentTeamRank: number | null;
  bestTeamRank: number | null;
  percentile: number | null;

  topFanEligible: boolean;
  completedAt: string | null;
}

// ─── Match Journey (per-match snapshot) ─────────────────────────────────────

export interface SupporterMatchJourney {
  wallet: string;
  competitionId: string;
  fixtureId: string;
  teamId: string;

  attackerId: string;
  midfielderId: string;
  defenderId: string;

  trioTotal: number | null;
  oppositionBenchmark: number | null;
  finalMatchIndex: number | null;

  journeyScoreBefore: number;
  journeyScoreAfter: number;

  rankBefore: number | null;
  rankAfter: number | null;

  participationNumber: number;
  finalisedAt: string | null;
}

// ─── Journey Event ──────────────────────────────────────────────────────────

export interface SupporterJourneyEvent {
  id: number;
  wallet: string;
  competitionId: string;
  teamId: string;
  fixtureId: string | null;
  eventType: JourneyEventType;
  occurredAt: string;
  headline: string;
  summary: string | null;
  metadataJson: string;
}

// ─── API Response Types ─────────────────────────────────────────────────────

export interface TeamJourneyCard {
  teamId: string;
  teamName: string;
  teamCode: string;
  flag: string;
  status: JourneyStatus;
  currentStage: string;
  matchesFollowed: number;
  eligibleMatches: number;
  totalJourneyScore: number;
  averageMatchIndex: number | null;
  currentTeamRank: number | null;
  percentile: number | null;
  topFanEligible: boolean;
}

export interface MatchTimelineEntry {
  fixtureId: string;
  stage: string;
  opponent: string;
  opponentFlag: string;
  matchResult: string | null;       // "Spain 2–0 Uruguay" or null if upcoming
  trioNames: [string, string, string] | null;
  finalMatchIndex: number | null;
  rankBefore: number | null;
  rankAfter: number | null;
  status: "completed" | "live" | "upcoming";
  startsAt: string;
}

export interface TrustedPlayerSummary {
  playerId: string;
  playerName: string;
  position: string;
  timesSelected: number;
  averageRatingWhenSelected: number | null;
  supporterPointsGenerated: number;
  bestFixtureId: string | null;
  bestFixtureOpponent: string | null;
}

export interface LeaderboardEntry {
  rank: number;
  wallet: string;
  displayName: string;
  totalScore: number;
  isCurrentUser: boolean;
}

export interface TeamJourneyPageData {
  journey: TeamJourneyCard;
  timeline: MatchTimelineEntry[];
  trustedPlayers: TrustedPlayerSummary[];
  leaderboard: {
    top: LeaderboardEntry[];
    user: LeaderboardEntry | null;
    totalParticipants: number;
    top1PercentCutoff: number | null;
  };
  rankHistory: number[];
}

// ─── Top-Fan Eligibility ────────────────────────────────────────────────────

export const TOP_FAN_THRESHOLD = 0.75; // Must follow 75% of matches

// ─── Milestones & Rewards ───────────────────────────────────────────────────

export interface JourneyMilestone {
  id: number;
  wallet: string;
  competitionId: string;
  teamId: string;
  milestoneKey: string;
  unlockedAt: string;
  fixtureId: string | null;
  metadataJson: string;
}

export interface RewardClaim {
  id: string;
  wallet: string;
  competitionId: string;
  teamId: string;
  rewardTier: string;
  eligibilityRank: number | null;
  status: "eligible" | "verification_required" | "claimed" | "fulfilled" | "rejected";
  submittedAt: string | null;
  fulfilledAt: string | null;
  metadataJson: string;
}

