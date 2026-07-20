import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}

let initialization: Promise<void> | null = null;
let initialized = false;

// Helper to wrap a promise in a timeout
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`[DB DEBUG] ${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export async function ensureArchiveDatabase() {
  if (initialized) return;
  if (initialization) return initialization;
  initialization = (async () => {
    console.log("[DB DEBUG] ensureArchiveDatabase: starting initialization...");
    const d1 = env.DB;
    if (!d1) {
      console.error("[DB DEBUG] env.DB is unavailable!");
      throw new Error("Cloudflare D1 binding `DB` is unavailable.");
    }
    console.log("[DB DEBUG] Running D1 batch table creation...");

    const DB_TIMEOUT_MS = 1500;

    // ── Batch 1: Original core tables ──────────────────────────────────────
    await withTimeout(d1.batch([
      d1.prepare("CREATE TABLE IF NOT EXISTS teams (id text PRIMARY KEY NOT NULL, name text NOT NULL, code text NOT NULL, flag text DEFAULT '' NOT NULL, eliminated_at text)"),
      d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS teams_code_unique ON teams (code)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS fixtures (id text PRIMARY KEY NOT NULL, competition_id text, competition_name text, participant_1_id text, participant_2_id text, home_team_id text NOT NULL, away_team_id text NOT NULL, starts_at text NOT NULL, phase text DEFAULT 'scheduled' NOT NULL, home_score integer, away_score integer, finalised_at text, data_coverage text DEFAULT 'unavailable' NOT NULL, formula_version text, raw_updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS fixtures_starts_at_idx ON fixtures (starts_at)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS players (id text PRIMARY KEY NOT NULL, team_id text NOT NULL, name text NOT NULL, position text NOT NULL, shirt_number integer, sofascore_id integer, normative_id text, preferred_name text, display_name text, primary_position text, date_of_birth text, country_id text, photo_url text, created_at text DEFAULT CURRENT_TIMESTAMP, updated_at text DEFAULT CURRENT_TIMESTAMP)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS lineups (fixture_id text NOT NULL, player_id text NOT NULL, team_id text NOT NULL, starter integer NOT NULL, official_substitute integer NOT NULL, position text NOT NULL, PRIMARY KEY (fixture_id, player_id))"),
      d1.prepare("CREATE TABLE IF NOT EXISTS player_match_stats (fixture_id text NOT NULL, player_id text NOT NULL, minutes integer DEFAULT 0 NOT NULL, goals integer DEFAULT 0 NOT NULL, assists integer DEFAULT 0 NOT NULL, chances_created integer DEFAULT 0 NOT NULL, tackles integer DEFAULT 0 NOT NULL, own_goals integer DEFAULT 0 NOT NULL, shots integer DEFAULT 0 NOT NULL, shots_on_target integer DEFAULT 0 NOT NULL, yellow_cards integer DEFAULT 0 NOT NULL, red_cards integer DEFAULT 0 NOT NULL, penalty_attempts integer DEFAULT 0 NOT NULL, penalty_goals integer DEFAULT 0 NOT NULL, performance_score real DEFAULT 0 NOT NULL, impact_rating real, formula_version text DEFAULT 'position-v1' NOT NULL, data_coverage text DEFAULT 'unavailable' NOT NULL, source text DEFAULT 'txline-devnet' NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, PRIMARY KEY (fixture_id, player_id))"),
      d1.prepare("CREATE TABLE IF NOT EXISTS feed_events (fixture_id text NOT NULL, sequence integer NOT NULL, action text DEFAULT 'unknown' NOT NULL, participant integer, event_epoch integer, payload text NOT NULL, status text DEFAULT 'confirmed' NOT NULL, received_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, PRIMARY KEY (fixture_id, sequence))"),
      d1.prepare("CREATE TABLE IF NOT EXISTS fixture_sync_state (fixture_id text PRIMARY KEY NOT NULL, source text DEFAULT 'txline-devnet' NOT NULL, last_sequence integer DEFAULT 0 NOT NULL, event_count integer DEFAULT 0 NOT NULL, player_count integer DEFAULT 0 NOT NULL, attributed_event_count integer DEFAULT 0 NOT NULL, data_coverage text DEFAULT 'unavailable' NOT NULL, historical_fetched_at text, reconciled_at text, finalised integer DEFAULT false NOT NULL, last_error text, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS picks (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, fixture_id text NOT NULL, wallet text NOT NULL, team_id text NOT NULL, attacker_id text NOT NULL, midfielder_id text NOT NULL, defender_id text NOT NULL, locked_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, commitment_signature text)"),
      d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS picks_fixture_wallet_unique ON picks (fixture_id, wallet)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS match_scores (fixture_id text NOT NULL, wallet text NOT NULL, team_id text NOT NULL, selected_trio real NOT NULL, best_own_trio real NOT NULL, best_opposition_trio real NOT NULL, selection_accuracy real NOT NULL, matchup_index real NOT NULL, rank integer NOT NULL, entrants integer NOT NULL, percentile real NOT NULL, base_score real NOT NULL, placement_bonus real NOT NULL, contribution real NOT NULL, finalised_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, PRIMARY KEY (fixture_id, wallet))"),
      d1.prepare("CREATE INDEX IF NOT EXISTS match_scores_team_idx ON match_scores (team_id, contribution)"),
    ]), DB_TIMEOUT_MS, "Batch 1 tables creation");

    // ── Batch 2: Player Repository tables ──────────────────────────────────
    await withTimeout(d1.batch([
      // 4.1 Player External IDs
      d1.prepare("CREATE TABLE IF NOT EXISTS player_external_ids (source text NOT NULL, external_id text NOT NULL, player_id text NOT NULL, first_seen_fixture_id text, last_seen_fixture_id text)"),
      d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS player_ext_ids_unique ON player_external_ids (source, external_id)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS player_ext_ids_player_idx ON player_external_ids (player_id)"),

      // 4.3 Raw Score Events
      d1.prepare("CREATE TABLE IF NOT EXISTS raw_score_events (fixture_id text NOT NULL, sequence integer NOT NULL, event_id text, event_timestamp text, action text, confirmed integer, participant_id text, player_id text, player_in_id text, player_out_id text, match_minute integer, superseded_by_sequence integer, raw_payload text NOT NULL, ingested_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, PRIMARY KEY (fixture_id, sequence))"),
      d1.prepare("CREATE INDEX IF NOT EXISTS raw_score_events_player_idx ON raw_score_events (player_id)"),

      // 4.4 Normalised Player Events
      d1.prepare("CREATE TABLE IF NOT EXISTS player_match_events (id integer PRIMARY KEY AUTOINCREMENT, fixture_id text NOT NULL, player_id text NOT NULL, team_id text NOT NULL, event_type text NOT NULL, event_subtype text, match_minute integer, outcome text, confirmed integer DEFAULT 0 NOT NULL, source_sequence integer NOT NULL, rating_delta real, metadata_json text DEFAULT '{}' NOT NULL)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS player_match_events_fixture_idx ON player_match_events (fixture_id, player_id)"),

      // 4.6 Rating Model Versions
      d1.prepare("CREATE TABLE IF NOT EXISTS rating_model_versions (version text PRIMARY KEY NOT NULL, name text NOT NULL, weights_json text NOT NULL, required_metrics_json text NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, active integer DEFAULT 0 NOT NULL, notes text)"),
    ]), DB_TIMEOUT_MS, "Batch 2 player repo tables");

    // ── Batch 3: Tournament aggregates, traits, user journey ───────────────
    await withTimeout(d1.batch([
      // 4.7 Tournament Aggregates
      d1.prepare(`CREATE TABLE IF NOT EXISTS player_tournament_stats (
        player_id text NOT NULL, competition_id text NOT NULL, team_id text NOT NULL, position text NOT NULL,
        matches_named integer DEFAULT 0 NOT NULL, appearances integer DEFAULT 0 NOT NULL,
        starts integer DEFAULT 0 NOT NULL, substitute_appearances integer DEFAULT 0 NOT NULL,
        total_minutes integer DEFAULT 0 NOT NULL,
        total_goals integer, total_assists integer, total_shots integer, total_shots_on_target integer,
        total_chances_created integer, total_tackles integer, total_yellow_cards integer, total_red_cards integer,
        total_own_goals integer, total_penalty_attempts integer, total_penalty_goals integer,
        total_clean_sheets integer, total_defensive_actions integer,
        goals_per_90 real, assists_per_90 real, shots_per_90 real, shots_on_target_per_90 real,
        chances_created_per_90 real, tackles_per_90 real,
        minutes_weighted_rating real, simple_average_rating real, best_rating real, worst_rating real,
        recent_form_rating real, consistency_score real,
        form_trend text DEFAULT 'insufficient_data' NOT NULL,
        spider_form real, spider_impact real, spider_threat real, spider_big_moments real,
        spider_reliability real, spider_discipline real,
        position_rank integer, team_rank integer,
        qualified_for_percentiles integer DEFAULT 0 NOT NULL,
        available_metrics_json text DEFAULT '[]' NOT NULL,
        sample_quality text DEFAULT 'none' NOT NULL,
        rating_version text,
        updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
        PRIMARY KEY (player_id, competition_id)
      )`),
      d1.prepare("CREATE INDEX IF NOT EXISTS pts_competition_team_pos_idx ON player_tournament_stats (competition_id, team_id, position)"),

      // 4.8 Player Traits
      d1.prepare("CREATE TABLE IF NOT EXISTS player_traits (player_id text NOT NULL, competition_id text NOT NULL, trait_key text NOT NULL, trait_strength real NOT NULL, evidence_json text NOT NULL, rating_version text, generated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, PRIMARY KEY (player_id, competition_id, trait_key))"),

      // 4.9 User–Player Journey
      d1.prepare("CREATE TABLE IF NOT EXISTS user_player_history (wallet text NOT NULL, player_id text NOT NULL, competition_id text NOT NULL, times_selected integer DEFAULT 0 NOT NULL, completed_selections integer DEFAULT 0 NOT NULL, total_rating_when_selected real DEFAULT 0 NOT NULL, average_rating_when_selected real, position_comparisons_won integer DEFAULT 0 NOT NULL, supporter_points_generated real DEFAULT 0 NOT NULL, best_fixture_id text, last_selected_fixture_id text, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, PRIMARY KEY (wallet, player_id, competition_id))"),
    ]), DB_TIMEOUT_MS, "Batch 3 tournament stats");

    // ── Batch 4: Supporter Journey tables ─────────────────────────────────
    await withTimeout(d1.batch([
      // 4.11 Supporter Team Journeys
      d1.prepare(`CREATE TABLE IF NOT EXISTS supporter_team_journeys (
        id text PRIMARY KEY NOT NULL, wallet text NOT NULL, competition_id text NOT NULL, team_id text NOT NULL,
        started_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, last_participated_at text,
        status text DEFAULT 'active' NOT NULL,
        eligible_matches integer DEFAULT 0 NOT NULL, matches_followed integer DEFAULT 0 NOT NULL,
        consecutive_matches integer DEFAULT 0 NOT NULL,
        total_journey_score real DEFAULT 0 NOT NULL, average_match_index real,
        current_team_rank integer, best_team_rank integer, percentile real,
        top_fan_eligible integer DEFAULT 0 NOT NULL, completed_at text
      )`),
      d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS stj_wallet_comp_team ON supporter_team_journeys (wallet, competition_id, team_id)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS stj_team_score_idx ON supporter_team_journeys (team_id, total_journey_score)"),

      // 4.12 Supporter Match Journeys
      d1.prepare(`CREATE TABLE IF NOT EXISTS supporter_match_journeys (
        wallet text NOT NULL, competition_id text NOT NULL, fixture_id text NOT NULL, team_id text NOT NULL,
        attacker_id text NOT NULL, midfielder_id text NOT NULL, defender_id text NOT NULL,
        trio_total real, opposition_benchmark real, final_match_index real,
        journey_score_before real DEFAULT 0 NOT NULL, journey_score_after real DEFAULT 0 NOT NULL,
        rank_before integer, rank_after integer,
        participation_number integer DEFAULT 1 NOT NULL, finalised_at text,
        PRIMARY KEY (wallet, fixture_id)
      )`),
      d1.prepare("CREATE INDEX IF NOT EXISTS smj_team_idx ON supporter_match_journeys (team_id, wallet)"),

      // 4.13 Supporter Journey Events
      d1.prepare(`CREATE TABLE IF NOT EXISTS supporter_journey_events (
        id integer PRIMARY KEY AUTOINCREMENT, wallet text NOT NULL,
        competition_id text NOT NULL, team_id text NOT NULL, fixture_id text,
        event_type text NOT NULL, occurred_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
        headline text NOT NULL, summary text,
        metadata_json text DEFAULT '{}' NOT NULL
      )`),
      d1.prepare("CREATE INDEX IF NOT EXISTS sje_wallet_team_idx ON supporter_journey_events (wallet, team_id)"),
    ]), DB_TIMEOUT_MS, "Batch 4 supporter journeys");

    // ── Batch 5: Milestones and Reward Claims ─────────────────────────────
    await withTimeout(d1.batch([
      d1.prepare(`CREATE TABLE IF NOT EXISTS supporter_milestones (
        id integer PRIMARY KEY AUTOINCREMENT,
        wallet text NOT NULL,
        competition_id text NOT NULL,
        team_id text NOT NULL,
        milestone_key text NOT NULL,
        unlocked_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
        fixture_id text,
        metadata_json text DEFAULT '{}' NOT NULL
      )`),
      d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS sm_wallet_comp_team_key ON supporter_milestones (wallet, competition_id, team_id, milestone_key)"),

      d1.prepare(`CREATE TABLE IF NOT EXISTS supporter_reward_claims (
        id text PRIMARY KEY NOT NULL,
        wallet text NOT NULL,
        competition_id text NOT NULL,
        team_id text NOT NULL,
        reward_tier text NOT NULL,
        eligibility_rank integer,
        status text DEFAULT 'eligible' NOT NULL,
        submitted_at text,
        fulfilled_at text,
        metadata_json text DEFAULT '{}' NOT NULL
      )`),
    ]), DB_TIMEOUT_MS, "Batch 5 milestones");

    console.log("[DB DEBUG] D1 batch table creation completed. Verifying table columns...");

    // ── Column migrations ──────────────────────────────────────────────────
    const requiredColumns: Record<string, Array<[string, string]>> = {
      fixtures: [
        ["competition_id", "text"], ["competition_name", "text"], ["participant_1_id", "text"], ["participant_2_id", "text"],
        ["data_coverage", "text DEFAULT 'unavailable' NOT NULL"], ["formula_version", "text"],
      ],
      players: [
        ["sofascore_id", "integer"],
        ["normative_id", "text"],
        ["preferred_name", "text"],
        ["display_name", "text"],
        ["primary_position", "text"],
        ["date_of_birth", "text"],
        ["country_id", "text"],
        ["photo_url", "text"],
        ["created_at", "text"],
        ["updated_at", "text"],
      ],
      lineups: [
        ["fixture_player_id", "text"],
        ["shirt_number", "integer"],
        ["source_position", "text"],
        ["normalized_position", "text"],
        ["announced_at", "text"],
        ["raw_payload", "text"],
      ],
      player_match_stats: [
        ["assists", "integer DEFAULT 0 NOT NULL"], ["chances_created", "integer DEFAULT 0 NOT NULL"],
        ["tackles", "integer DEFAULT 0 NOT NULL"], ["performance_score", "real DEFAULT 0 NOT NULL"],
        ["formula_version", "text DEFAULT 'position-v1' NOT NULL"], ["data_coverage", "text DEFAULT 'unavailable' NOT NULL"],
        ["source", "text DEFAULT 'txline-devnet' NOT NULL"],
        // New repository columns
        ["team_id", "text"],
        ["stat_position", "text"],
        ["stat_starter", "integer"],
        ["stat_official_substitute", "integer"],
        ["entered_match", "integer"],
        ["minute_on", "integer"],
        ["minute_off", "integer"],
        ["minutes_played", "integer"],
        ["clean_sheet", "integer"],
        ["defensive_actions", "integer"],
        ["shots_off_target", "integer"],
        ["shots_blocked", "integer"],
        ["shots_woodwork", "integer"],
        ["live_rating", "real"],
        ["final_rating", "real"],
        ["rating_version", "text"],
        ["available_metrics_json", "text"],
        ["stat_finalised", "integer"],
        ["recalculated_at", "text"],
      ],
      player_tournament_stats: [
        ["total_clean_sheets", "integer"],
        ["total_defensive_actions", "integer"],
      ],
      feed_events: [["action", "text DEFAULT 'unknown' NOT NULL"], ["participant", "integer"], ["event_epoch", "integer"]],
    };
    for (const [table, columns] of Object.entries(requiredColumns)) {
      console.log(`[DB DEBUG] Checking table columns for: ${table}`);
      const result = await withTimeout(
        d1.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>(),
        DB_TIMEOUT_MS,
        `PRAGMA table_info(${table})`
      );
      console.log(`[DB DEBUG] Columns in ${table}:`, JSON.stringify(result.results));
      const existing = new Set((result.results ?? []).map((column: { name: string }) => column.name));
      for (const [name, definition] of columns) {
        if (!existing.has(name)) {
          console.log(`[DB DEBUG] Altering table ${table} to add column: ${name}`);
          try {
            await d1.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run();
          } catch (e) {
            console.error(`[DB DEBUG] Failed to add column ${name} to ${table}:`, e);
          }
        }
      }
    }
    console.log("[DB DEBUG] ensureArchiveDatabase initialization complete!");
    initialized = true;
  })().catch((error) => {
    console.error("[DB DEBUG] ensureArchiveDatabase failed:", error);
    initialization = null;
    throw error;
  });
  return initialization;
}


