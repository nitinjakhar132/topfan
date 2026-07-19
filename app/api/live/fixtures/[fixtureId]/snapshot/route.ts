/**
 * GET /api/live/fixtures/:fixtureId/snapshot
 *
 * Returns a JSON snapshot for initial hydration of the live match screen.
 * Includes: fixture state, all player ratings, user's trio, opposition benchmark.
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
import { calculateOppositionBenchmark, getOppositionParticipantId } from "@/lib/live/benchmark";
import type { LiveFixtureState, LivePlayerState, GamePhaseId, UserTrio, NarratorCard, MatchMapPlayer, MatchMapTeam, MatchMapMoment, MatchMapSnapshot, MatchMapRole } from "@/lib/live/types";
import { serializeFixtureState, GAME_PHASE_NAMES } from "@/lib/live/types";
import { getFixtureScores, FIXTURE_STAGES } from "@/lib/live/scores";
import { normalizeRawEvent } from "@/lib/live/replay-controller";
import { narrateEvent } from "@/lib/live/narrator";

async function readStreamWithTimeout(body: ReadableStream<Uint8Array>, timeoutMs: number): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let doneReading = false;

  const timeoutId = setTimeout(() => {
    if (!doneReading) {
      try { reader.cancel(); } catch {}
    }
  }, timeoutMs);

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        doneReading = true;
        break;
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch (err) {
    // Suppress cancel/abort error since it's expected on timeout
  } finally {
    clearTimeout(timeoutId);
    try { reader.releaseLock(); } catch {}
  }
  return text;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ fixtureId: string }> },
) {
  try {
    const { fixtureId } = await context.params;
    await ensureArchiveDatabase();
    const db = getDb();

  // Load fixture
  const [fixture] = await db
    .select()
    .from(fixtures)
    .where(eq(fixtures.id, fixtureId))
    .limit(1);

  if (!fixture) {
    return Response.json({ error: "Fixture not found." }, { status: 404 });
  }

  // Load teams, lineups, player match stats, raw events
  const [teamRows, lineupRows, statRows, playerRows, eventRows] = await Promise.all([
    db.select().from(teams),
    db.select().from(lineups).where(eq(lineups.fixtureId, fixtureId)),
    db.select().from(playerMatchStats).where(eq(playerMatchStats.fixtureId, fixtureId)),
    db.select().from(players),
    db.select().from(rawScoreEvents).where(eq(rawScoreEvents.fixtureId, fixtureId)),
  ]);

  // If no raw events in DB or the fixture is not finalised, dynamically fetch history from TxLINE and ingest
  const isFinalised = Boolean(fixture.finalisedAt);
  if (eventRows.length === 0 || !isFinalised) {
    try {
      const { txlineFetch } = await import("@/lib/txline/server");
      // If fixture is not finalised, use the snapshot endpoint; if finalised, try historical first, fallback to snapshot
      const endpointPath = !isFinalised 
        ? `/scores/snapshot/${fixtureId}` 
        : `/scores/historical/${fixtureId}`;
      let res = await txlineFetch(request, endpointPath);
      if (isFinalised && !res.ok) {
        res = await txlineFetch(request, `/scores/snapshot/${fixtureId}`);
      }
      if (res.ok) {
        const contentType = res.headers.get("content-type") ?? "";
        const text = res.body ? await readStreamWithTimeout(res.body, 3000) : await res.text();
        let eventsList: any[] = [];
        if (contentType.includes("event-stream") || text.trim().startsWith("data:")) {
          try {
            eventsList = text
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter((line) => line.startsWith("data:"))
              .map((line) => JSON.parse(line.slice(5).trim()));
          } catch (error) {
            console.error("[Snapshot API] Failed to parse SSE text stream:", error);
          }
        } else {
          try {
            eventsList = JSON.parse(text);
          } catch {
            console.error("[Snapshot API] Failed to parse JSON response:", text);
          }
        }

        if (Array.isArray(eventsList) && eventsList.length > 0) {
          const insertRows = eventsList.map((evt) => {
            const sequence = typeof evt.Seq === "number" ? evt.Seq : (typeof evt.seq === "number" ? evt.seq : 0);
            const action = evt.Action || evt.action || null;
            const confirmed = evt.Confirmed !== undefined ? Boolean(evt.Confirmed) : (evt.confirmed !== undefined ? Boolean(evt.confirmed) : null);
            const participantId = evt.Participant !== undefined ? String(evt.Participant) : (evt.participantId !== undefined ? String(evt.participantId) : null);
            
            const data = evt.DataSoccer ?? evt.Data ?? {};
            const playerId = data.PlayerId ?? data.playerId ?? evt.playerId ?? null;
            const playerInId = data.PlayerInId ?? data.playerInId ?? evt.playerInId ?? null;
            const playerOutId = data.PlayerOutId ?? data.playerOutId ?? evt.playerOutId ?? null;
            
            const seconds = evt.Clock?.Seconds;
            const matchMinute = seconds !== undefined ? Math.floor(seconds / 60) : (evt.matchMinute || null);

            return {
              fixtureId,
              sequence,
              action,
              confirmed,
              participantId,
              playerId: playerId ? String(playerId) : null,
              playerInId: playerInId ? String(playerInId) : null,
              playerOutId: playerOutId ? String(playerOutId) : null,
              matchMinute,
              rawPayload: JSON.stringify(evt),
              ingestedAt: new Date().toISOString(),
            };
          });

          if (insertRows.length > 0) {
            await db.insert(rawScoreEvents)
              .values(insertRows)
              .onConflictDoNothing();

            // Reload event rows
            const newEvents = await db
              .select()
              .from(rawScoreEvents)
              .where(eq(rawScoreEvents.fixtureId, fixtureId));
            eventRows.length = 0;
            eventRows.push(...newEvents);
          }
        }
      }
    } catch (err) {
      console.error("[Snapshot API] Failed to fetch and ingest historical events from TxLINE:", err);
    }
  }

  // Build player lookup maps
  const playerMap = new Map(playerRows.map((p) => [p.id, p]));
  const statMap = new Map(statRows.map((s) => [s.playerId, s]));

  // Initialize rating engine with all linedup players
  const engine = new LiveRatingEngine();
  const fixturePlayersState = new Map<string, LivePlayerState>();

  for (const lineup of lineupRows) {
    const player = playerMap.get(lineup.playerId);
    const stat = statMap.get(lineup.playerId);
    const position = (lineup.position as "ATT" | "MID" | "DEF" | "GK" | "OTHER") ?? "OTHER";
    const participantId = lineup.teamId === fixture.homeTeamId ? "1" : "2";
    const startRating = stat?.impactRating ?? 6.0;

    engine.initPlayer(
      lineup.playerId,
      player?.preferredName ?? player?.name ?? lineup.playerId,
      position,
      participantId,
      startRating,
      lineup.starter,
    );

    fixturePlayersState.set(lineup.playerId, {
      playerId: lineup.playerId,
      playerName: player?.preferredName ?? player?.name ?? lineup.playerId,
      position,
      participantId,
      rating: startRating,
      eventHistory: [],
      isSubstitutedOut: false,
      enteredMatch: lineup.starter,
      shirtNumber: lineup.shirtNumber,
      photoUrl: player?.photoUrl ?? null,
      starter: lineup.starter,
      officialSubstitute: lineup.officialSubstitute,
    });
  }

  // Resolve user's trio (check wallet from cookie or query param)
  const url = new URL(request.url);
  const wallet = url.searchParams.get("wallet");

  let userTrio: UserTrio | null = null;
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

  // Fallback default selection if no pick is recorded
  if (!userTrio) {
    userTrio = {
      attackerId: "",
      midfielderId: "",
      defenderId: "",
      teamId: fixture.homeTeamId,
    };
    for (const lineup of lineupRows) {
      if (lineup.position === "ATT" && !userTrio.attackerId) userTrio.attackerId = lineup.playerId;
      if (lineup.position === "MID" && !userTrio.midfielderId) userTrio.midfielderId = lineup.playerId;
      if (lineup.position === "DEF" && !userTrio.defenderId) userTrio.defenderId = lineup.playerId;
    }
  }

  // Calculate opposition participant ID
  const oppositionParticipantId = getOppositionParticipantId(
    userTrio.teamId,
    fixture.participant1Id ?? fixture.homeTeamId,
    fixture.participant2Id ?? fixture.awayTeamId,
  );

  // Resolve correct score using our shared utility
  const { homeScore, awayScore } = getFixtureScores(fixtureId, fixture.homeScore, fixture.awayScore);

  // Resolve correct GamePhaseId
  const gamePhase = resolveGamePhase(fixture.phase);

  // Build fixture state
  const fixtureState: LiveFixtureState = {
    fixtureId,
    participant1: teamRows.find((t) => t.id === fixture.homeTeamId)?.name ?? fixture.homeTeamId,
    participant2: teamRows.find((t) => t.id === fixture.awayTeamId)?.name ?? fixture.awayTeamId,
    participant1Id: fixture.participant1Id ?? fixture.homeTeamId,
    participant2Id: fixture.participant2Id ?? fixture.awayTeamId,
    participant1Score: homeScore,
    participant2Score: awayScore,
    gamePhase,
    currentMinute: [5, 10, 13].includes(gamePhase) ? (gamePhase === 10 ? 120 : 90) : 0,
    players: fixturePlayersState,
    events: [],
    lastSeq: 0,
    mode: fixture.finalisedAt || [5, 10, 13].includes(gamePhase)
      ? "completed"
      : [2, 3, 4, 6, 7, 8, 9, 11, 12].includes(gamePhase)
      ? "live"
      : "prematch",
    startedAt: fixture.startsAt,
    updatedAt: new Date().toISOString(),
  };

  // Resolve tournament stage
  const stage = FIXTURE_STAGES[fixtureId] ?? "World Cup Match";

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

  // Map all normalized events and resolve player names and incoming substitutes
  const allNormalizedEvents = eventRows
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

  // Set up rating engine simulation using events to compute final state, narrator cards, and Match Map snapshots
  const userTrioIds = new Set([userTrio.attackerId, userTrio.midfielderId, userTrio.defenderId]);
  const narratorCards: NarratorCard[] = [];
  let currentBenchmark = { bestATT: null, bestMID: null, bestDEF: null, benchmarkTotal: 0 };

  const keyMoments: MatchMapMoment[] = [];
  const keyMomentSnapshots: Record<string, MatchMapSnapshot> = {};

  let currentHomeScore = 0;
  let currentAwayScore = 0;

  // Re-run the events through the engine
  let currentPhase = gamePhase;
  for (const event of allNormalizedEvents) {
    if (!event.isConfirmed) continue;

    // Track game phase dynamically from raw payload statusId
    const correspondingRow = eventRows.find((r) => r.sequence === event.seq);
    if (correspondingRow) {
      try {
        const payload = JSON.parse(correspondingRow.rawPayload);
        const statusId = payload.StatusId ?? payload.statusId;
        if (typeof statusId === "number" && statusId >= 1 && statusId <= 19) {
          currentPhase = statusId as GamePhaseId;
        }
      } catch {}
    }

    // Track scores
    if (event.action === "goal") {
      if (event.participantId === "1") currentHomeScore++;
      else if (event.participantId === "2") currentAwayScore++;
    }

    const prevTrioTotal = engine.getTrioTotal([userTrio.attackerId, userTrio.midfielderId, userTrio.defenderId]);
    const prevBenchmark = currentBenchmark;
    const prevMatchIndex = prevBenchmark.benchmarkTotal > 0 ? Math.round((prevTrioTotal / prevBenchmark.benchmarkTotal) * 1000) / 10 : 100.0;

    const updates = engine.processEvent(event, userTrioIds);

    // Recalculate benchmark
    currentBenchmark = calculateOppositionBenchmark(engine, oppositionParticipantId, currentBenchmark);

    // Generate narrator card
    const card = narrateEvent(event, updates[0], userTrio, engine, currentBenchmark);

    const nextTrioTotal = engine.getTrioTotal([userTrio.attackerId, userTrio.midfielderId, userTrio.defenderId]);
    const nextMatchIndex = currentBenchmark.benchmarkTotal > 0 ? Math.round((nextTrioTotal / currentBenchmark.benchmarkTotal) * 1000) / 10 : 100.0;

    // Build the players' ratings in our local map for snapshot building
    const snapPlayerRatings: Record<string, LivePlayerState> = {};
    for (const [id, ps] of fixturePlayersState.entries()) {
      const u = engine.getPlayer(id);
      snapPlayerRatings[id] = {
        ...ps,
        rating: u?.rating ?? ps.rating,
        isSubstitutedOut: u?.isSubstitutedOut ?? ps.isSubstitutedOut,
        enteredMatch: u?.enteredMatch ?? ps.enteredMatch,
      };
    }

    // Determine if this event is a curated key moment
    const isGoal = event.action === "goal" || event.action === "own_goal";
    const isPenalty = event.action === "penalty";
    const isRed = event.action === "red_card" || event.action === "second_yellow_card";
    const isSub = event.action === "substitution";
    const isTrioPlayer = event.playerId ? userTrioIds.has(event.playerId) : false;
    const isBenchPlayerEntering = isSub && event.playerInId && userTrioIds.has(event.playerInId);
    
    const benchmarkChanged = prevBenchmark.bestATT?.playerId !== currentBenchmark.bestATT?.playerId ||
                             prevBenchmark.bestMID?.playerId !== currentBenchmark.bestMID?.playerId ||
                             prevBenchmark.bestDEF?.playerId !== currentBenchmark.bestDEF?.playerId;
    
    const indexCrossed100 = (prevMatchIndex < 100 && nextMatchIndex >= 100) || (prevMatchIndex > 100 && nextMatchIndex <= 100);
    const scoreLeadChanged = (prevTrioTotal < prevBenchmark.benchmarkTotal && nextTrioTotal >= currentBenchmark.benchmarkTotal) ||
                              (prevTrioTotal > prevBenchmark.benchmarkTotal && nextTrioTotal <= currentBenchmark.benchmarkTotal);

    // Yellow cards are curated if they affect a selected trio player or benchmark player
    const isYellow = event.action === "yellow_card";
    const isMeaningfulYellow = isYellow && (isTrioPlayer || (event.playerId && [prevBenchmark.bestATT?.playerId, prevBenchmark.bestMID?.playerId, prevBenchmark.bestDEF?.playerId].includes(event.playerId)));

    const isMeaningfulShot = event.action === "shot" && (event.outcome?.toLowerCase() === "ontarget" || event.outcome?.toLowerCase() === "woodwork") && isTrioPlayer;

    const isCurated = isGoal || isPenalty || isRed || isSub || isMeaningfulYellow || isMeaningfulShot || benchmarkChanged || indexCrossed100 || scoreLeadChanged;

    if (isCurated) {
      const momentId = `moment-${event.seq}`;
      const headline = event.action === "goal" ? (isTrioPlayer ? "YOUR TRIO SCORES! ⚽" : "GOAL! ⚽") : event.action.toUpperCase().replace(/_/g, " ");
      
      const ratingChanges = updates.map(u => ({
        playerId: u.playerId,
        before: u.ratingBefore,
        after: u.ratingAfter,
        delta: Math.round((u.ratingAfter - u.ratingBefore) * 10) / 10,
      }));

      const moment: MatchMapMoment = {
        id: momentId,
        sourceSequence: event.seq,
        minute: event.minute ?? null,
        label: `${event.minute ?? 0}'`,
        type: isGoal ? "goal" : isPenalty ? "penalty" : isRed ? "red_card" : isYellow ? "yellow_card" : isSub ? "substitution" : "match_index_change",
        headline,
        summary: card?.detail ?? null,
        affectedPlayerIds: updates.map(u => u.playerId),
        ratingChanges,
        trioBefore: prevTrioTotal,
        trioAfter: nextTrioTotal,
        benchmarkBefore: prevBenchmark.benchmarkTotal,
        benchmarkAfter: currentBenchmark.benchmarkTotal,
        matchIndexBefore: prevMatchIndex,
        matchIndexAfter: nextMatchIndex,
        snapshotId: momentId,
      };

      keyMoments.push(moment);
      keyMomentSnapshots[momentId] = buildMatchMapSnapshot(
        momentId,
        event.seq,
        event.minute ?? null,
        GAME_PHASE_NAMES[gamePhase],
        currentHomeScore,
        currentAwayScore,
        fixture,
        teamRows,
        lineupRows,
        snapPlayerRatings,
        userTrio,
        currentBenchmark,
        moment,
      );
    }

    // Generate narrator card
    if (card) {
      narratorCards.push(card);
    }
  }

  // Update players map with final ratings from engine
  for (const [id, playerState] of fixturePlayersState.entries()) {
    const updated = engine.getPlayer(id);
    if (updated) {
      playerState.rating = updated.rating;
      playerState.eventHistory = updated.eventHistory;
      playerState.isSubstitutedOut = updated.isSubstitutedOut;
      playerState.enteredMatch = updated.enteredMatch;
    }
  }

  // Update fixtureState with final computed live metrics from events
  fixtureState.participant1Score = currentHomeScore;
  fixtureState.participant2Score = currentAwayScore;
  fixtureState.gamePhase = currentPhase;
  fixtureState.mode = fixture.finalisedAt || [5, 10, 13].includes(currentPhase)
    ? "completed"
    : [2, 3, 4, 6, 7, 8, 9, 11, 12].includes(currentPhase)
    ? "live"
    : "prematch";
  if (allNormalizedEvents.length > 0) {
    const latestEvent = allNormalizedEvents[allNormalizedEvents.length - 1];
    fixtureState.currentMinute = latestEvent.minute ?? fixtureState.currentMinute;
    fixtureState.lastSeq = latestEvent.seq;
  }

  const benchmark = currentBenchmark;

  // Always add Full Time / final match moment if completed
  if (fixtureState.mode === "completed" || currentPhase === 5) {
    const finalPlayerRatings: Record<string, LivePlayerState> = {};
    for (const [id, ps] of fixturePlayersState.entries()) {
      const u = engine.getPlayer(id);
      finalPlayerRatings[id] = {
        ...ps,
        rating: u?.rating ?? ps.rating,
        isSubstitutedOut: u?.isSubstitutedOut ?? ps.isSubstitutedOut,
        enteredMatch: u?.enteredMatch ?? ps.enteredMatch,
      };
    }

    const ftMoment: MatchMapMoment = {
      id: "moment-ft",
      sourceSequence: allNormalizedEvents.length ? allNormalizedEvents[allNormalizedEvents.length - 1].seq : 9999,
      minute: 90,
      label: "FT",
      type: "phase_change",
      headline: "FULL TIME",
      summary: "The match has concluded.",
      affectedPlayerIds: [],
      ratingChanges: [],
      trioBefore: engine.getTrioTotal([userTrio.attackerId, userTrio.midfielderId, userTrio.defenderId]),
      trioAfter: engine.getTrioTotal([userTrio.attackerId, userTrio.midfielderId, userTrio.defenderId]),
      benchmarkBefore: benchmark.benchmarkTotal,
      benchmarkAfter: benchmark.benchmarkTotal,
      matchIndexBefore: benchmark.benchmarkTotal > 0 ? Math.round((engine.getTrioTotal([userTrio.attackerId, userTrio.midfielderId, userTrio.defenderId]) / benchmark.benchmarkTotal) * 1000) / 10 : 100.0,
      matchIndexAfter: benchmark.benchmarkTotal > 0 ? Math.round((engine.getTrioTotal([userTrio.attackerId, userTrio.midfielderId, userTrio.defenderId]) / benchmark.benchmarkTotal) * 1000) / 10 : 100.0,
      snapshotId: "moment-ft",
    };

    if (!keyMoments.some(m => m.id === "moment-ft")) {
      keyMoments.push(ftMoment);
      keyMomentSnapshots["moment-ft"] = buildMatchMapSnapshot(
        "moment-ft",
        ftMoment.sourceSequence,
        90,
        "Full Time",
        currentHomeScore,
        currentAwayScore,
        fixture,
        teamRows,
        lineupRows,
        finalPlayerRatings,
        userTrio,
        benchmark,
        ftMoment,
      );
    }
  }

  // Generate current / final Match Map snapshot
  const finalPlayerRatings: Record<string, LivePlayerState> = {};
  for (const [id, ps] of fixturePlayersState.entries()) {
    const u = engine.getPlayer(id);
    finalPlayerRatings[id] = {
      ...ps,
      rating: u?.rating ?? ps.rating,
      isSubstitutedOut: u?.isSubstitutedOut ?? ps.isSubstitutedOut,
      enteredMatch: u?.enteredMatch ?? ps.enteredMatch,
    };
  }

  const finalSnapshot = buildMatchMapSnapshot(
    "current",
    allNormalizedEvents.length ? allNormalizedEvents[allNormalizedEvents.length - 1].seq : null,
    gamePhase === 5 ? 90 : null,
    GAME_PHASE_NAMES[gamePhase],
    currentHomeScore,
    currentAwayScore,
    fixture,
    teamRows,
    lineupRows,
    finalPlayerRatings,
    userTrio,
    benchmark,
    keyMoments[keyMoments.length - 1] ?? null,
  );

  const matchMap = {
    current: finalSnapshot,
    keyMoments,
    keyMomentSnapshots,
  };

  // Construct final match state for completed fixtures
  let finalState = null;
  if (fixtureState.mode === "completed" || gamePhase === 5) {
    finalState = {
      fixtureId,
      participant1Score: homeScore,
      participant2Score: awayScore,
      phase: gamePhase,
      finalPlayerRatings: Object.fromEntries(
        Array.from(engine.getAllPlayers().entries()).map(([id, p]) => [id, p.rating])
      ),
      userTrioTotal: engine.getTrioTotal([
        userTrio.attackerId,
        userTrio.midfielderId,
        userTrio.defenderId,
      ]),
      oppositionBenchmarkTotal: benchmark.benchmarkTotal,
    };
  }

  const goalsAndCards = allNormalizedEvents.filter(
    (e) => e.action === "goal" || e.action === "red_card" || e.action === "yellow_card"
  );

  return Response.json({
    fixture: {
      ...fixture,
      homeScore,
      awayScore,
      stage,
      homeTeam: teamRows.find((t) => t.id === fixture.homeTeamId) ?? null,
      awayTeam: teamRows.find((t) => t.id === fixture.awayTeamId) ?? null,
    },
    state: serializeFixtureState(fixtureState),
    benchmark,
    userTrio,
    totalRawEvents: eventRows.length,
    hasReplayData: eventRows.length > 0,
    goalsAndCards,
    events: allNormalizedEvents,
    narratorCards,
    finalState,
    matchMap,
    playerStats: statRows,
  });

  } catch (error: any) {
    console.error("[Snapshot GET Error]:", error);
    return Response.json({ error: error?.message ?? String(error) }, { status: 500 });
  }
}

// ─── Match Map Visual Helper Functions ────────────────────────────────────────

function buildMatchMapTeam(
  teamId: string,
  fixture: any,
  teamRows: any[],
  lineupRows: any[],
  playerRatings: Record<string, LivePlayerState>,
  userTrio: UserTrio,
  benchmark: OppositionBenchmark,
  isSupported: boolean,
): MatchMapTeam {
  const team = teamRows.find((t) => t.id === teamId);
  const teamLineups = lineupRows.filter((l) => l.teamId === teamId);
  
  const userTrioIds = new Set([userTrio.attackerId, userTrio.midfielderId, userTrio.defenderId]);
  const benchmarkIds = new Set([
    benchmark.bestATT?.playerId,
    benchmark.bestMID?.playerId,
    benchmark.bestDEF?.playerId,
  ].filter(Boolean));

  const allPlayers: MatchMapPlayer[] = teamLineups.map((lineup) => {
    const playerRatingState = playerRatings[lineup.playerId];
    const currentRating = playerRatingState ? playerRatingState.rating : 6.0;

    return {
      playerId: lineup.playerId,
      teamId: lineup.teamId,
      displayName: playerRatingState?.playerName ?? lineup.playerId,
      shortName: playerRatingState?.playerName?.split(",")[0] ?? lineup.playerId,
      photoUrl: playerRatingState?.photoUrl ?? null,
      shirtNumber: lineup.shirtNumber ?? null,
      role: (lineup.position as MatchMapRole) ?? "OTHER",
      starter: lineup.starter,
      officialSubstitute: lineup.officialSubstitute,
      enteredMatch: playerRatingState?.enteredMatch ?? lineup.starter,
      substitutedOff: playerRatingState?.isSubstitutedOut ?? false,
      currentRating,
      finalRating: currentRating,
      isUserTrio: isSupported && userTrioIds.has(lineup.playerId),
      isOppositionBenchmark: !isSupported && benchmarkIds.has(lineup.playerId),
      isLatestMomentPlayer: false,
      latestRatingDelta: null,
    };
  });

  // Active players on the pitch: starters or official substitutes who entered the match
  const activePlayers = allPlayers.filter((p) => p.starter || p.enteredMatch);
  const benchPlayers = allPlayers.filter((p) => p.officialSubstitute);

  // Group active players by role bands: GK, DEF, MID, ATT to assign dynamic grid layouts
  const roles: MatchMapRole[] = ["GK", "DEF", "MID", "ATT"];
  for (const role of roles) {
    const playersInRole = activePlayers.filter((p) => p.role === role);
    // Sort stably: GK, DEF, MID, ATT layout bands horizontal distribution
    playersInRole.sort((a, b) => (a.shirtNumber ?? 99) - (b.shirtNumber ?? 99) || a.playerId.localeCompare(b.playerId));
    playersInRole.forEach((p, idx) => {
      p.layout = {
        line: role,
        indexInLine: idx,
        countInLine: playersInRole.length,
      };
    });
  }

  return {
    teamId,
    teamName: team?.name ?? teamId,
    shortName: team?.code ?? teamId,
    visualUrl: team?.flag ?? null,
    formation: null,
    activePlayers,
    benchPlayers,
  };
}

function buildMatchMapSnapshot(
  snapshotId: string,
  seq: number | null,
  minute: number | null,
  phase: string,
  homeScore: number,
  awayScore: number,
  fixture: any,
  teamRows: any[],
  lineupRows: any[],
  playerRatings: Record<string, LivePlayerState>,
  userTrio: UserTrio,
  benchmark: OppositionBenchmark,
  latestMoment: MatchMapMoment | null,
): MatchMapSnapshot {
  const supportedTeam = buildMatchMapTeam(
    userTrio.teamId,
    fixture,
    teamRows,
    lineupRows,
    playerRatings,
    userTrio,
    benchmark,
    true,
  );
  
  const oppositionTeamId = userTrio.teamId === fixture.homeTeamId ? fixture.awayTeamId : fixture.homeTeamId;
  const oppositionTeam = buildMatchMapTeam(
    oppositionTeamId,
    fixture,
    teamRows,
    lineupRows,
    playerRatings,
    userTrio,
    benchmark,
    false,
  );

  const trioTotal = Math.round(
    ((playerRatings[userTrio.attackerId]?.rating ?? 6.0) +
     (playerRatings[userTrio.midfielderId]?.rating ?? 6.0) +
     (playerRatings[userTrio.defenderId]?.rating ?? 6.0)) * 10
  ) / 10;

  const oppositionBenchmarkTotal = benchmark.benchmarkTotal;

  const matchIndex = oppositionBenchmarkTotal > 0
    ? Math.round((trioTotal / oppositionBenchmarkTotal) * 1000) / 10
    : 100.0;

  return {
    snapshotId,
    sourceSequence: seq,
    minute,
    phase,
    homeScore,
    awayScore,
    supportedTeam,
    oppositionTeam,
    trioTotal,
    oppositionBenchmarkTotal,
    matchIndex,
    latestMoment,
  };
}

/**
 * Maps fixture.phase (a free-text string stored in D1) to a numeric GamePhaseId.
 */
function resolveGamePhase(phase: string | null | undefined): GamePhaseId {
  if (!phase) return 1 as GamePhaseId;

  const numeric = parseInt(phase, 10);
  if (!isNaN(numeric) && numeric >= 1 && numeric <= 19) {
    return numeric as GamePhaseId;
  }

  const lc = phase.toLowerCase().trim();
  const textMap: Record<string, GamePhaseId> = {
    "not started": 1,   "ns": 1,       "scheduled": 1,   "prematch": 1,
    "1st half": 2,      "h1": 2,       "first half": 2,  "in progress": 2, "inprogress": 2,
    "half time": 3,     "ht": 3,       "halftime": 3,    "half-time": 3,
    "2nd half": 4,      "h2": 4,       "second half": 4,
    "full time": 5,     "ft": 5,       "final": 5,       "finished": 5,    "completed": 5,
    "waiting for et": 6,"wet": 6,      "extra time break": 6,
    "et 1st half": 7,   "et1": 7,      "extra time first half": 7, "et first half": 7,
    "et half time": 8,  "etht": 8,     "et halftime": 8, "et half-time": 8,
    "et 2nd half": 9,   "et2": 9,      "extra time second half": 9,
    "aet": 10,          "full time aet": 10,
    "waiting for pens": 11, "wpe": 11,
    "penalty shootout": 12, "pe": 12,  "penalties": 12,
    "full time pens": 13, "fpe": 13,
    "interrupted": 14,
    "abandoned": 15,
    "cancelled": 16,
    "postponed": 19,
  };

  return textMap[lc] ?? 1 as GamePhaseId;
}
