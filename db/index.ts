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

export async function ensureArchiveDatabase() {
  if (initialization) return initialization;
  initialization = (async () => {
    console.log("[DB DEBUG] ensureArchiveDatabase: starting initialization...");
    const d1 = env.DB;
    if (!d1) {
      console.error("[DB DEBUG] env.DB is unavailable!");
      throw new Error("Cloudflare D1 binding `DB` is unavailable.");
    }
    console.log("[DB DEBUG] Running D1 batch table creation...");
    await d1.batch([
      d1.prepare("CREATE TABLE IF NOT EXISTS teams (id text PRIMARY KEY NOT NULL, name text NOT NULL, code text NOT NULL, flag text DEFAULT '' NOT NULL, eliminated_at text)"),
      d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS teams_code_unique ON teams (code)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS fixtures (id text PRIMARY KEY NOT NULL, competition_id text, competition_name text, participant_1_id text, participant_2_id text, home_team_id text NOT NULL, away_team_id text NOT NULL, starts_at text NOT NULL, phase text DEFAULT 'scheduled' NOT NULL, home_score integer, away_score integer, finalised_at text, data_coverage text DEFAULT 'unavailable' NOT NULL, formula_version text, raw_updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS fixtures_starts_at_idx ON fixtures (starts_at)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS players (id text PRIMARY KEY NOT NULL, team_id text NOT NULL, name text NOT NULL, position text NOT NULL, shirt_number integer)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS lineups (fixture_id text NOT NULL, player_id text NOT NULL, team_id text NOT NULL, starter integer NOT NULL, official_substitute integer NOT NULL, position text NOT NULL, PRIMARY KEY (fixture_id, player_id))"),
      d1.prepare("CREATE TABLE IF NOT EXISTS player_match_stats (fixture_id text NOT NULL, player_id text NOT NULL, minutes integer DEFAULT 0 NOT NULL, goals integer DEFAULT 0 NOT NULL, assists integer DEFAULT 0 NOT NULL, chances_created integer DEFAULT 0 NOT NULL, tackles integer DEFAULT 0 NOT NULL, own_goals integer DEFAULT 0 NOT NULL, shots integer DEFAULT 0 NOT NULL, shots_on_target integer DEFAULT 0 NOT NULL, yellow_cards integer DEFAULT 0 NOT NULL, red_cards integer DEFAULT 0 NOT NULL, penalty_attempts integer DEFAULT 0 NOT NULL, penalty_goals integer DEFAULT 0 NOT NULL, performance_score real DEFAULT 0 NOT NULL, impact_rating real DEFAULT 6 NOT NULL, formula_version text DEFAULT 'position-v1' NOT NULL, data_coverage text DEFAULT 'unavailable' NOT NULL, source text DEFAULT 'txline-devnet' NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, PRIMARY KEY (fixture_id, player_id))"),
      d1.prepare("CREATE TABLE IF NOT EXISTS feed_events (fixture_id text NOT NULL, sequence integer NOT NULL, action text DEFAULT 'unknown' NOT NULL, participant integer, event_epoch integer, payload text NOT NULL, status text DEFAULT 'confirmed' NOT NULL, received_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, PRIMARY KEY (fixture_id, sequence))"),
      d1.prepare("CREATE TABLE IF NOT EXISTS fixture_sync_state (fixture_id text PRIMARY KEY NOT NULL, source text DEFAULT 'txline-devnet' NOT NULL, last_sequence integer DEFAULT 0 NOT NULL, event_count integer DEFAULT 0 NOT NULL, player_count integer DEFAULT 0 NOT NULL, attributed_event_count integer DEFAULT 0 NOT NULL, data_coverage text DEFAULT 'unavailable' NOT NULL, historical_fetched_at text, reconciled_at text, finalised integer DEFAULT false NOT NULL, last_error text, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)"),
    ]);
    console.log("[DB DEBUG] D1 batch table creation completed. Verifying table columns...");

    const requiredColumns: Record<string, Array<[string, string]>> = {
      fixtures: [
        ["competition_id", "text"], ["competition_name", "text"], ["participant_1_id", "text"], ["participant_2_id", "text"],
        ["data_coverage", "text DEFAULT 'unavailable' NOT NULL"], ["formula_version", "text"],
      ],
      player_match_stats: [
        ["assists", "integer DEFAULT 0 NOT NULL"], ["chances_created", "integer DEFAULT 0 NOT NULL"],
        ["tackles", "integer DEFAULT 0 NOT NULL"], ["performance_score", "real DEFAULT 0 NOT NULL"],
        ["formula_version", "text DEFAULT 'position-v1' NOT NULL"], ["data_coverage", "text DEFAULT 'unavailable' NOT NULL"],
        ["source", "text DEFAULT 'txline-devnet' NOT NULL"],
      ],
      feed_events: [["action", "text DEFAULT 'unknown' NOT NULL"], ["participant", "integer"], ["event_epoch", "integer"]],
    };
    for (const [table, columns] of Object.entries(requiredColumns)) {
      console.log(`[DB DEBUG] Checking table columns for: ${table}`);
      const result = await d1.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
      const existing = new Set((result.results ?? []).map((column) => column.name));
      for (const [name, definition] of columns) {
        if (!existing.has(name)) {
          console.log(`[DB DEBUG] Altering table ${table} to add column: ${name}`);
          await d1.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run();
        }
      }
    }
    console.log("[DB DEBUG] ensureArchiveDatabase initialization complete!");
  })().catch((error) => {
    console.error("[DB DEBUG] ensureArchiveDatabase failed:", error);
    initialization = null;
    throw error;
  });
  return initialization;
}
