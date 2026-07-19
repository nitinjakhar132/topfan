/**
 * ONE NATION — Live Streaming Types
 *
 * Core type definitions for the real-time supporter career experience.
 * All types here flow through the SSE pipeline: stream worker → rating engine → client.
 */

import type { LivePlayer } from "../txline/normalize";

// ─── Fixture Data Mode ──────────────────────────────────────────────────────
// Replaces the old binary "historical" / "snapshot" decision with explicit phases.

export type FixtureDataMode =
  | "prematch"    // Fixture hasn't started — show lineup, pre-match intelligence
  | "live"        // Match in progress — SSE stream active
  | "finalising"  // Match ended, halftime_finalised or game_finalised received but not yet confirmed
  | "completed"   // Final data confirmed — archive only
  | "replay";     // Replaying archived events through the live pipeline

// ─── Soccer Game Phase (from TxLINE feed spec) ─────────────────────────────

export type GamePhaseId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19;

export const GAME_PHASE_NAMES: Record<GamePhaseId, string> = {
  1: "Not Started",
  2: "1st Half",
  3: "Half Time",
  4: "2nd Half",
  5: "Full Time",
  6: "Waiting for ET",
  7: "ET 1st Half",
  8: "ET Half Time",
  9: "ET 2nd Half",
  10: "Full Time (AET)",
  11: "Waiting for Pens",
  12: "Penalty Shootout",
  13: "Full Time (Pens)",
  14: "Interrupted",
  15: "Abandoned",
  16: "Cancelled",
  17: "TX Coverage Cancelled",
  18: "TX Coverage Suspended",
  19: "Postponed",
};

export const GAME_PHASE_CODES: Record<GamePhaseId, string> = {
  1: "NS", 2: "H1", 3: "HT", 4: "H2", 5: "F",
  6: "WET", 7: "ET1", 8: "HTET", 9: "ET2", 10: "FET",
  11: "WPE", 12: "PE", 13: "FPE", 14: "I", 15: "A",
  16: "C", 17: "TXCC", 18: "TXCS", 19: "P",
};

export function isLivePhase(phaseId: GamePhaseId): boolean {
  return [2, 3, 4, 6, 7, 8, 9, 11, 12].includes(phaseId);
}

export function isFinishedPhase(phaseId: GamePhaseId): boolean {
  return [5, 10, 13].includes(phaseId);
}

// ─── Normalized Match Event ─────────────────────────────────────────────────
// Canonical shape for every TxLINE score event, regardless of source (live or replay).

export type NormalizedMatchEvent = {
  fixtureId: string;
  seq: number;
  action: string;           // e.g. "goal", "shot", "yellow_card", "substitution", "corner", etc.
  playerId?: string;
  playerName?: string;
  playerInId?: string;
  playerInName?: string;
  participantId?: string;    // "1" or "2"
  minute?: number;
  outcome?: string;          // e.g. "OnTarget", "Scored", "Missed"
  subtype?: string;          // e.g. FreeKickType: "HighDanger", "Offside"
  ts: string;                // ISO timestamp of the event
  isConfirmed: boolean;      // TxLINE sends unconfirmed then confirmed pairs
};

// ─── Player Rating Update ───────────────────────────────────────────────────

export type PlayerRatingUpdate = {
  playerId: string;
  playerName: string;
  position: LivePlayer["position"];
  participantId: string;
  ratingBefore: number;
  ratingAfter: number;
  delta: number;
  triggerAction: string;     // The event that caused this change
  triggerMinute?: number;
  isUserPlayer: boolean;     // Is this player in the user's picked trio?
};

// ─── Opposition Benchmark ───────────────────────────────────────────────────

export type OppositionBenchmarkPlayer = {
  playerId: string;
  playerName: string;
  position: LivePlayer["position"];
  rating: number;
};

export type OppositionBenchmark = {
  bestATT: OppositionBenchmarkPlayer | null;
  bestMID: OppositionBenchmarkPlayer | null;
  bestDEF: OppositionBenchmarkPlayer | null;
  benchmarkTotal: number;
  previousTotal?: number;
};

// ─── Match Pulse (from odds stream) ─────────────────────────────────────────

export type MatchPulseUpdate = {
  fixtureId?: string;
  participant1Outlook: number;  // 0–100 percentage
  participant2Outlook: number;
  drawOutlook: number;
  previousParticipant1?: number;
  previousParticipant2?: number;
  momentumShift?: "participant1" | "participant2" | "neutral";
  /** How much participant1's outlook shifted vs previous snapshot */
  shift?: number;
  /** Which direction the momentum shifted */
  shiftDirection?: "participant1" | "participant2" | "draw" | "neutral";
  /** Human-readable label for momentum shift notification */
  shiftLabel?: string;
  /** Data quality: "live" from odds stream, "unavailable" if no feed */
  quality?: "live" | "unavailable";
  ts: string;
};

// ─── Leaderboard / Rank ─────────────────────────────────────────────────────

export type UserRankUpdate = {
  wallet: string;
  teamId: string;
  previousRank: number;
  currentRank: number;
  totalEntrants: number;
  trioTotal: number;
  movement: number;  // positive = moved up
};

// ─── Correction Event ───────────────────────────────────────────────────────

export type CorrectionEvent = {
  originalSeq: number;
  correctedAction: string;
  affectedPlayerIds: string[];
  ratingAdjustments: PlayerRatingUpdate[];
};

// ─── Match Phase Change ─────────────────────────────────────────────────────

export type MatchPhaseChange = {
  fixtureId: string;
  previousPhase: GamePhaseId;
  currentPhase: GamePhaseId;
  phaseName: string;
  phaseCode: string;
};

// ─── Final Match State ──────────────────────────────────────────────────────

export type FinalMatchState = {
  fixtureId: string;
  participant1Score: number;
  participant2Score: number;
  phase: GamePhaseId;
  finalPlayerRatings: Record<string, number>;
  userTrioTotal: number;
  oppositionBenchmarkTotal: number;
};

// ─── Live Fixture State (in-memory, maintained by stream worker) ────────────

export type LivePlayerState = {
  playerId: string;
  playerName: string;
  position: LivePlayer["position"];
  participantId: string;
  rating: number;
  eventHistory: Array<{ action: string; delta: number; minute?: number; seq: number }>;
  isSubstitutedOut: boolean;
  shirtNumber?: number | null;
  photoUrl?: string | null;
  starter?: boolean;
  officialSubstitute?: boolean;
  enteredMatch?: boolean;
};

export type LiveFixtureState = {
  fixtureId: string;
  participant1: string;
  participant2: string;
  participant1Id: string;
  participant2Id: string;
  participant1Score: number;
  participant2Score: number;
  gamePhase: GamePhaseId;
  currentMinute: number;
  players: Map<string, LivePlayerState>;
  events: NormalizedMatchEvent[];
  lastSeq: number;
  mode: FixtureDataMode;
  startedAt: string;
  updatedAt: string;
};

// ─── Client SSE Event Protocol ──────────────────────────────────────────────
// Every message sent to browser clients over the SSE channel is one of these.

export type ClientLiveEvent =
  | { type: "connection"; payload: { status: "live" | "replay"; fixtureId: string } }
  | { type: "fixture_snapshot"; payload: SerializableLiveFixtureState }
  | { type: "score_event"; payload: NormalizedMatchEvent }
  | { type: "player_rating"; payload: PlayerRatingUpdate }
  | { type: "benchmark_update"; payload: OppositionBenchmark }
  | { type: "odds_pulse"; payload: MatchPulseUpdate }
  | { type: "leaderboard_update"; payload: UserRankUpdate }
  | { type: "phase_change"; payload: MatchPhaseChange }
  | { type: "correction"; payload: CorrectionEvent }
  | { type: "finalised"; payload: FinalMatchState }
  | { type: "heartbeat"; payload: { ts: string } }
  | { type: "narrator"; payload: NarratorCard };

// ─── Serializable Live Fixture State ────────────────────────────────────────
// JSON-safe version of LiveFixtureState (Map → Record).

export type SerializableLiveFixtureState = Omit<LiveFixtureState, "players"> & {
  players: Record<string, LivePlayerState>;
};

export function serializeFixtureState(state: LiveFixtureState): SerializableLiveFixtureState {
  return {
    ...state,
    players: Object.fromEntries(state.players),
  };
}

// ─── Narrator Card ──────────────────────────────────────────────────────────
// Personalised event card shown to the user in the live match screen.

export type NarratorCard = {
  headline: string;
  detail: string;
  playerRatingBefore: number;
  playerRatingAfter: number;
  trioTotalBefore: number;
  trioTotalAfter: number;
  isUserPlayer: boolean;
  isOppositionBenchmark: boolean;
  minute?: number;
  action: string;
  playerName: string;
  participantId: string;
};

// ─── User Trio Selection ────────────────────────────────────────────────────
// The user's chosen ATT/MID/DEF for a match.

export type UserTrio = {
  attackerId: string;
  midfielderId: string;
  defenderId: string;
  teamId: string;
};

// ─── Replay State ───────────────────────────────────────────────────────────
 
export type ReplaySpeed = 1 | 5 | 20;
 
export type ReplayState = {
  fixtureId: string;
  speed: ReplaySpeed;
  currentSeq: number;
  totalEvents: number;
  isPaused: boolean;
  isComplete: boolean;
  elapsedMs: number;
};

// ─── Match Map Visual Feature Types ─────────────────────────────────────────

export type MatchViewMode = "upcoming" | "live" | "replay" | "completed";

export type MatchMapRole = "GK" | "DEF" | "MID" | "ATT";

export interface MatchMapPlayer {
  playerId: string;
  teamId: string;
  displayName: string;
  shortName: string;
  photoUrl: string | null;
  shirtNumber: number | null;
  role: MatchMapRole;
  starter: boolean;
  officialSubstitute: boolean;
  enteredMatch: boolean;
  substitutedOff: boolean;
  currentRating: number | null;
  finalRating: number | null;
  isUserTrio: boolean;
  isOppositionBenchmark: boolean;
  isLatestMomentPlayer: boolean;
  latestRatingDelta: number | null;
  layout?: {
    line: "GK" | "DEF" | "MID" | "ATT";
    indexInLine: number;
    countInLine: number;
  };
}

export interface MatchMapTeam {
  teamId: string;
  teamName: string;
  shortName: string;
  visualUrl: string | null;
  formation: string | null;
  activePlayers: MatchMapPlayer[];
  benchPlayers: MatchMapPlayer[];
}

export interface MatchMapMoment {
  id: string;
  sourceSequence: number | null;
  minute: number | null;
  label: string;
  type:
    | "goal"
    | "own_goal"
    | "penalty"
    | "shot_on_target"
    | "yellow_card"
    | "red_card"
    | "substitution"
    | "selected_player_entered"
    | "benchmark_change"
    | "match_index_change"
    | "rank_change"
    | "phase_change"
    | "correction";
  headline: string;
  summary: string | null;
  affectedPlayerIds: string[];
  ratingChanges: Array<{
    playerId: string;
    before: number | null;
    after: number | null;
    delta: number;
  }>;
  trioBefore: number | null;
  trioAfter: number | null;
  benchmarkBefore: number | null;
  benchmarkAfter: number | null;
  matchIndexBefore: number | null;
  matchIndexAfter: number | null;
  snapshotId: string;
}

export interface MatchMapSnapshot {
  snapshotId: string;
  sourceSequence: number | null;
  minute: number | null;
  phase: string;
  homeScore: number;
  awayScore: number;
  supportedTeam: MatchMapTeam;
  oppositionTeam: MatchMapTeam;
  trioTotal: number | null;
  oppositionBenchmarkTotal: number | null;
  matchIndex: number | null;
  latestMoment: MatchMapMoment | null;
}
