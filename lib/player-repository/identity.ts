import { getDb } from "@/db";
import { playerExternalIds, players } from "@/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * Stable Player Identity Resolver
 *
 * Maps temporary or fixture-specific player identifiers to a single, stable
 * tournament-wide player record, preventing duplicate records across fixtures.
 */

export async function resolvePlayerId(
  externalId: string,
  source: string = "txline"
): Promise<string | null> {
  if (!externalId) return null;

  const db = getDb();
  const [mapping] = await db
    .select()
    .from(playerExternalIds)
    .where(
      and(
        eq(playerExternalIds.source, source),
        eq(playerExternalIds.externalId, externalId)
      )
    )
    .limit(1);

  if (mapping) {
    return mapping.playerId;
  }

  // Fallback: Check if the ID matches a player primary key directly
  const [player] = await db
    .select()
    .from(players)
    .where(eq(players.id, externalId))
    .limit(1);

  return player ? player.id : null;
}

export async function getOrCreatePlayer(
  data: {
    id: string; // The primary ID provided by the lineup/event
    teamId: string;
    name: string;
    position: "ATT" | "MID" | "DEF" | "GK" | "OTHER";
    shirtNumber?: number | null;
    sofascoreId?: number | null;
    fixtureId?: string;
  }
): Promise<string> {
  const db = getDb();

  // Try to resolve using normative ID / sofascore ID first if available
  let stableId: string | null = null;

  if (data.sofascoreId) {
    const [normativePlayer] = await db
      .select()
      .from(players)
      .where(eq(players.sofascoreId, data.sofascoreId))
      .limit(1);

    if (normativePlayer) {
      stableId = normativePlayer.id;
    }
  }

  // Resolve external mapping
  if (!stableId) {
    stableId = await resolvePlayerId(data.id, "txline");
  }

  const now = new Date().toISOString();

  if (!stableId) {
    // We need to create a new stable player
    // We will use the provided ID as the stable ID
    stableId = data.id;

    await db.insert(players).values({
      id: stableId,
      teamId: data.teamId,
      name: data.name,
      displayName: data.name,
      preferredName: data.name,
      position: data.position,
      primaryPosition: data.position,
      shirtNumber: data.shirtNumber ?? null,
      sofascoreId: data.sofascoreId ?? null,
      createdAt: now,
      updatedAt: now,
    });

    // Map this ID to itself
    await db.insert(playerExternalIds).values({
      source: "txline",
      externalId: data.id,
      playerId: stableId,
      firstSeenFixtureId: data.fixtureId ?? null,
      lastSeenFixtureId: data.fixtureId ?? null,
    });

    if (data.sofascoreId) {
      // Also map sofascore ID
      await db.insert(playerExternalIds).values({
        source: "sofascore",
        externalId: String(data.sofascoreId),
        playerId: stableId,
        firstSeenFixtureId: data.fixtureId ?? null,
        lastSeenFixtureId: data.fixtureId ?? null,
      }).onConflictDoNothing();
    }
  } else {
    // Player exists, update their latest metadata and mapping info
    await db
      .update(players)
      .set({
        name: data.name,
        shirtNumber: data.shirtNumber !== undefined ? (data.shirtNumber ?? null) : undefined,
        sofascoreId: data.sofascoreId !== undefined ? (data.sofascoreId ?? null) : undefined,
        updatedAt: now,
      })
      .where(eq(players.id, stableId));

    // Update mapping last seen fixture
    if (data.fixtureId) {
      await db
        .update(playerExternalIds)
        .set({ lastSeenFixtureId: data.fixtureId })
        .where(
          and(
            eq(playerExternalIds.source, "txline"),
            eq(playerExternalIds.externalId, data.id)
          )
        );
    }
  }

  return stableId;
}

export function normalizePlayerName(rawName: string): string {
  if (!rawName) return "";
  if (!rawName.includes(",")) return rawName.trim();
  const parts = rawName.split(",");
  if (parts.length < 2) return rawName.trim();
  const first = parts[1].trim();
  const lastParts = parts[0].trim().split(/\s+/);
  const last = lastParts[0]; // Take first last name word
  return `${first} ${last}`;
}
