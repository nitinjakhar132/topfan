import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// ── Existing Core Tables ─────────────────────────────────────────────────────

export const users = sqliteTable("users", {
  wallet: text("wallet").primaryKey(),
  displayName: text("display_name").notNull().default("Supporter"),
  primaryTeamId: text("primary_team_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull(),
  flag: text("flag").notNull().default(""),
  eliminatedAt: text("eliminated_at"),
}, (table) => [uniqueIndex("teams_code_unique").on(table.code)]);

export const fixtures = sqliteTable("fixtures", {
  id: text("id").primaryKey(),
  competitionId: text("competition_id"),
  competitionName: text("competition_name"),
  participant1Id: text("participant_1_id"),
  participant2Id: text("participant_2_id"),
  homeTeamId: text("home_team_id").notNull(),
  awayTeamId: text("away_team_id").notNull(),
  startsAt: text("starts_at").notNull(),
  phase: text("phase").notNull().default("scheduled"),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  finalisedAt: text("finalised_at"),
  dataCoverage: text("data_coverage", { enum: ["complete", "partial", "unavailable"] }).notNull().default("unavailable"),
  formulaVersion: text("formula_version"),
  rawUpdatedAt: text("raw_updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("fixtures_starts_at_idx").on(table.startsAt)]);

// ── 4.1 Stable Player Identity ──────────────────────────────────────────────

export const players = sqliteTable("players", {
  id: text("id").primaryKey(),
  normativeId: text("normative_id"),
  preferredName: text("preferred_name"),
  displayName: text("display_name"),
  teamId: text("team_id").notNull(),
  name: text("name").notNull(),
  position: text("position", { enum: ["ATT", "MID", "DEF", "GK", "OTHER"] }).notNull(),
  primaryPosition: text("primary_position"),
  shirtNumber: integer("shirt_number"),
  sofascoreId: integer("sofascore_id"),
  dateOfBirth: text("date_of_birth"),
  countryId: text("country_id"),
  photoUrl: text("photo_url"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

/** Maps external IDs (fixture-player IDs, normative IDs) to stable player.id */
export const playerExternalIds = sqliteTable("player_external_ids", {
  source: text("source").notNull(),
  externalId: text("external_id").notNull(),
  playerId: text("player_id").notNull(),
  firstSeenFixtureId: text("first_seen_fixture_id"),
  lastSeenFixtureId: text("last_seen_fixture_id"),
}, (table) => [
  uniqueIndex("player_ext_ids_unique").on(table.source, table.externalId),
  index("player_ext_ids_player_idx").on(table.playerId),
]);

// ── 4.2 Official Matchday Lineups ───────────────────────────────────────────

export const lineups = sqliteTable("lineups", {
  fixtureId: text("fixture_id").notNull(),
  playerId: text("player_id").notNull(),
  fixturePlayerId: text("fixture_player_id"),
  teamId: text("team_id").notNull(),
  shirtNumber: integer("shirt_number"),
  sourcePosition: text("source_position"),
  normalizedPosition: text("normalized_position"),
  starter: integer("starter", { mode: "boolean" }).notNull(),
  officialSubstitute: integer("official_substitute", { mode: "boolean" }).notNull(),
  position: text("position").notNull(),
  announcedAt: text("announced_at"),
  rawPayload: text("raw_payload"),
}, (table) => [primaryKey({ columns: [table.fixtureId, table.playerId] })]);

export const picks = sqliteTable("picks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fixtureId: text("fixture_id").notNull(),
  wallet: text("wallet").notNull(),
  teamId: text("team_id").notNull(),
  attackerId: text("attacker_id").notNull(),
  midfielderId: text("midfielder_id").notNull(),
  defenderId: text("defender_id").notNull(),
  lockedAt: text("locked_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  commitmentSignature: text("commitment_signature"),
}, (table) => [uniqueIndex("picks_fixture_wallet_unique").on(table.fixtureId, table.wallet)]);

// ── 4.3 Raw Event Archive ───────────────────────────────────────────────────

/** Permanent replayable event archive — stores complete TxLINE payloads */
export const rawScoreEvents = sqliteTable("raw_score_events", {
  fixtureId: text("fixture_id").notNull(),
  sequence: integer("sequence").notNull(),
  eventId: text("event_id"),
  eventTimestamp: text("event_timestamp"),
  action: text("action"),
  confirmed: integer("confirmed", { mode: "boolean" }),
  participantId: text("participant_id"),
  playerId: text("player_id"),
  playerInId: text("player_in_id"),
  playerOutId: text("player_out_id"),
  matchMinute: integer("match_minute"),
  supersededBySequence: integer("superseded_by_sequence"),
  rawPayload: text("raw_payload").notNull(),
  ingestedAt: text("ingested_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.fixtureId, table.sequence] }),
  index("raw_score_events_player_idx").on(table.playerId),
]);

// ── 4.4 Normalised Player Events ────────────────────────────────────────────

export const playerMatchEvents = sqliteTable("player_match_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fixtureId: text("fixture_id").notNull(),
  playerId: text("player_id").notNull(),
  teamId: text("team_id").notNull(),
  eventType: text("event_type").notNull(),
  eventSubtype: text("event_subtype"),
  matchMinute: integer("match_minute"),
  outcome: text("outcome"),
  confirmed: integer("confirmed", { mode: "boolean" }).notNull().default(false),
  sourceSequence: integer("source_sequence").notNull(),
  ratingDelta: real("rating_delta"),
  metadataJson: text("metadata_json").notNull().default("{}"),
}, (table) => [
  index("player_match_events_fixture_idx").on(table.fixtureId, table.playerId),
]);

// ── 4.5 Per-Match Player Statistics ─────────────────────────────────────────

export const playerMatchStats = sqliteTable("player_match_stats", {
  fixtureId: text("fixture_id").notNull(),
  playerId: text("player_id").notNull(),
  teamId: text("team_id"),
  position: text("stat_position"),

  // Existing columns — preserved for backward compat
  minutes: integer("minutes").notNull().default(0),
  goals: integer("goals").notNull().default(0),
  assists: integer("assists").notNull().default(0),
  chancesCreated: integer("chances_created").notNull().default(0),
  tackles: integer("tackles").notNull().default(0),
  ownGoals: integer("own_goals").notNull().default(0),
  shots: integer("shots").notNull().default(0),
  shotsOnTarget: integer("shots_on_target").notNull().default(0),
  yellowCards: integer("yellow_cards").notNull().default(0),
  redCards: integer("red_cards").notNull().default(0),
  penaltyAttempts: integer("penalty_attempts").notNull().default(0),
  penaltyGoals: integer("penalty_goals").notNull().default(0),
  performanceScore: real("performance_score").notNull().default(0),
  impactRating: real("impact_rating"),
  formulaVersion: text("formula_version").notNull().default("position-v1"),
  dataCoverage: text("data_coverage", { enum: ["complete", "partial", "unavailable"] }).notNull().default("unavailable"),
  source: text("source").notNull().default("txline-devnet"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),

  // New repository columns
  starter: integer("stat_starter", { mode: "boolean" }),
  officialSubstitute: integer("stat_official_substitute", { mode: "boolean" }),
  enteredMatch: integer("entered_match", { mode: "boolean" }),
  minuteOn: integer("minute_on"),
  minuteOff: integer("minute_off"),
  minutesPlayed: integer("minutes_played"),
  cleanSheet: integer("clean_sheet", { mode: "boolean" }),
  defensiveActions: integer("defensive_actions"),
  shotsOffTarget: integer("shots_off_target"),
  shotsBlocked: integer("shots_blocked"),
  shotsWoodwork: integer("shots_woodwork"),
  liveRating: real("live_rating"),
  finalRating: real("final_rating"),
  ratingVersion: text("rating_version"),
  availableMetricsJson: text("available_metrics_json"),
  finalised: integer("stat_finalised", { mode: "boolean" }),
  recalculatedAt: text("recalculated_at"),
}, (table) => [
  primaryKey({ columns: [table.fixtureId, table.playerId] }),
  index("player_match_stats_player_idx").on(table.playerId),
]);

// ── 4.6 Rating Model Versions ───────────────────────────────────────────────

export const ratingModelVersions = sqliteTable("rating_model_versions", {
  version: text("version").primaryKey(),
  name: text("name").notNull(),
  weightsJson: text("weights_json").notNull(),
  requiredMetricsJson: text("required_metrics_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  active: integer("active", { mode: "boolean" }).notNull().default(false),
  notes: text("notes"),
});

export const matchScores = sqliteTable("match_scores", {
  fixtureId: text("fixture_id").notNull(),
  wallet: text("wallet").notNull(),
  teamId: text("team_id").notNull(),
  selectedTrio: real("selected_trio").notNull(),
  bestOwnTrio: real("best_own_trio").notNull(),
  bestOppositionTrio: real("best_opposition_trio").notNull(),
  selectionAccuracy: real("selection_accuracy").notNull(),
  matchupIndex: real("matchup_index").notNull(),
  rank: integer("rank").notNull(),
  entrants: integer("entrants").notNull(),
  percentile: real("percentile").notNull(),
  baseScore: real("base_score").notNull(),
  placementBonus: real("placement_bonus").notNull(),
  contribution: real("contribution").notNull(),
  finalisedAt: text("finalised_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.fixtureId, table.wallet] }),
  index("match_scores_team_idx").on(table.teamId, table.contribution),
]);

export const feedEvents = sqliteTable("feed_events", {
  fixtureId: text("fixture_id").notNull(),
  sequence: integer("sequence").notNull(),
  action: text("action").notNull().default("unknown"),
  participant: integer("participant"),
  eventEpoch: integer("event_epoch"),
  payload: text("payload").notNull(),
  status: text("status").notNull().default("confirmed"),
  receivedAt: text("received_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.fixtureId, table.sequence] })]);

export const fixtureSyncState = sqliteTable("fixture_sync_state", {
  fixtureId: text("fixture_id").primaryKey(),
  source: text("source").notNull().default("txline-devnet"),
  lastSequence: integer("last_sequence").notNull().default(0),
  eventCount: integer("event_count").notNull().default(0),
  playerCount: integer("player_count").notNull().default(0),
  attributedEventCount: integer("attributed_event_count").notNull().default(0),
  dataCoverage: text("data_coverage", { enum: ["complete", "partial", "unavailable"] }).notNull().default("unavailable"),
  historicalFetchedAt: text("historical_fetched_at"),
  reconciledAt: text("reconciled_at"),
  finalised: integer("finalised", { mode: "boolean" }).notNull().default(false),
  lastError: text("last_error"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ── 4.7 Tournament Aggregates ───────────────────────────────────────────────

export const playerTournamentStats = sqliteTable("player_tournament_stats", {
  playerId: text("player_id").notNull(),
  competitionId: text("competition_id").notNull(),
  teamId: text("team_id").notNull(),
  position: text("position").notNull(),

  // Appearance counts
  matchesNamed: integer("matches_named").notNull().default(0),
  appearances: integer("appearances").notNull().default(0),
  starts: integer("starts").notNull().default(0),
  substituteAppearances: integer("substitute_appearances").notNull().default(0),
  totalMinutes: integer("total_minutes").notNull().default(0),

  // Aggregated totals — nullable: null = metric unavailable, 0 = zero recorded
  totalGoals: integer("total_goals"),
  totalAssists: integer("total_assists"),
  totalShots: integer("total_shots"),
  totalShotsOnTarget: integer("total_shots_on_target"),
  totalChancesCreated: integer("total_chances_created"),
  totalTackles: integer("total_tackles"),
  totalYellowCards: integer("total_yellow_cards"),
  totalRedCards: integer("total_red_cards"),
  totalOwnGoals: integer("total_own_goals"),
  totalPenaltyAttempts: integer("total_penalty_attempts"),
  totalPenaltyGoals: integer("total_penalty_goals"),
  totalCleanSheets: integer("total_clean_sheets"),
  totalDefensiveActions: integer("total_defensive_actions"),

  // Per-90 rates
  goalsPer90: real("goals_per_90"),
  assistsPer90: real("assists_per_90"),
  shotsPer90: real("shots_per_90"),
  shotsOnTargetPer90: real("shots_on_target_per_90"),
  chancesCreatedPer90: real("chances_created_per_90"),
  tacklesPer90: real("tackles_per_90"),

  // Rating aggregates
  minutesWeightedRating: real("minutes_weighted_rating"),
  simpleAverageRating: real("simple_average_rating"),
  bestRating: real("best_rating"),
  worstRating: real("worst_rating"),
  recentFormRating: real("recent_form_rating"),
  consistencyScore: real("consistency_score"),
  formTrend: text("form_trend", {
    enum: ["rising", "stable", "declining", "insufficient_data"],
  }).notNull().default("insufficient_data"),

  // Spider chart attributes (0–100 percentile within position group, null = insufficient data)
  spiderForm: real("spider_form"),
  spiderImpact: real("spider_impact"),
  spiderThreat: real("spider_threat"),
  spiderBigMoments: real("spider_big_moments"),
  spiderReliability: real("spider_reliability"),
  spiderDiscipline: real("spider_discipline"),

  // Rankings
  positionRank: integer("position_rank"),
  teamRank: integer("team_rank"),
  qualifiedForPercentiles: integer("qualified_for_percentiles", {
    mode: "boolean",
  }).notNull().default(false),

  // Quality metadata
  availableMetricsJson: text("available_metrics_json").notNull().default("[]"),
  sampleQuality: text("sample_quality", {
    enum: ["none", "low", "medium", "high"],
  }).notNull().default("none"),

  ratingVersion: text("rating_version"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.playerId, table.competitionId] }),
  index("pts_competition_team_pos_idx").on(table.competitionId, table.teamId, table.position),
]);

// ── 4.8 Deterministic Player Traits ─────────────────────────────────────────

export const playerTraits = sqliteTable("player_traits", {
  playerId: text("player_id").notNull(),
  competitionId: text("competition_id").notNull(),
  traitKey: text("trait_key").notNull(),
  traitStrength: real("trait_strength").notNull(),
  evidenceJson: text("evidence_json").notNull(),
  ratingVersion: text("rating_version"),
  generatedAt: text("generated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.playerId, table.competitionId, table.traitKey] }),
]);

// ── 4.9 User–Player Journey ─────────────────────────────────────────────────

export const userPlayerHistory = sqliteTable("user_player_history", {
  wallet: text("wallet").notNull(),
  playerId: text("player_id").notNull(),
  competitionId: text("competition_id").notNull(),

  timesSelected: integer("times_selected").notNull().default(0),
  completedSelections: integer("completed_selections").notNull().default(0),
  totalRatingWhenSelected: real("total_rating_when_selected").notNull().default(0),
  averageRatingWhenSelected: real("average_rating_when_selected"),
  positionComparisonsWon: integer("position_comparisons_won").notNull().default(0),
  supporterPointsGenerated: real("supporter_points_generated").notNull().default(0),

  bestFixtureId: text("best_fixture_id"),
  lastSelectedFixtureId: text("last_selected_fixture_id"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.wallet, table.playerId, table.competitionId] }),
]);

// ── 4.10 Supporter Tournament Scores ────────────────────────────────────────

/** Persisted after each match finalises. Tracks cumulative supporter performance. */
export const supporterScores = sqliteTable("supporter_scores", {
  wallet: text("wallet").notNull(),
  competitionId: text("competition_id").notNull(),
  teamId: text("team_id").notNull(),
  /** Cumulative score across all finalised matches in this competition */
  totalScore: real("total_score").notNull().default(0),
  /** Number of finalised matches contributing to totalScore */
  matchesPlayed: integer("matches_played").notNull().default(0),
  /** Current tournament rank (recalculated after each match) */
  currentRank: integer("current_rank"),
  /** Best rank achieved at any point */
  bestRank: integer("best_rank"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.wallet, table.competitionId] }),
  index("supporter_scores_team_idx").on(table.teamId, table.totalScore),
]);

// ── 4.11 Supporter Team Journeys ────────────────────────────────────────────

/** Longitudinal career tracking per wallet + competition + team. */
export const supporterTeamJourneys = sqliteTable("supporter_team_journeys", {
  id: text("id").primaryKey(),
  wallet: text("wallet").notNull(),
  competitionId: text("competition_id").notNull(),
  teamId: text("team_id").notNull(),

  startedAt: text("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastParticipatedAt: text("last_participated_at"),
  status: text("status", { enum: ["active", "eliminated", "completed"] }).notNull().default("active"),

  eligibleMatches: integer("eligible_matches").notNull().default(0),
  matchesFollowed: integer("matches_followed").notNull().default(0),
  consecutiveMatches: integer("consecutive_matches").notNull().default(0),

  totalJourneyScore: real("total_journey_score").notNull().default(0),
  averageMatchIndex: real("average_match_index"),
  currentTeamRank: integer("current_team_rank"),
  bestTeamRank: integer("best_team_rank"),
  percentile: real("percentile"),

  topFanEligible: integer("top_fan_eligible", { mode: "boolean" }).notNull().default(false),
  completedAt: text("completed_at"),
}, (table) => [
  uniqueIndex("stj_wallet_comp_team").on(table.wallet, table.competitionId, table.teamId),
  index("stj_team_score_idx").on(table.teamId, table.totalJourneyScore),
]);

// ── 4.12 Supporter Match Journeys ───────────────────────────────────────────

/** Per-match journey snapshot: trio picks, score/rank before & after. */
export const supporterMatchJourneys = sqliteTable("supporter_match_journeys", {
  wallet: text("wallet").notNull(),
  competitionId: text("competition_id").notNull(),
  fixtureId: text("fixture_id").notNull(),
  teamId: text("team_id").notNull(),

  attackerId: text("attacker_id").notNull(),
  midfielderId: text("midfielder_id").notNull(),
  defenderId: text("defender_id").notNull(),

  trioTotal: real("trio_total"),
  oppositionBenchmark: real("opposition_benchmark"),
  finalMatchIndex: real("final_match_index"),

  journeyScoreBefore: real("journey_score_before").notNull().default(0),
  journeyScoreAfter: real("journey_score_after").notNull().default(0),

  rankBefore: integer("rank_before"),
  rankAfter: integer("rank_after"),

  participationNumber: integer("participation_number").notNull().default(1),
  finalisedAt: text("finalised_at"),
}, (table) => [
  primaryKey({ columns: [table.wallet, table.fixtureId] }),
  index("smj_team_idx").on(table.teamId, table.wallet),
]);

// ── 4.13 Supporter Journey Events ───────────────────────────────────────────

/** Meaningful journey moments stored for the timeline and recap. */
export const supporterJourneyEvents = sqliteTable("supporter_journey_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  wallet: text("wallet").notNull(),
  competitionId: text("competition_id").notNull(),
  teamId: text("team_id").notNull(),
  fixtureId: text("fixture_id"),
  eventType: text("event_type").notNull(),
  occurredAt: text("occurred_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  headline: text("headline").notNull(),
  summary: text("summary"),
  metadataJson: text("metadata_json").notNull().default("{}"),
}, (table) => [
  index("sje_wallet_team_idx").on(table.wallet, table.teamId),
]);

// ── 4.14 Supporter Milestones ───────────────────────────────────────────────

export const supporterMilestones = sqliteTable("supporter_milestones", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  wallet: text("wallet").notNull(),
  competitionId: text("competition_id").notNull(),
  teamId: text("team_id").notNull(),
  milestoneKey: text("milestone_key").notNull(),
  unlockedAt: text("unlocked_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  fixtureId: text("fixture_id"),
  metadataJson: text("metadata_json").notNull().default("{}"),
}, (table) => [
  uniqueIndex("sm_wallet_comp_team_key").on(table.wallet, table.competitionId, table.teamId, table.milestoneKey),
]);

// ── 4.15 Supporter Reward Claims ────────────────────────────────────────────

export const supporterRewardClaims = sqliteTable("supporter_reward_claims", {
  id: text("id").primaryKey(),
  wallet: text("wallet").notNull(),
  competitionId: text("competition_id").notNull(),
  teamId: text("team_id").notNull(),
  rewardTier: text("reward_tier").notNull(),
  eligibilityRank: integer("eligibility_rank"),
  status: text("status").notNull().default("eligible"), // 'eligible' | 'verification_required' | 'claimed' | 'fulfilled' | 'rejected'
  submittedAt: text("submitted_at"),
  fulfilledAt: text("fulfilled_at"),
  metadataJson: text("metadata_json").notNull().default("{}"),
});

