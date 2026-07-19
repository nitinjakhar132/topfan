import { getDb } from "@/db";
import { playerMatchEvents, rawScoreEvents } from "@/db/schema";
import { resolvePlayerId } from "./identity";
import { eq, and } from "drizzle-orm";

/**
 * Event Normalizer
 *
 * Extracts raw events from the TxLINE payload, filters out unconfirmed
 * or superseded events, resolves player IDs, and maps them to clean
 * normalized player_match_events.
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

function stringValue(value: unknown) {
  return value === undefined || value === null ? "" : String(value);
}

function numericValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function normalizeFixtureEvents(fixtureId: string): Promise<number> {
  const db = getDb();

  // 1. Fetch raw events
  const rawEvents = await db
    .select()
    .from(rawScoreEvents)
    .where(eq(rawScoreEvents.fixtureId, fixtureId));

  if (!rawEvents.length) return 0;

  // Clear existing normalized events for this fixture to ensure idempotency
  await db.delete(playerMatchEvents).where(eq(playerMatchEvents.fixtureId, fixtureId));

  // Determine superseded sequences (if any sequence has a supersededBySequence, we exclude it)
  const supersededSequences = new Set<number>();
  for (const raw of rawEvents) {
    if (raw.supersededBySequence) {
      supersededSequences.add(raw.sequence);
    }
  }

  let normalizedCount = 0;

  for (const raw of rawEvents) {
    if (supersededSequences.has(raw.sequence)) continue;
    if (raw.confirmed === false) continue; // Only process confirmed events

    let payload: UnknownRecord | null = null;
    try {
      payload = record(JSON.parse(raw.rawPayload));
    } catch {
      continue;
    }

    const action = stringValue(first(payload, ["Action", "action", "Type", "type"])).toLowerCase();
    const dataSoccer = record(first(payload, ["DataSoccer", "dataSoccer"]));
    const data = record(first(payload, ["Data", "data"]));
    const details = dataSoccer ?? data;

    if (!action || !details) continue;

    // Resolve player ID
    const rawPlayerId = stringValue(first(details, ["PlayerId", "playerId", "FixturePlayerId", "fixturePlayerId"]));
    const stablePlayerId = await resolvePlayerId(rawPlayerId, "txline");
    
    if (!stablePlayerId) continue;

    const teamId = stringValue(first(details, ["TeamId", "teamId", "ParticipantId", "participantId"]));
    const matchMinute = numericValue(first(details, ["Minutes", "minutes", "Minute", "minute"])) ?? 0;
    const outcome = stringValue(first(details, ["Outcome", "outcome"])).toLowerCase() || null;

    let eventType: string = "";
    let eventSubtype: string | null = null;

    if (action === "goal") {
      eventType = "goal";
      eventSubtype = stringValue(first(details, ["GoalType", "goalType"])).toLowerCase() || "regular";
    } else if (action === "own_goal") {
      eventType = "own_goal";
    } else if (action === "yellow_card") {
      eventType = "yellow_card";
    } else if (action === "red_card" || action === "second_yellow_card") {
      eventType = "red_card";
    } else if (action === "shot") {
      if (outcome === "ontarget") {
        eventType = "shot_on_target";
      } else if (outcome === "offtarget") {
        eventType = "shot_off_target";
      } else if (outcome === "blocked") {
        eventType = "shot_blocked";
      } else if (outcome === "woodwork") {
        eventType = "shot_woodwork";
      } else {
        eventType = "shot_off_target"; // Fallback
      }
    } else if (action === "penalty") {
      if (outcome === "scored") {
        eventType = "penalty_scored";
      } else {
        eventType = "penalty_missed";
      }
    } else if (action === "substitution") {
      // For a substitution event, both PlayerIn and PlayerOut could be mapped
      const inRaw = stringValue(first(details, ["PlayerInId", "playerInId"]));
      const outRaw = stringValue(first(details, ["PlayerOutId", "playerOutId"]));

      const resolvedIn = await resolvePlayerId(inRaw, "txline");
      const resolvedOut = await resolvePlayerId(outRaw, "txline");

      if (resolvedIn === stablePlayerId) {
        eventType = "substitution_on";
      } else if (resolvedOut === stablePlayerId) {
        eventType = "substitution_off";
      } else {
        continue; // Unattributable player sub
      }
    } else {
      // Unsupported or unneeded event type
      continue;
    }

    await db.insert(playerMatchEvents).values({
      fixtureId,
      playerId: stablePlayerId,
      teamId: teamId || raw.participantId || "",
      eventType,
      eventSubtype,
      matchMinute,
      outcome,
      confirmed: true,
      sourceSequence: raw.sequence,
      metadataJson: JSON.stringify(details),
    });

    normalizedCount++;
  }

  return normalizedCount;
}
