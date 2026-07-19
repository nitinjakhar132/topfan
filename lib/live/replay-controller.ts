/**
 * ONE NATION — Replay Controller
 *
 * Loads stored raw events from the database for a given fixture and
 * replays them through the SAME rating engine and narrator pipeline
 * as live mode. Events are emitted via the same client SSE channel,
 * clearly labelled as "REPLAY".
 *
 * Supports: 1×, 5×, 20× playback speeds, pause, resume, restart.
 */

import type {
  NormalizedMatchEvent,
  ReplaySpeed,
  ReplayState,
  ClientLiveEvent,
  UserTrio,
  OppositionBenchmark,
  LiveFixtureState,
  GamePhaseId,
} from "./types";
import { serializeFixtureState } from "./types";
import { LiveRatingEngine } from "./rating-engine";
import { calculateOppositionBenchmark, hasBenchmarkChanged } from "./benchmark";
import { narrateEvent } from "./narrator";

// ─── Event Normalizer ──────────────────────────────────────────────────────

type RawEventRow = {
  fixtureId: string;
  sequence: number;
  action: string | null;
  confirmed: boolean | null;
  participantId: string | null;
  playerId: string | null;
  matchMinute: number | null;
  rawPayload: string;
};

/**
 * Normalize a raw DB event row into the canonical NormalizedMatchEvent shape.
 */
export function normalizeRawEvent(row: RawEventRow): NormalizedMatchEvent {
  let minute: number | undefined = row.matchMinute ?? undefined;
  let playerName: string | undefined;
  let outcome: string | undefined;
  let subtype: string | undefined;

  try {
    const payload = JSON.parse(row.rawPayload);
    const data = payload?.DataSoccer ?? payload?.Data ?? {};
    playerName = data?.PlayerName ?? data?.playerName;
    outcome = data?.Outcome ?? data?.outcome;
    subtype = data?.FreeKickType ?? data?.freeKickType;

    if (payload?.Clock?.Seconds !== undefined) {
      minute = Math.floor(payload.Clock.Seconds / 60);
    }

    // For substitutions, playerId is the outgoing player
    if (row.action === "substitution" && !playerName) {
      playerName = data?.PlayerOutName ?? data?.playerOutName;
    }
  } catch {
    // rawPayload may not be valid JSON — use what we have
  }

  return {
    fixtureId: row.fixtureId,
    seq: row.sequence,
    action: row.action ?? "unknown",
    playerId: row.playerId ?? undefined,
    playerInId: row.playerInId ?? undefined,
    playerName,
    participantId: row.participantId ?? undefined,
    minute,
    outcome,
    subtype,
    ts: new Date().toISOString(),
    isConfirmed: true, // Treat all events as confirmed for replay/completed matches
  };
}

// ─── Replay Controller ─────────────────────────────────────────────────────

export type ReplayEventEmitter = (event: ClientLiveEvent) => void;

export class ReplayController {
  private events: NormalizedMatchEvent[] = [];
  private engine: LiveRatingEngine;
  private state: ReplayState;
  private emit: ReplayEventEmitter;
  private userTrio: UserTrio;
  private oppositionParticipantId: string;
  private benchmark: OppositionBenchmark;
  private fixtureState: LiveFixtureState;
  private intervalId: ReturnType<typeof setTimeout> | null = null;
  private currentIndex: number = 0;

  constructor(
    fixtureId: string,
    rawEvents: RawEventRow[],
    userTrio: UserTrio,
    oppositionParticipantId: string,
    fixtureState: LiveFixtureState,
    emit: ReplayEventEmitter,
  ) {
    this.engine = new LiveRatingEngine();
    this.emit = emit;
    this.userTrio = userTrio;
    this.oppositionParticipantId = oppositionParticipantId;
    this.fixtureState = fixtureState;

    // Normalize and sort events
    this.events = rawEvents
      .map(normalizeRawEvent)
      .sort((a, b) => a.seq - b.seq);

    this.state = {
      fixtureId,
      speed: 1,
      currentSeq: 0,
      totalEvents: this.events.length,
      isPaused: false,
      isComplete: false,
      elapsedMs: 0,
    };

    this.benchmark = {
      bestATT: null,
      bestMID: null,
      bestDEF: null,
      benchmarkTotal: 0,
    };
  }

  /** Initialize player states in the rating engine from the fixture state. */
  initializePlayers(): void {
    for (const [id, player] of this.fixtureState.players) {
      this.engine.initPlayer(
        id,
        player.playerName,
        player.position,
        player.participantId,
      );
    }
  }

  /** Start replay at the given speed. */
  start(speed: ReplaySpeed = 1): void {
    this.state.speed = speed;
    this.state.isPaused = false;
    this.state.isComplete = false;
    this.currentIndex = 0;

    // Reset engine
    this.initializePlayers();

    // Send initial snapshot
    this.emit({
      type: "connection",
      payload: { status: "replay", fixtureId: this.state.fixtureId },
    });

    this.emit({
      type: "fixture_snapshot",
      payload: serializeFixtureState(this.fixtureState),
    });

    // Start event loop
    this.scheduleNextEvent();
  }

  /** Pause the replay. */
  pause(): void {
    this.state.isPaused = true;
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Resume from current position. */
  resume(): void {
    if (!this.state.isPaused) return;
    this.state.isPaused = false;
    this.scheduleNextEvent();
  }

  /** Change playback speed. */
  setSpeed(speed: ReplaySpeed): void {
    this.state.speed = speed;
    // Restart the schedule with new speed
    if (!this.state.isPaused && this.intervalId) {
      clearTimeout(this.intervalId);
      this.scheduleNextEvent();
    }
  }

  /** Restart from the beginning. */
  restart(speed?: ReplaySpeed): void {
    this.stop();
    if (speed) this.state.speed = speed;
    this.start(this.state.speed);
  }

  /** Stop the replay completely. */
  stop(): void {
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }
    this.state.isPaused = false;
    this.state.isComplete = true;
  }

  /** Get current replay state. */
  getState(): ReplayState {
    return { ...this.state };
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private scheduleNextEvent(): void {
    if (this.currentIndex >= this.events.length) {
      this.state.isComplete = true;
      this.emit({
        type: "finalised",
        payload: {
          fixtureId: this.state.fixtureId,
          participant1Score: this.fixtureState.participant1Score,
          participant2Score: this.fixtureState.participant2Score,
          phase: this.fixtureState.gamePhase,
          finalPlayerRatings: Object.fromEntries(
            Array.from(this.engine.getAllPlayers().entries()).map(([id, p]) => [id, p.rating])
          ),
          userTrioTotal: this.engine.getTrioTotal([
            this.userTrio.attackerId,
            this.userTrio.midfielderId,
            this.userTrio.defenderId,
          ]),
          oppositionBenchmarkTotal: this.benchmark.benchmarkTotal,
        },
      });
      return;
    }

    // Calculate delay between events based on speed
    const baseDelayMs = 2000; // 2 seconds between events at 1× speed
    const delayMs = baseDelayMs / this.state.speed;

    this.intervalId = setTimeout(() => {
      this.processNextEvent();
    }, delayMs);
  }

  private processNextEvent(): void {
    if (this.state.isPaused || this.currentIndex >= this.events.length) return;

    const event = this.events[this.currentIndex];
    this.currentIndex += 1;
    this.state.currentSeq = event.seq;

    const userTrioIds = new Set([
      this.userTrio.attackerId,
      this.userTrio.midfielderId,
      this.userTrio.defenderId,
    ]);

    // Emit the raw event
    this.emit({ type: "score_event", payload: event });

    // Process through rating engine
    const ratingUpdates = this.engine.processEvent(event, userTrioIds);
    for (const update of ratingUpdates) {
      this.emit({ type: "player_rating", payload: update });
    }

    // Recalculate opposition benchmark
    const newBenchmark = calculateOppositionBenchmark(
      this.engine,
      this.oppositionParticipantId,
      this.benchmark,
    );
    if (hasBenchmarkChanged(this.benchmark, newBenchmark)) {
      this.benchmark = newBenchmark;
      this.emit({ type: "benchmark_update", payload: newBenchmark });
    }

    // Narrate the event
    const firstUpdate = ratingUpdates[0];
    const card = narrateEvent(event, firstUpdate, this.userTrio, this.engine, this.benchmark);
    if (card) {
      this.emit({ type: "narrator", payload: card });
    }

    // Schedule next
    this.scheduleNextEvent();
  }
}
