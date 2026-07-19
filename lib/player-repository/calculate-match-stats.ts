import { getDb } from "@/db";
import {
  lineups as lineupsTable,
  playerMatchEvents,
  playerMatchStats,
  feedEvents,
  fixtures,
} from "@/db/schema";
import { getFixtureCapabilities } from "./capabilities";
import { eq, and } from "drizzle-orm";

/**
 * Player Match Statistics Reconstructor
 *
 * Reconstructs each player's per-match stats (starter/sub status, entry/exit minutes,
 * minutes played, goals, assists, cards, shots etc.) using lineups and normalized
 * events.
 *
 * Merges raw event-based reconstruction with TxLINE's aggregated playerStatsSoccer
 * when available.
 */

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function first(source: UnknownRecord | null, keys: string[]) {
  if (!source) return undefined;
  for (const key of keys) if (source[key] !== undefined && source[key] !== null) return source[key];
  return undefined;
}

function statNumber(stats: UnknownRecord | null, aliases: string[]): number {
  if (!stats) return 0;
  const val = first(stats, aliases);
  const parsed = typeof val === "number" ? val : Number(val);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function reconstructFixtureMatchStats(fixtureId: string): Promise<number> {
  const db = getDb();

  // 1. Fetch fixture metadata to check finalization state
  const [fixture] = await db
    .select()
    .from(fixtures)
    .where(eq(fixtures.id, fixtureId))
    .limit(1);

  if (!fixture) return 0;

  const isFinalised = fixture.phase === "final" || fixture.finalisedAt !== null;

  // 2. Load official lineup rows
  const lineups = await db
    .select()
    .from(lineupsTable)
    .where(eq(lineupsTable.fixtureId, fixtureId));

  if (!lineups.length) return 0;

  // 3. Load normalized events
  const events = await db
    .select()
    .from(playerMatchEvents)
    .where(eq(playerMatchEvents.fixtureId, fixtureId));

  // 4. Retrieve TxLINE's aggregated playerStatsSoccer if present in feed_events
  const feedRows = await db
    .select()
    .from(feedEvents)
    .where(eq(feedEvents.fixtureId, fixtureId));

  const aggregatePlayerStats = new Map<string, UnknownRecord>();

  // Helper to map temporary lineup player IDs to stable player IDs
  const lineupIdMap = new Map(lineups.map(l => [l.fixturePlayerId || l.playerId, l.playerId]));

  for (const row of feedRows) {
    let parsed: UnknownRecord | null = null;
    try { parsed = record(JSON.parse(row.payload)); } catch { continue; }
    const pss = record(first(parsed, ["playerStatsSoccer", "PlayerStatsSoccer"]));
    if (!pss) continue;

    for (const sideKey of ["Participant1", "participant1", "Participant2", "participant2"]) {
      const side = record(pss[sideKey]);
      if (!side) continue;
      for (const [rawId, playerValue] of Object.entries(side)) {
        const playerStats = record(playerValue);
        if (!playerStats) continue;

        // Resolve stable ID
        const stableId = lineupIdMap.get(rawId) || rawId;
        aggregatePlayerStats.set(stableId, playerStats);
      }
    }
  }

  // 5. Get available metrics registry
  const availableMetrics = await getFixtureCapabilities(fixtureId);

  // 6. Delete existing match stats for this fixture to ensure idempotency
  await db.delete(playerMatchStats).where(eq(playerMatchStats.fixtureId, fixtureId));

  let count = 0;

  for (const lineup of lineups) {
    const pEvents = events.filter(e => e.playerId === lineup.playerId);
    const aggStats = aggregatePlayerStats.get(lineup.playerId);

    const isStarter = lineup.starter;
    const isSub = lineup.officialSubstitute;

    // A. Reconstruct minutes played
    let enteredMatch = isStarter;
    let minuteOn: number | null = isStarter ? 0 : null;
    let minuteOff: number | null = null;
    let minutesPlayed = 0;

    const subOnEvent = pEvents.find(e => e.eventType === "substitution_on");
    const subOffEvent = pEvents.find(e => e.eventType === "substitution_off");

    if (isStarter) {
      if (subOffEvent) {
        minuteOff = subOffEvent.matchMinute;
        minutesPlayed = subOffEvent.matchMinute ?? 90;
      } else {
        minutesPlayed = 90; // Default completed match
      }
    } else if (isSub) {
      if (subOnEvent) {
        enteredMatch = true;
        minuteOn = subOnEvent.matchMinute;
        if (subOffEvent) {
          minuteOff = subOffEvent.matchMinute;
          minutesPlayed = Math.max(0, (subOffEvent.matchMinute ?? 90) - (subOnEvent.matchMinute ?? 0));
        } else {
          minutesPlayed = Math.max(0, 90 - (subOnEvent.matchMinute ?? 0));
        }
      } else {
        enteredMatch = false;
        minutesPlayed = 0;
      }
    }

    // B. Reconstruct raw event counts
    let goals = pEvents.filter(e => e.eventType === "goal").length;
    let ownGoals = pEvents.filter(e => e.eventType === "own_goal").length;
    let shotsOnTarget = pEvents.filter(e => e.eventType === "shot_on_target").length;
    let shotsOffTarget = pEvents.filter(e => e.eventType === "shot_off_target").length;
    let shotsBlocked = pEvents.filter(e => e.eventType === "shot_blocked").length;
    let shotsWoodwork = pEvents.filter(e => e.eventType === "shot_woodwork").length;
    let shots = goals + shotsOnTarget + shotsOffTarget + shotsBlocked + shotsWoodwork;
    
    let yellowCards = pEvents.filter(e => e.eventType === "yellow_card").length;
    let redCards = pEvents.filter(e => e.eventType === "red_card").length;
    let penaltyGoals = pEvents.filter(e => e.eventType === "penalty_scored").length;
    let penaltyAttempts = penaltyGoals + pEvents.filter(e => e.eventType === "penalty_missed").length;
    
    let assists = 0; // Assists are generally aggregate stats only
    let chancesCreated = 0;
    let tackles = 0;
    let cleanSheet = false;
    let defensiveActions = 0;

    // C. Override with aggregate stats if available (and valid)
    if (aggStats) {
      minutesPlayed = statNumber(aggStats, ["Minutes", "MinutesPlayed"]) || minutesPlayed;
      goals = statNumber(aggStats, ["Goals"]) || goals;
      assists = statNumber(aggStats, ["Assists"]) || assists;
      chancesCreated = statNumber(aggStats, ["ChancesCreated", "Chances", "KeyPasses"]) || chancesCreated;
      tackles = statNumber(aggStats, ["Tackles", "SuccessfulTackles"]) || tackles;
      shots = statNumber(aggStats, ["Shots", "TotalShots"]) || shots;
      shotsOnTarget = statNumber(aggStats, ["ShotsOnTarget", "ShotsOT"]) || shotsOnTarget;
      yellowCards = statNumber(aggStats, ["YellowCards"]) || yellowCards;
      redCards = statNumber(aggStats, ["RedCards"]) || redCards;
      ownGoals = statNumber(aggStats, ["OwnGoals"]) || ownGoals;
      penaltyAttempts = statNumber(aggStats, ["PenaltyAttempts"]) || penaltyAttempts;
      penaltyGoals = statNumber(aggStats, ["PenaltyGoals"]) || penaltyGoals;
      cleanSheet = statNumber(aggStats, ["CleanSheet", "CleanSheets"]) > 0;
      defensiveActions = statNumber(aggStats, ["DefensiveActions", "Clearances", "Interceptions"]) || defensiveActions;
    }

    // Set unsupported metrics to default 0/null values safely for SQLite NOT NULL constraints
    const getOrDefault = (metric: string, value: number, fallback = 0) => {
      return availableMetrics.includes(metric) ? value : fallback;
    };

    await db.insert(playerMatchStats).values({
      fixtureId,
      playerId: lineup.playerId,
      teamId: lineup.teamId,
      position: lineup.position,
      starter: isStarter,
      officialSubstitute: isSub,
      enteredMatch,
      minuteOn,
      minuteOff,
      minutesPlayed,

      // Existing NOT NULL columns (reconstructed or default to 0)
      minutes: getOrDefault("minutesPlayed", minutesPlayed),
      goals: getOrDefault("goals", goals),
      assists: getOrDefault("assists", assists),
      shots: getOrDefault("shots", shots),
      shotsOnTarget: getOrDefault("shotsOnTarget", shotsOnTarget),
      chancesCreated: getOrDefault("chancesCreated", chancesCreated),
      tackles: getOrDefault("tackles", tackles),
      yellowCards: getOrDefault("yellowCards", yellowCards),
      redCards: getOrDefault("redCards", redCards),
      ownGoals: getOrDefault("ownGoals", ownGoals),
      penaltyAttempts: getOrDefault("penaltyAttempts", penaltyAttempts),
      penaltyGoals: getOrDefault("penaltyGoals", penaltyGoals),

      // New repository columns
      cleanSheet,
      defensiveActions,
      shotsOffTarget,
      shotsBlocked,
      shotsWoodwork,
      formulaVersion: "position-v1",
      dataCoverage: fixture.dataCoverage,
      source: "txline-devnet",
      finalised: isFinalised,
      availableMetricsJson: JSON.stringify(availableMetrics),
      updatedAt: new Date().toISOString(),
    });

    count++;
  }

  return count;
}
