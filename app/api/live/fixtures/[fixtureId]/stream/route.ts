/**
 * GET /api/live/fixtures/:fixtureId/stream
 *
 * SSE endpoint for LIVE match streaming. Connects to TxLINE's scores stream
 * and processes events through the rating engine, narrator, and benchmark
 * pipeline in real-time.
 *
 * For completed fixtures, redirects to the replay endpoint.
 *
 * Query params:
 *   wallet=<wallet> (to identify user's trio)
 */

import { eq, and } from "drizzle-orm";
import { ensureArchiveDatabase, getDb } from "@/db";
import {
  fixtures,
  lineups,
  players,
  picks,
  teams,
  rawScoreEvents,
} from "@/db/schema";
import { TXLINE } from "@/lib/txline/config";
import { LiveRatingEngine } from "@/lib/live/rating-engine";
import {
  calculateOppositionBenchmark,
  hasBenchmarkChanged,
  getOppositionParticipantId,
} from "@/lib/live/benchmark";
import { narrateEvent } from "@/lib/live/narrator";
import { MatchPulse } from "@/lib/live/match-pulse";
import type {
  LivePlayerState,
  GamePhaseId,
  UserTrio,
  OppositionBenchmark,
  ClientLiveEvent,
  NormalizedMatchEvent,
} from "@/lib/live/types";
import { serializeFixtureState } from "@/lib/live/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minute max for Vercel (extend on self-hosted)

// ─── TxLINE SSE Parser (from official docs) ────────────────────────────────

type SseMessage = {
  id?: string;
  event?: string;
  data: string;
  retry?: number;
};

function parseSseBlock(block: string): SseMessage | null {
  const message: SseMessage = { data: "" };

  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(":")) continue;

    const separatorIndex = rawLine.indexOf(":");
    const field = separatorIndex === -1 ? rawLine : rawLine.slice(0, separatorIndex);
    const value =
      separatorIndex === -1
        ? ""
        : rawLine.slice(separatorIndex + 1).replace(/^ /, "");

    if (field === "data") message.data += `${value}\n`;
    if (field === "event") message.event = value;
    if (field === "id") message.id = value;
    if (field === "retry") message.retry = Number(value);
  }

  message.data = message.data.replace(/\n$/, "");
  return message.data || message.event || message.id ? message : null;
}

// ─── Guest JWT management ──────────────────────────────────────────────────

async function getGuestJwt(): Promise<string | null> {
  try {
    const res = await fetch(TXLINE.guestAuth, { method: "POST", cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { token?: string };
    return data.token ?? null;
  } catch {
    return null;
  }
}

// ─── Route Handler ─────────────────────────────────────────────────────────

export async function GET(
  request: Request,
  context: { params: Promise<{ fixtureId: string }> },
) {
  const { fixtureId } = await context.params;
  const url = new URL(request.url);
  const wallet = url.searchParams.get("wallet");
  const apiToken = url.searchParams.get("apiToken");

  await ensureArchiveDatabase();
  const db = getDb();

  // Load fixture
  const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId)).limit(1);
  if (!fixture) {
    return new Response("Fixture not found", { status: 404 });
  }

  // If fixture is completed and has replay data, suggest replay instead
  const phaseLower = (fixture.phase || "").toLowerCase();
  if (fixture.finalisedAt || phaseLower === "final" || phaseLower === "completed" || phaseLower === "finished") {
    const [hasEvents] = await db
      .select({ count: rawScoreEvents.sequence })
      .from(rawScoreEvents)
      .where(eq(rawScoreEvents.fixtureId, fixtureId))
      .limit(1);
    if (hasEvents) {
      return new Response(
        JSON.stringify({ redirect: `/api/live/fixtures/${fixtureId}/replay?speed=5&wallet=${wallet ?? ""}` }),
        {
          status: 307,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  // Load teams, lineups, players, and existing raw events
  const [teamRows, lineupRows, playerRows, eventRows] = await Promise.all([
    db.select().from(teams),
    db.select().from(lineups).where(eq(lineups.fixtureId, fixtureId)),
    db.select().from(players),
    db.select().from(rawScoreEvents).where(eq(rawScoreEvents.fixtureId, fixtureId)),
  ]);

  const playerMap = new Map(playerRows.map((p) => [p.id, p]));

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

  const participant1Name = teamRows.find((t) => t.id === fixture.homeTeamId)?.name ?? fixture.homeTeamId;
  const participant2Name = teamRows.find((t) => t.id === fixture.awayTeamId)?.name ?? fixture.awayTeamId;

  // Initialize rating engine & match pulse
  const engine = new LiveRatingEngine();
  const matchPulse = new MatchPulse(fixtureId, participant1Name, participant2Name);
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

  // Resolve user trio
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

  // Auto-pick if no trio
  if (!userTrio.attackerId) {
    const homeLineups = lineupRows.filter((l) => l.teamId === fixture.homeTeamId);
    for (const lineup of homeLineups) {
      if (lineup.position === "ATT" && !userTrio.attackerId) userTrio.attackerId = lineup.playerId;
      if (lineup.position === "MID" && !userTrio.midfielderId) userTrio.midfielderId = lineup.playerId;
      if (lineup.position === "DEF" && !userTrio.defenderId) userTrio.defenderId = lineup.playerId;
    }
  }

  const oppositionParticipantId = getOppositionParticipantId(
    userTrio.teamId,
    fixture.participant1Id ?? fixture.homeTeamId,
    fixture.participant2Id ?? fixture.awayTeamId,
  );

  // Get JWT for TxLINE
  const jwt = await getGuestJwt();

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
          aborted = true;
        }
      };

      // Normalize and sort existing events in DB to initialize rating engine state
      const sortedExistingEvents = eventRows
        .map((row) => {
          const payload = JSON.parse(row.rawPayload);
          const action = String(payload.Action ?? payload.action ?? payload.Type ?? "unknown").toLowerCase();
          const data = payload.DataSoccer ?? payload.Data ?? {};
          
          let resolvedPlayerId = String(data.PlayerId ?? data.playerId ?? "");
          if (resolvedPlayerId && aliases.has(resolvedPlayerId)) {
            resolvedPlayerId = aliases.get(resolvedPlayerId);
          }
          let resolvedPlayerName = data.PlayerName ?? data.playerName ?? "";
          if (resolvedPlayerId) {
            const p = playerMap.get(resolvedPlayerId);
            if (p) resolvedPlayerName = p.preferredName ?? p.name;
          }
          
          let resolvedPlayerInId = String(data.PlayerInId ?? data.playerInId ?? "");
          if (resolvedPlayerInId && aliases.has(resolvedPlayerInId)) {
            resolvedPlayerInId = aliases.get(resolvedPlayerInId);
          }
          let resolvedPlayerInName = data.PlayerInName ?? data.playerInName ?? "";
          if (resolvedPlayerInId) {
            const p = playerMap.get(resolvedPlayerInId);
            if (p) resolvedPlayerInName = p.preferredName ?? p.name;
          }

          return {
            fixtureId,
            seq: payload.Seq ?? payload.seq ?? 0,
            action,
            playerId: resolvedPlayerId || undefined,
            playerName: resolvedPlayerName || undefined,
            playerInId: resolvedPlayerInId || undefined,
            playerInName: resolvedPlayerInName || undefined,
            participantId: String(payload.Participant ?? payload.participant ?? ""),
            minute: payload.Minute ?? payload.minute ?? data.Minute,
            outcome: data.Outcome ?? data.outcome,
            subtype: data.FreeKickType ?? data.freeKickType,
            ts: new Date().toISOString(),
            isConfirmed: (payload.StatusId ?? 0) >= 100 || Boolean(data.Outcome),
          };
        })
        .sort((a, b) => a.seq - b.seq);

      const userTrioIds = new Set([userTrio.attackerId, userTrio.midfielderId, userTrio.defenderId]);
      let currentMinute = 0;
      let currentHomeScore = 0;
      let currentAwayScore = 0;
      let currentSeq = 0;
      let currentPhase = resolveGamePhase(fixture.phase);

      for (const event of sortedExistingEvents) {
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

        if (event.action === "goal") {
          if (event.participantId === "1") currentHomeScore++;
          else if (event.participantId === "2") currentAwayScore++;
        }
        engine.processEvent(event, userTrioIds);
        if (event.minute !== undefined) currentMinute = event.minute;
        if (event.seq > currentSeq) currentSeq = event.seq;
      }

      // Update players map with historical ratings from engine
      for (const [id, playerState] of fixturePlayersMap.entries()) {
        const updated = engine.getPlayer(id);
        if (updated) {
          playerState.rating = updated.rating;
          playerState.eventHistory = updated.eventHistory;
          playerState.isSubstitutedOut = updated.isSubstitutedOut;
          playerState.enteredMatch = updated.enteredMatch;
        }
      }

      // Connection event
      send({ type: "connection", payload: { status: "live", fixtureId } });

      // Initial snapshot using fully updated state
      send({
        type: "fixture_snapshot",
        payload: serializeFixtureState({
          fixtureId,
          participant1: participant1Name,
          participant2: participant2Name,
          participant1Id: fixture.participant1Id ?? fixture.homeTeamId,
          participant2Id: fixture.participant2Id ?? fixture.awayTeamId,
          participant1Score: currentHomeScore,
          participant2Score: currentAwayScore,
          gamePhase: currentPhase,
          currentMinute: currentMinute,
          players: fixturePlayersMap,
          events: [],
          lastSeq: currentSeq,
          mode: fixture.finalisedAt || [5, 10, 13].includes(currentPhase) ? "completed" : "live",
          startedAt: fixture.startsAt,
          updatedAt: new Date().toISOString(),
        }),
      });

      // Send initial Match Pulse placeholder (so UI renders immediately)
      send({ type: "odds_pulse", payload: MatchPulse.unavailable() });

      // If no JWT or API token, fall back to heartbeat mode
      if (!jwt || !apiToken) {
        // Send heartbeats until client disconnects
        while (!aborted) {
          send({ type: "heartbeat", payload: { ts: new Date().toISOString() } });
          await sleep(10000);
        }
        try { controller.close(); } catch { /* closed */ }
        return;
      }

      // Connect to TxLINE scores stream (primary) + odds stream (parallel, optional)
      try {
        const [scoresResponse, oddsResponse] = await Promise.all([
          fetch(`${TXLINE.apiBase}/scores/stream`, {
            headers: {
              Authorization: `Bearer ${jwt}`,
              "X-Api-Token": apiToken,
              Accept: "text/event-stream",
              "Cache-Control": "no-cache",
            },
          }),
          // Odds stream — failure is non-fatal
          fetch(`${TXLINE.apiBase}/odds/stream`, {
            headers: {
              Authorization: `Bearer ${jwt}`,
              "X-Api-Token": apiToken,
              Accept: "text/event-stream",
              "Cache-Control": "no-cache",
            },
          }).catch(() => null),
        ]);

        // Start parallel odds reader if available
        if (oddsResponse?.ok && oddsResponse.body) {
          void readOddsStream(oddsResponse.body, fixtureId, matchPulse, send, () => aborted);
        }

        const streamResponse = scoresResponse;

        if (!streamResponse.ok || !streamResponse.body) {
          // Fall back to heartbeat mode
          while (!aborted) {
            send({ type: "heartbeat", payload: { ts: new Date().toISOString() } });
            await sleep(10000);
          }
          try { controller.close(); } catch { /* closed */ }
          return;
        }

        // Read TxLINE SSE stream
        const reader = streamResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let benchmark: OppositionBenchmark = {
          bestATT: null,
          bestMID: null,
          bestDEF: null,
          benchmarkTotal: 0,
        };
        const userTrioIds = new Set([userTrio.attackerId, userTrio.midfielderId, userTrio.defenderId]);
        let seqCounter = 0;

        while (!aborted) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let separator = buffer.match(/\r?\n\r?\n/);
          while (separator?.index !== undefined) {
            const block = buffer.slice(0, separator.index);
            buffer = buffer.slice(separator.index + separator[0].length);

            const message = parseSseBlock(block);
            if (message && message.data) {
              try {
                const parsed = JSON.parse(message.data);

                // Check if this event is for our fixture
                const eventFixtureId = String(parsed.FixtureId ?? parsed.fixtureId ?? "");
                if (eventFixtureId && eventFixtureId !== fixtureId) {
                  separator = buffer.match(/\r?\n\r?\n/);
                  continue;
                }

                seqCounter++;

                // Normalize the TxLINE event
                const action = String(parsed.Action ?? parsed.action ?? parsed.Type ?? "unknown").toLowerCase();
                const data = parsed.DataSoccer ?? parsed.Data ?? {};

                // Parse lineups on the fly to capture new aliases during live matches
                const sides = parsed.Lineups ?? parsed.lineups ?? [];
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

                let resolvedPlayerId = String(data.PlayerId ?? data.playerId ?? "");
                if (resolvedPlayerId && aliases.has(resolvedPlayerId)) {
                  resolvedPlayerId = aliases.get(resolvedPlayerId);
                }
                let resolvedPlayerName = data.PlayerName ?? data.playerName ?? "";
                if (resolvedPlayerId) {
                  const p = playerMap.get(resolvedPlayerId);
                  if (p) {
                    resolvedPlayerName = p.preferredName ?? p.name;
                  }
                }

                let resolvedPlayerInId = String(data.PlayerInId ?? data.playerInId ?? "");
                if (resolvedPlayerInId && aliases.has(resolvedPlayerInId)) {
                  resolvedPlayerInId = aliases.get(resolvedPlayerInId);
                }
                let resolvedPlayerInName = data.PlayerInName ?? data.playerInName ?? "";
                if (resolvedPlayerInId) {
                  const p = playerMap.get(resolvedPlayerInId);
                  if (p) {
                    resolvedPlayerInName = p.preferredName ?? p.name;
                  }
                }

                const normalized: NormalizedMatchEvent = {
                  fixtureId,
                  seq: parsed.Seq ?? parsed.seq ?? seqCounter,
                  action,
                  playerId: resolvedPlayerId || undefined,
                  playerName: resolvedPlayerName || undefined,
                  playerInId: resolvedPlayerInId || undefined,
                  playerInName: resolvedPlayerInName || undefined,
                  participantId: String(parsed.Participant ?? parsed.participant ?? ""),
                  minute: parsed.Minute ?? parsed.minute ?? data.Minute,
                  outcome: data.Outcome ?? data.outcome,
                  subtype: data.FreeKickType ?? data.freeKickType,
                  ts: new Date().toISOString(),
                  isConfirmed: (parsed.StatusId ?? 0) >= 100 || Boolean(data.Outcome),
                };

                // Emit raw event
                send({ type: "score_event", payload: normalized });

                // Process through rating engine
                const ratingUpdates = engine.processEvent(normalized, userTrioIds);
                for (const update of ratingUpdates) {
                  send({ type: "player_rating", payload: update });
                }

                // Update players map with latest rating engine state
                for (const [id, playerState] of fixturePlayersMap.entries()) {
                  const updated = engine.getPlayer(id);
                  if (updated) {
                    playerState.rating = updated.rating;
                    playerState.eventHistory = updated.eventHistory;
                    playerState.isSubstitutedOut = updated.isSubstitutedOut;
                    playerState.enteredMatch = updated.enteredMatch;
                  }
                }

                // Benchmark
                const newBenchmark = calculateOppositionBenchmark(engine, oppositionParticipantId, benchmark);
                if (hasBenchmarkChanged(benchmark, newBenchmark)) {
                  benchmark = newBenchmark;
                  send({ type: "benchmark_update", payload: newBenchmark });
                }

                // Narrate
                const card = narrateEvent(normalized, ratingUpdates[0], userTrio, engine, benchmark);
                if (card) {
                  send({ type: "narrator", payload: card });
                }
              } catch {
                // Not JSON or parse error — skip
              }
            }

            separator = buffer.match(/\r?\n\r?\n/);
          }
        }

        reader.releaseLock();
      } catch {
        // Stream connection failed — heartbeat fallback
        while (!aborted) {
          send({ type: "heartbeat", payload: { ts: new Date().toISOString() } });
          await sleep(10000);
        }
      }

      try { controller.close(); } catch { /* already closed */ }
    },
    cancel() {
      aborted = true;
    },
  });

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

/**
 * Maps fixture.phase (a free-text string stored in D1) to a numeric GamePhaseId.
 * TxLINE archive.ts writes:  "final" | stringValue(GameState) | "unknown"
 * GameState from TxLINE may arrive as a numeric string ("3") or a text label.
 */
function resolveGamePhase(phase: string | null | undefined): GamePhaseId {
  if (!phase) return 1 as GamePhaseId;

  // Try numeric first — TxLINE sometimes sends GameState as "3", "4", etc.
  const numeric = parseInt(phase, 10);
  if (!isNaN(numeric) && numeric >= 1 && numeric <= 19) {
    return numeric as GamePhaseId;
  }

  // Text label mapping (from TxLINE field values and our own labels)
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

// ─── Parallel Odds Stream Reader ───────────────────────────────────────────

async function readOddsStream(
  body: ReadableStream<Uint8Array>,
  fixtureId: string,
  pulse: MatchPulse,
  send: (e: ClientLiveEvent) => void,
  isAborted: () => boolean,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (!isAborted()) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let separator = buffer.match(/\r?\n\r?\n/);
      while (separator?.index !== undefined) {
        const block = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);

        // Parse SSE block
        for (const rawLine of block.split(/\r?\n/)) {
          if (!rawLine.startsWith("data:")) continue;
          const dataStr = rawLine.slice(5).trim();
          if (!dataStr) continue;
          try {
            const parsed = JSON.parse(dataStr);
            // Only process odds events for our fixture
            const eventFixtureId = String(parsed.FixtureId ?? parsed.fixtureId ?? "");
            if (eventFixtureId && eventFixtureId !== fixtureId) continue;

            const update = pulse.processOddsPayload(parsed);
            if (update) {
              send({ type: "odds_pulse", payload: update });
            }
          } catch { /* skip non-JSON lines */ }
        }

        separator = buffer.match(/\r?\n\r?\n/);
      }
    }
  } catch { /* odds stream disconnected — non-fatal */ }

  try { reader.releaseLock(); } catch { /* already released */ }
}
