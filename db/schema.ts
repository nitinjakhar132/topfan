import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  homeTeamId: text("home_team_id").notNull(),
  awayTeamId: text("away_team_id").notNull(),
  startsAt: text("starts_at").notNull(),
  phase: text("phase").notNull().default("scheduled"),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  finalisedAt: text("finalised_at"),
  rawUpdatedAt: text("raw_updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("fixtures_starts_at_idx").on(table.startsAt)]);

export const players = sqliteTable("players", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  name: text("name").notNull(),
  position: text("position", { enum: ["ATT", "MID", "DEF", "GK"] }).notNull(),
  shirtNumber: integer("shirt_number"),
});

export const lineups = sqliteTable("lineups", {
  fixtureId: text("fixture_id").notNull(),
  playerId: text("player_id").notNull(),
  teamId: text("team_id").notNull(),
  starter: integer("starter", { mode: "boolean" }).notNull(),
  officialSubstitute: integer("official_substitute", { mode: "boolean" }).notNull(),
  position: text("position").notNull(),
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

export const playerMatchStats = sqliteTable("player_match_stats", {
  fixtureId: text("fixture_id").notNull(),
  playerId: text("player_id").notNull(),
  minutes: integer("minutes").notNull().default(0),
  goals: integer("goals").notNull().default(0),
  ownGoals: integer("own_goals").notNull().default(0),
  shots: integer("shots").notNull().default(0),
  shotsOnTarget: integer("shots_on_target").notNull().default(0),
  yellowCards: integer("yellow_cards").notNull().default(0),
  redCards: integer("red_cards").notNull().default(0),
  penaltyAttempts: integer("penalty_attempts").notNull().default(0),
  penaltyGoals: integer("penalty_goals").notNull().default(0),
  impactRating: real("impact_rating").notNull().default(6),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.fixtureId, table.playerId] })]);

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
  payload: text("payload").notNull(),
  status: text("status").notNull().default("confirmed"),
  receivedAt: text("received_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.fixtureId, table.sequence] })]);

