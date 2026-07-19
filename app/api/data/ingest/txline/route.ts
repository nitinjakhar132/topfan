import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { ensureArchiveDatabase, getDb } from "@/db";
import {
  feedEvents, fixtureSyncState, fixtures, lineups, playerMatchStats, players, teams,
  rawScoreEvents, playerExternalIds,
} from "@/db/schema";
import { createTxlineArchive } from "@/lib/txline/archive";
import { normalizeFixtures } from "@/lib/txline/normalize";

type IngestBody = { fixture?: unknown; history?: unknown; metadataOnly?: boolean };

function environment() {
  return env as unknown as { TXLINE_INGEST_SECRET?: string };
}

function authorised(request: Request) {
  const expected = environment().TXLINE_INGEST_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(expected && supplied && expected === supplied);
}

function code(name: string, id: string) {
  const prefix = name.replace(/[^a-z0-9 ]/gi, "").trim().split(/\s+/).map((word) => word[0]).join("").slice(0, 3).toUpperCase() || "TEAM";
  return `${prefix}-${id}`;
}

function chunks<T>(values: T[], size = 25) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function ingest(request: Request) {
  if (!authorised(request)) return Response.json({ error: "Invalid ingestion secret." }, { status: 401 });
  let body: IngestBody;
  try { body = await request.json() as IngestBody; } catch { return Response.json({ error: "Invalid JSON body." }, { status: 400 }); }
  const normalized = normalizeFixtures([body.fixture]);
  if (normalized.length !== 1 || (!body.metadataOnly && !Array.isArray(body.history))) {
    return Response.json({ error: "Expected one raw TxLINE fixture and its historical event array." }, { status: 400 });
  }

  const archive = createTxlineArchive(normalized[0], Array.isArray(body.history) ? body.history : []);
  const uniquePlayers = [...new Map(archive.players.map((player) => [player.id, player])).values()];
  await ensureArchiveDatabase();
  const fixture = archive.fixture;
  const db = getDb();
  const now = new Date().toISOString();
  const participantTeams = [
    { id: fixture.participant1Id, name: fixture.participant1 },
    { id: fixture.participant2Id, name: fixture.participant2 },
  ];
  for (const team of participantTeams) {
    if (team.name) {
      await db.insert(teams).values({ ...team, code: code(team.name, team.id) }).onConflictDoUpdate({
        target: teams.id,
        set: { name: team.name, code: code(team.name, team.id) },
      });
    }
  }

  const homeScore = fixture.homeTeamId === fixture.participant1Id ? fixture.participant1Score : fixture.participant2Score;
  const awayScore = fixture.awayTeamId === fixture.participant2Id ? fixture.participant2Score : fixture.participant1Score;
  const fixtureUpdate = body.metadataOnly ? {
    competitionId: fixture.competitionId || null,
    participant1Id: fixture.participant1Id,
    participant2Id: fixture.participant2Id,
    homeTeamId: fixture.homeTeamId,
    awayTeamId: fixture.awayTeamId,
    startsAt: fixture.startsAt,
    rawUpdatedAt: now,
  } : {
    competitionId: fixture.competitionId || null,
    participant1Id: fixture.participant1Id,
    participant2Id: fixture.participant2Id,
    homeTeamId: fixture.homeTeamId,
    awayTeamId: fixture.awayTeamId,
    startsAt: fixture.startsAt,
    phase: fixture.phase,
    homeScore,
    awayScore,
    finalisedAt: fixture.finalised ? now : null,
    dataCoverage: archive.coverage,
    formulaVersion: archive.formulaVersion,
    rawUpdatedAt: now,
  };
  await db.insert(fixtures).values({
    id: fixture.id,
    competitionId: fixture.competitionId || null,
    participant1Id: fixture.participant1Id,
    participant2Id: fixture.participant2Id,
    homeTeamId: fixture.homeTeamId,
    awayTeamId: fixture.awayTeamId,
    startsAt: fixture.startsAt,
    phase: fixture.phase,
    homeScore,
    awayScore,
    finalisedAt: fixture.finalised ? now : null,
    dataCoverage: archive.coverage,
    formulaVersion: archive.formulaVersion,
    rawUpdatedAt: now,
  }).onConflictDoUpdate({
    target: fixtures.id,
    set: fixtureUpdate,
  });

  if (body.metadataOnly) {
    return Response.json({ fixtureId: fixture.id, metadataOnly: true, coverage: "unavailable" });
  }

  await db.delete(lineups).where(eq(lineups.fixtureId, fixture.id));
  await db.delete(playerMatchStats).where(eq(playerMatchStats.fixtureId, fixture.id));
  await db.delete(feedEvents).where(eq(feedEvents.fixtureId, fixture.id));

  for (const player of uniquePlayers) {
    await db.insert(players).values({
      id: player.id, teamId: player.teamId, name: player.name,
      position: player.position, shirtNumber: player.number,
      sofascoreId: player.sofascoreId ?? null,
    }).onConflictDoUpdate({
      target: players.id,
      set: { teamId: player.teamId, name: player.name, position: player.position, shirtNumber: player.number, sofascoreId: player.sofascoreId ?? null },
    });
  }
  for (const batch of chunks(uniquePlayers, 12)) {
    await Promise.all(batch.map(player => db.insert(lineups).values({
      fixtureId: fixture.id, playerId: player.id, teamId: player.teamId,
      starter: player.starter, officialSubstitute: !player.starter, position: player.position,
    })));
  }
  for (const batch of chunks(uniquePlayers, 4)) {
    await Promise.all(batch.map((player) => db.insert(playerMatchStats).values({
      fixtureId: fixture.id,
      playerId: player.id,
      minutes: player.minutes,
      goals: player.goals,
      assists: player.assists,
      chancesCreated: player.chancesCreated,
      tackles: player.tackles,
      ownGoals: player.ownGoals,
      shots: player.shots,
      shotsOnTarget: player.shotsOnTarget,
      yellowCards: player.yellowCards,
      redCards: player.redCards,
      penaltyAttempts: player.penaltyAttempts,
      penaltyGoals: player.penaltyGoals,
      performanceScore: player.performanceScore,
      impactRating: player.impactRating,
      formulaVersion: player.formulaVersion,
      dataCoverage: player.dataCoverage,
      source: "txline-devnet",
      updatedAt: now,
    })));
  }

  const uniqueEvents = [...new Map(archive.events.map((event) => [event.sequence, event])).values()];
  for (const batch of chunks(uniqueEvents, 10)) {
    await Promise.all(batch.map(event => db.insert(feedEvents).values({ ...event, receivedAt: now })));
  }

  // ── Archive Raw Score Events ──
  await db.delete(rawScoreEvents).where(eq(rawScoreEvents.fixtureId, fixture.id));
  
  const rawEventsToInsert = (Array.isArray(body.history) ? body.history : []).map((rowVal: any) => {
    const row = record(rowVal);
    if (!row) return null;
    const action = stringValue(first(row, ["Action", "Type"])).toLowerCase() || "unknown";
    const data = record(first(row, ["DataSoccer", "Data"])) ?? row;
    const seq = numeric(first(row, ["Seq", "Sequence"])) || 0;
    const confirmed = stringValue(first(row, ["Status", "StatusId"])) === "confirmed" || numeric(first(row, ["StatusId"])) === 100;
    
    return {
      fixtureId: fixture.id,
      sequence: seq,
      eventId: stringValue(first(row, ["EventId", "Id"])),
      eventTimestamp: stringValue(first(row, ["Timestamp", "Epoch"])),
      action,
      confirmed,
      participantId: stringValue(first(row, ["Participant"])),
      playerId: stringValue(first(data, ["PlayerId", "PlayerInId", "PlayerOutId"])),
      playerInId: stringValue(first(data, ["PlayerInId"])),
      playerOutId: stringValue(first(data, ["PlayerOutId"])),
      matchMinute: numeric(first(data, ["Minutes", "Minute"])),
      supersededBySequence: numeric(first(row, ["SupersededBySequence"])),
      rawPayload: JSON.stringify(rowVal),
      ingestedAt: now,
    };
  }).filter((x): x is Exclude<typeof x, null> => x !== null);

  for (const batch of chunks(rawEventsToInsert, 25)) {
    await Promise.all(batch.map(item => db.insert(rawScoreEvents).values(item)));
  }

  // Set up player external mappings
  for (const player of uniquePlayers) {
    await db.insert(playerExternalIds).values({
      source: "txline",
      externalId: player.id,
      playerId: player.id,
      firstSeenFixtureId: fixture.id,
      lastSeenFixtureId: fixture.id,
    }).onConflictDoUpdate({
      target: [playerExternalIds.source, playerExternalIds.externalId],
      set: { lastSeenFixtureId: fixture.id },
    });
  }

  await db.insert(fixtureSyncState).values({
    fixtureId: fixture.id,
    lastSequence: archive.lastSequence,
    eventCount: uniqueEvents.length,
    playerCount: uniquePlayers.length,
    attributedEventCount: archive.attributedEventCount,
    dataCoverage: archive.coverage,
    historicalFetchedAt: now,
    reconciledAt: fixture.finalised ? now : null,
    finalised: fixture.finalised,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: fixtureSyncState.fixtureId,
    set: {
      lastSequence: archive.lastSequence,
      eventCount: uniqueEvents.length,
      playerCount: uniquePlayers.length,
      attributedEventCount: archive.attributedEventCount,
      dataCoverage: archive.coverage,
      historicalFetchedAt: now,
      reconciledAt: fixture.finalised ? now : null,
      finalised: fixture.finalised,
      lastError: null,
      updatedAt: now,
    },
  });

  // Trigger incremental player repository stats recalculation
  const competitionId = fixture.competitionId || "worldcup2026";
  try {
    const { updateIncrementalStats } = await import("@/lib/player-repository/repository");
    await updateIncrementalStats(fixture.id, competitionId, fixture.finalised);
  } catch (error) {
    console.error("[Incremental Update] Failed to update player repository stats:", error);
  }

  return Response.json({
    fixtureId: fixture.id,
    players: uniquePlayers.length,
    events: uniqueEvents.length,
    attributedEvents: archive.attributedEventCount,
    coverage: archive.coverage,
    finalised: fixture.finalised,
    formulaVersion: archive.formulaVersion,
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function first(source: Record<string, unknown> | null, keys: string[]) {
  if (!source) return undefined;
  for (const key of keys) if (source[key] !== undefined && source[key] !== null) return source[key];
  return undefined;
}

function stringValue(value: unknown) {
  return value === undefined || value === null ? "" : String(value);
}

function numeric(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function POST(request: Request) {
  try {
    return await ingest(request);
  } catch (error) {
    const base = error instanceof Error ? error : new Error(String(error));
    const cause = base.cause instanceof Error ? base.cause.message : base.cause ? String(base.cause) : "";
    const message = cause ? `${base.message} | Cause: ${cause}` : base.message;
    console.error("TxLINE ingestion failed", error);
    try { require("fs").appendFileSync("scratch/ingest-error.txt", message + "\n"); } catch (e) {}
    return Response.json({ error: message }, { status: 500 });
  }
}

