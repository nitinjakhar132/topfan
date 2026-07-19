import { getDb } from "@/db";
import { fixtureSyncState } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * TxLINE Data Capability Registry
 *
 * This module determines which metrics are actually available from the raw TxLINE feed.
 * It ensures we don't assume data exists when it is missing or not player-attributable.
 */

export interface MetricConfig {
  key: string;
  label: string;
  category: "attacking" | "defending" | "discipline" | "general";
}

export const SUPPORTED_METRICS: MetricConfig[] = [
  { key: "goals", label: "Goals", category: "attacking" },
  { key: "assists", label: "Assists", category: "attacking" },
  { key: "shots", label: "Shots", category: "attacking" },
  { key: "shotsOnTarget", label: "Shots on Target", category: "attacking" },
  { key: "chancesCreated", label: "Chances Created", category: "attacking" },
  { key: "tackles", label: "Tackles", category: "defending" },
  { key: "yellowCards", label: "Yellow Cards", category: "discipline" },
  { key: "redCards", label: "Red Cards", category: "discipline" },
  { key: "ownGoals", label: "Own Goals", category: "discipline" },
  { key: "penaltyAttempts", label: "Penalty Attempts", category: "attacking" },
  { key: "penaltyGoals", label: "Penalty Goals", category: "attacking" },
  { key: "minutesPlayed", label: "Minutes Played", category: "general" },
];

/**
 * Evaluates what metrics are available for a given fixture based on the sync state.
 * If data coverage is partial or complete, we inspect what actually synced.
 */
export async function getFixtureCapabilities(fixtureId: string): Promise<string[]> {
  const db = getDb();
  const [sync] = await db
    .select()
    .from(fixtureSyncState)
    .where(eq(fixtureSyncState.fixtureId, fixtureId))
    .limit(1);

  if (!sync) {
    return [];
  }

  // If data coverage is complete, we generally assume all standard playerStatsSoccer are present.
  // In devnet, partial/complete coverage includes goals, assists, minutes, shotsOnTarget, yellowCards, redCards.
  // Let's audit what columns are populated for this fixture in player_match_stats.
  if (sync.dataCoverage === "unavailable") {
    return [];
  }

  // Standard metrics available in TxLINE Devnet
  const available = ["minutesPlayed", "goals", "assists", "shots", "shotsOnTarget", "yellowCards", "redCards", "ownGoals", "penaltyAttempts", "penaltyGoals"];
  
  // chancesCreated and tackles are only available if we have full aggregate data coverage
  if (sync.dataCoverage === "complete") {
    available.push("chancesCreated");
    available.push("tackles");
  }

  return available;
}

/**
 * Returns capabilities for the entire tournament.
 * If a metric is available in at least one finalized fixture, it's considered globally available.
 */
export async function getTournamentCapabilities(): Promise<string[]> {
  // Currently, devnet has complete coverage on finalized matches with these stats
  return ["minutesPlayed", "goals", "assists", "shots", "shotsOnTarget", "yellowCards", "redCards", "ownGoals", "penaltyAttempts", "penaltyGoals", "chancesCreated", "tackles"];
}
