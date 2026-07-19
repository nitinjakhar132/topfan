/**
 * GET /api/live/fixtures/:fixtureId/replay
 *
 * SSE endpoint that streams replay events from archived TxLINE data.
 * Events are processed through the same rating engine and narrator pipeline.
 *
 * Query params:
 *   speed=1|5|20 (default: 5)
 *   wallet=<wallet> (to identify user's trio)
 *
 * All events are labelled with mode: "replay".
 */

import { eq, and } from "drizzle-orm";
import { ensureArchiveDatabase, getDb } from "@/db";
import {
  fixtures,
  lineups,
  playerMatchStats,
  players,
  rawScoreEvents,
  picks,
  teams,
} from "@/db/schema";
import { LiveRatingEngine } from "@/lib/live/rating-engine";
import { getFixtureScores } from "@/lib/live/scores";
import {
  calculateOppositionBenchmark,
  hasBenchmarkChanged,
  getOppositionParticipantId,
} from "@/lib/live/benchmark";
import { narrateEvent } from "@/lib/live/narrator";
import { normalizeRawEvent } from "@/lib/live/replay-controller";
import type {
  LivePlayerState,
  GamePhaseId,
  UserTrio,
  OppositionBenchmark,
  ClientLiveEvent,
  ReplaySpeed,
} from "@/lib/live/types";
import { serializeFixtureState } from "@/lib/live/types";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ fixtureId: string }> },
) {
  const { fixtureId } = await context.params;
  const url = new URL(request.url);
  const speed = Math.min(20, Math.max(1, parseInt(url.searchParams.get("speed") ?? "5"))) as ReplaySpeed;
  const wallet = url.searchParams.get("wallet");

  await ensureArchiveDatabase();
  const db = getDb();

  // Load fixture data
  const [dbFixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId)).limit(1);
  if (!dbFixture) {
    return new Response("Fixture not found", { status: 404 });
  }

  const { homeScore, awayScore } = getFixtureScores(fixtureId, dbFixture.homeScore, dbFixture.awayScore);
  const fixture = {
    ...dbFixture,
    homeScore,
    awayScore,
  };

  const [teamRows, lineupRows, statRows, playerRows, eventRows] = await Promise.all([
    db.select().from(teams),
    db.select().from(lineups).where(eq(lineups.fixtureId, fixtureId)),
    db.select().from(playerMatchStats).where(eq(playerMatchStats.fixtureId, fixtureId)),
    db.select().from(players),
    db.select().from(rawScoreEvents).where(eq(rawScoreEvents.fixtureId, fixtureId)),
  ]);

  if (eventRows.length === 0) {
    return new Response("No replay data available for this fixture", { status: 404 });
  }

  // Build player maps
  const playerMap = new Map(playerRows.map((p) => [p.id, p]));

  // Initialize rating engine
  const engine = new LiveRatingEngine();
  const fixturePlayersMap = new Map<string, LivePlayerState>();

  for (const lineup of lineupRows) {
    const player = playerMap.get(lineup.playerId);
    const position = (lineup.position as "ATT" | "MID" | "DEF" | "GK" | "OTHER") ?? "OTHER";
    const participantId = lineup.teamId === fixture.homeTeamId ? "1" : "2";
    const name = player?.preferredName ?? player?.name ?? lineup.playerId;

    engine.initPlayer(lineup.playerId, name, position, participantId, 6.0, lineup.starter);
    fixturePlayersMap.set(lineup.playerId, {
      playerId: lineup.playerId,
      playerName: name,
      position,
      participantId,
      rating: 6.0,
      eventHistory: [],
      isSubstitutedOut: false,
      enteredMatch: lineup.starter,
      shirtNumber: lineup.shirtNumber,
      photoUrl: player?.photoUrl ?? null,
      starter: lineup.starter,
      officialSubstitute: lineup.officialSubstitute,
    });
  }

  // Resolve user's trio
  let userTrio: UserTrio = {
    attackerId: "",
    midfielderId: "",
    defenderId: "",
    teamId: fixture.homeTeamId,
  };

  if (wallet) {
    const [pick] = await db
      .select()
      .from(picks)
      .where(and(eq(picks.fixtureId, fixtureId), eq(picks.wallet, wallet)))
      .limit(1);
    if (pick) {
      userTrio = {
        attackerId: pick.attackerId,
        midfielderId: pick.midfielderId,
        defenderId: pick.defenderId,
        teamId: pick.teamId,
      };
    }
  }

  // If no trio, auto-pick highest rated ATT/MID/DEF from home team
  if (!userTrio.attackerId) {
    const homeLineups = lineupRows.filter((l) => l.teamId === fixture.homeTeamId);
    for (const lineup of homeLineups) {
      const pos = lineup.position;
      if (pos === "ATT" && !userTrio.attackerId) userTrio.attackerId = lineup.playerId;
      if (pos === "MID" && !userTrio.midfielderId) userTrio.midfielderId = lineup.playerId;
      if (pos === "DEF" && !userTrio.defenderId) userTrio.defenderId = lineup.playerId;
    }
  }

  const oppositionParticipantId = getOppositionParticipantId(
    userTrio.teamId,
    fixture.participant1Id ?? fixture.homeTeamId,
    fixture.participant2Id ?? fixture.awayTeamId,
  );



  // Build player alias mapping (NormativeId -> FixturePlayerId) from event logs
  const aliases = new Map<string, string>();
  for (const row of eventRows) {
    try {
      const payload = JSON.parse(row.rawPayload);
      const sides = payload.Lineups ?? payload.lineups ?? [];
      if (Array.isArray(sides)) {
        for (const side of sides) {
          const playersList = side?.lineups ?? side?.Lineups ?? side?.players ?? side?.Players ?? [];
          if (Array.isArray(playersList)) {
            for (const entry of playersList) {
              const fixturePlayerId = String(entry.fixturePlayerId ?? entry.FixturePlayerId ?? entry.playerId ?? entry.PlayerId ?? entry.id ?? entry.Id ?? "");
              const playerObj = entry?.player ?? entry?.Player ?? entry;
              const normId = String(playerObj?.normativeId ?? playerObj?.NormativeId ?? playerObj?.id ?? playerObj?.Id ?? "");
              if (normId && fixturePlayerId) {
                aliases.set(normId, fixturePlayerId);
              }
            }
          }
        }
      }
    } catch { /* skip */ }
  }

  // Normalize and sort events
  const normalizedEvents = eventRows
    .map((row) => {
      const e = normalizeRawEvent(row as Parameters<typeof normalizeRawEvent>[0]);
      
      // Look up target player in aliases
      let resolvedPlayerId = e.playerId;
      if (resolvedPlayerId && aliases.has(resolvedPlayerId)) {
        resolvedPlayerId = aliases.get(resolvedPlayerId);
      }

      if (resolvedPlayerId) {
        e.playerId = resolvedPlayerId;
        const p = playerMap.get(resolvedPlayerId);
        if (p) {
          e.playerName = p.preferredName ?? p.name;
        }
      }

      let resolvedPlayerInId = e.playerInId;
      if (resolvedPlayerInId && aliases.has(resolvedPlayerInId)) {
        resolvedPlayerInId = aliases.get(resolvedPlayerInId);
      }
      if (resolvedPlayerInId) {
        e.playerInId = resolvedPlayerInId;
        const p = playerMap.get(resolvedPlayerInId);
        if (p) {
          e.playerInName = p.preferredName ?? p.name;
        }
      }
      return e;
    })
    .sort((a, b) => a.seq - b.seq);

  // Create SSE stream
  const encoder = new TextEncoder();
  let aborted = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ClientLiveEvent) => {
        if (aborted) return;
        try {
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${data}\n\n`));
        } catch {
          // Client disconnected
          aborted = true;
        }
      };

      // Connection event
      send({ type: "connection", payload: { status: "replay", fixtureId } });

      // Initial snapshot
      send({
        type: "fixture_snapshot",
        payload: serializeFixtureState({
          fixtureId,
          participant1: teamRows.find((t) => t.id === fixture.homeTeamId)?.name ?? fixture.homeTeamId,
          participant2: teamRows.find((t) => t.id === fixture.awayTeamId)?.name ?? fixture.awayTeamId,
          participant1Id: fixture.participant1Id ?? fixture.homeTeamId,
          participant2Id: fixture.participant2Id ?? fixture.awayTeamId,
          participant1Score: fixture.homeScore ?? 0,
          participant2Score: fixture.awayScore ?? 0,
          gamePhase: 5 as GamePhaseId, // Mark as Finished so it doesn't say NOT STARTED
          currentMinute: 90,
          players: fixturePlayersMap,
          events: [],
          lastSeq: 0,
          mode: "replay",
          startedAt: fixture.startsAt,
          updatedAt: new Date().toISOString(),
        }),
      });

      // Wait a brief moment for client to set up
      await sleep(500);

      // Replay events
      let benchmark: OppositionBenchmark = {
        bestATT: null,
        bestMID: null,
        bestDEF: null,
        benchmarkTotal: 0,
      };

      const userTrioIds = new Set([
        userTrio.attackerId,
        userTrio.midfielderId,
        userTrio.defenderId,
      ]);

      let p1Score = fixture.homeScore ?? 0;
      let p2Score = fixture.awayScore ?? 0;

      for (let i = 0; i < normalizedEvents.length; i++) {
        if (aborted) break;

        const event = normalizedEvents[i];

        // Track score
        if (event.action === "goal" && event.isConfirmed) {
          if (event.participantId === "1") p1Score++;
          else if (event.participantId === "2") p2Score++;
        }

        // Emit the raw event
        send({ type: "score_event", payload: event });

        // Process through rating engine
        const ratingUpdates = engine.processEvent(event, userTrioIds);
        for (const update of ratingUpdates) {
          send({ type: "player_rating", payload: update });
        }

        // Recalculate opposition benchmark
        const newBenchmark = calculateOppositionBenchmark(
          engine,
          oppositionParticipantId,
          benchmark,
        );
        if (hasBenchmarkChanged(benchmark, newBenchmark)) {
          benchmark = newBenchmark;
          send({ type: "benchmark_update", payload: newBenchmark });
        }

        // Narrate
        const card = narrateEvent(event, ratingUpdates[0], userTrio, engine, benchmark);
        if (card) {
          send({ type: "narrator", payload: card });
        }

        // Delay based on speed
        const baseDelayMs = 1500;
        const delay = Math.max(50, baseDelayMs / speed);
        await sleep(delay);
      }

      // Send finalised event
      if (!aborted) {
        send({
          type: "finalised",
          payload: {
            fixtureId,
            participant1Score: fixture.homeScore ?? p1Score,
            participant2Score: fixture.awayScore ?? p2Score,
            phase: 5 as GamePhaseId,
            finalPlayerRatings: Object.fromEntries(
              Array.from(engine.getAllPlayers().entries()).map(([id, p]) => [id, p.rating])
            ),
            userTrioTotal: engine.getTrioTotal([
              userTrio.attackerId,
              userTrio.midfielderId,
              userTrio.defenderId,
            ]),
            oppositionBenchmarkTotal: benchmark.benchmarkTotal,
          },
        });

        // Close the stream after a brief delay
        await sleep(500);
      }

      try {
        controller.close();
      } catch {
        // Already closed
      }
    },
    cancel() {
      aborted = true;
    },
  });

  // Handle client disconnect
  request.signal.addEventListener("abort", () => {
    aborted = true;
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
