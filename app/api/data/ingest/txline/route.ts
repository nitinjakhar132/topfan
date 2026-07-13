import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { ensureArchiveDatabase, getDb } from "@/db";
import {
  feedEvents, fixtureSyncState, fixtures, lineups, playerMatchStats, players, teams,
} from "@/db/schema";
import { createTxlineArchive } from "@/lib/txline/archive";
import { normalizeFixtures } from "@/lib/txline/normalize";

type IngestBody = { fixture?: unknown; history?: unknown };

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
  if (normalized.length !== 1 || !Array.isArray(body.history)) {
    return Response.json({ error: "Expected one raw TxLINE fixture and its historical event array." }, { status: 400 });
  }

  const archive = createTxlineArchive(normalized[0], body.history);
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
    await db.insert(teams).values({ ...team, code: code(team.name, team.id) }).onConflictDoUpdate({
      target: teams.id,
      set: { name: team.name, code: code(team.name, team.id) },
    });
  }

  const homeScore = fixture.homeTeamId === fixture.participant1Id ? fixture.participant1Score : fixture.participant2Score;
  const awayScore = fixture.awayTeamId === fixture.participant2Id ? fixture.participant2Score : fixture.participant1Score;
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
    set: {
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
    },
  });

  await db.delete(lineups).where(eq(lineups.fixtureId, fixture.id));
  await db.delete(playerMatchStats).where(eq(playerMatchStats.fixtureId, fixture.id));
  await db.delete(feedEvents).where(eq(feedEvents.fixtureId, fixture.id));

  for (const player of uniquePlayers) {
    await db.insert(players).values({
      id: player.id, teamId: player.teamId, name: player.name,
      position: player.position, shirtNumber: player.number,
    }).onConflictDoUpdate({
      target: players.id,
      set: { teamId: player.teamId, name: player.name, position: player.position, shirtNumber: player.number },
    });
  }
  for (const batch of chunks(uniquePlayers, 12)) {
    await db.insert(lineups).values(batch.map((player) => ({
      fixtureId: fixture.id, playerId: player.id, teamId: player.teamId,
      starter: player.starter, officialSubstitute: !player.starter, position: player.position,
    })));
  }
  for (const batch of chunks(uniquePlayers, 4)) {
    await db.insert(playerMatchStats).values(batch.map((player) => ({
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
    await db.insert(feedEvents).values(batch.map((event) => ({ ...event, receivedAt: now })));
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

export async function POST(request: Request) {
  try {
    return await ingest(request);
  } catch (error) {
    const base = error instanceof Error ? error : new Error(String(error));
    const cause = base.cause instanceof Error ? base.cause.message : base.cause ? String(base.cause) : "";
    const message = cause ? `${base.message} | Cause: ${cause}` : base.message;
    console.error("TxLINE ingestion failed", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
