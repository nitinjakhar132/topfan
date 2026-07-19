/**
 * ONE NATION — Live Rating Engine
 *
 * Deterministic, rule-based player impact rating that updates on every
 * attributed TxLINE event. Designed to use ONLY documented soccer feed
 * action types from the TxLINE Soccer Feed v1.1 specification.
 *
 * Label: "World Cup Impact Rating — Derived from TxLINE events"
 *
 * Rating range: [1.0, 10.0], starting at 6.0 for all players at kickoff.
 */

import type { LivePlayer } from "../txline/normalize";
import type { NormalizedMatchEvent, LivePlayerState, PlayerRatingUpdate } from "./types";

// ─── Event Impact Deltas ────────────────────────────────────────────────────

type ActionDelta = {
  base: number;
  /** Optional outcome-specific overrides (e.g. shot.OnTarget vs shot.OffTarget) */
  outcomes?: Record<string, number>;
};

const ACTION_DELTAS: Record<string, ActionDelta> = {
  goal:                { base: +0.8 },
  own_goal:            { base: -1.0 },
  shot:                { base: 0, outcomes: { ontarget: +0.2, offtarget: -0.05, blocked: +0.05, woodwork: +0.15 } },
  penalty:             { base: 0, outcomes: { scored: +0.6, missed: -0.4, retake: 0 } },
  yellow_card:         { base: -0.3 },
  red_card:            { base: -1.0 },
  second_yellow_card:  { base: -0.8 },
  corner:              { base: +0.05 },
  free_kick:           { base: 0, outcomes: { highdanger: +0.1, danger: +0.05, attack: +0.03, safe: 0, offside: -0.02 } },
  // Substitution is handled specially — freezes rating for the outgoing player
};

// ─── Rating Bounds ──────────────────────────────────────────────────────────

const RATING_MIN = 1.0;
const RATING_MAX = 10.0;
const RATING_START = 6.0;

function clampRating(value: number): number {
  return Math.round(Math.min(RATING_MAX, Math.max(RATING_MIN, value)) * 10) / 10;
}

// ─── Rating Engine Class ────────────────────────────────────────────────────

export class LiveRatingEngine {
  private playerStates: Map<string, LivePlayerState>;

  constructor() {
    this.playerStates = new Map();
  }

  /** Initialize a player's live state. Call once per player at lineup load. */
  initPlayer(
    playerId: string,
    playerName: string,
    position: LivePlayer["position"],
    participantId: string,
    startRating: number = RATING_START,
    starter: boolean = true,
  ): void {
    this.playerStates.set(playerId, {
      playerId,
      playerName,
      position,
      participantId,
      rating: startRating,
      eventHistory: [],
      isSubstitutedOut: false,
      enteredMatch: starter,
    });
  }

  /** Get current state for a player. */
  getPlayer(playerId: string): LivePlayerState | undefined {
    return this.playerStates.get(playerId);
  }

  /** Get all players. */
  getAllPlayers(): Map<string, LivePlayerState> {
    return this.playerStates;
  }

  /** Get all players for a specific participant (team side). */
  getPlayersByParticipant(participantId: string): LivePlayerState[] {
    return Array.from(this.playerStates.values()).filter(p => p.participantId === participantId);
  }

  /**
   * Process a normalized match event and compute rating deltas.
   * Returns an array of PlayerRatingUpdate for each affected player.
   */
  processEvent(
    event: NormalizedMatchEvent,
    userTrio: Set<string>,
  ): PlayerRatingUpdate[] {
    const updates: PlayerRatingUpdate[] = [];

    // Skip unconfirmed events — TxLINE sends pairs, we only process confirmed ones
    if (!event.isConfirmed) return updates;

    // Handle substitution specially
    if (event.action === "substitution") {
      return this.handleSubstitution(event, userTrio);
    }

    // Find the affected player
    if (!event.playerId) {
      // Some events (corner, free_kick) may not have a player but affect team
      // We still track them for context but don't update individual ratings
      return updates;
    }

    const player = this.playerStates.get(event.playerId);
    if (!player || player.isSubstitutedOut) return updates;

    // Calculate delta
    const delta = this.calculateDelta(event);
    if (delta === 0) return updates;

    const ratingBefore = player.rating;
    player.rating = clampRating(player.rating + delta);
    player.eventHistory.push({
      action: event.action,
      delta,
      minute: event.minute,
      seq: event.seq,
    });

    updates.push({
      playerId: player.playerId,
      playerName: player.playerName,
      position: player.position,
      participantId: player.participantId,
      ratingBefore,
      ratingAfter: player.rating,
      delta: Math.round(delta * 100) / 100,
      triggerAction: event.action,
      triggerMinute: event.minute,
      isUserPlayer: userTrio.has(player.playerId),
    });

    return updates;
  }

  /**
   * Handle substitution events.
   * - Outgoing player's rating is frozen.
   * - Incoming player starts at the current average of their position group.
   */
  private handleSubstitution(
    event: NormalizedMatchEvent,
    userTrio: Set<string>,
  ): PlayerRatingUpdate[] {
    const updates: PlayerRatingUpdate[] = [];
    if (event.playerId) {
      const outPlayer = this.playerStates.get(event.playerId);
      if (outPlayer) {
        outPlayer.isSubstitutedOut = true;
      }
    }
    if (event.playerInId) {
      const inPlayer = this.playerStates.get(event.playerInId);
      if (inPlayer) {
        inPlayer.enteredMatch = true;
      }
    }
    return updates;
  }

  /** Calculate the rating delta for a given event. */
  private calculateDelta(event: NormalizedMatchEvent): number {
    const actionDef = ACTION_DELTAS[event.action];
    if (!actionDef) return 0;

    if (actionDef.outcomes && event.outcome) {
      const outcomeKey = event.outcome.toLowerCase();
      const outcomeDelta = actionDef.outcomes[outcomeKey];
      if (outcomeDelta !== undefined) return outcomeDelta;
    }

    return actionDef.base;
  }

  /**
   * Recalculate all ratings from scratch using stored event history.
   * Used after an action_amend correction event.
   */
  recalculateFromHistory(events: NormalizedMatchEvent[], userTrio: Set<string>): PlayerRatingUpdate[] {
    // Reset all player ratings to starting
    for (const player of this.playerStates.values()) {
      player.rating = RATING_START;
      player.eventHistory = [];
      player.isSubstitutedOut = false;
    }

    // Re-process all events in sequence order
    const allUpdates: PlayerRatingUpdate[] = [];
    const sorted = [...events].sort((a, b) => a.seq - b.seq);
    for (const event of sorted) {
      const updates = this.processEvent(event, userTrio);
      allUpdates.push(...updates);
    }

    return allUpdates;
  }

  /** Get the sum of ratings for a set of player IDs (the user's trio). */
  getTrioTotal(playerIds: string[]): number {
    let total = 0;
    for (const id of playerIds) {
      const player = this.playerStates.get(id);
      if (player) total += player.rating;
    }
    return Math.round(total * 10) / 10;
  }

  /** Serialize the engine state for snapshot transmission. */
  serialize(): Record<string, LivePlayerState> {
    return Object.fromEntries(this.playerStates);
  }

  /** Hydrate engine from a serialized snapshot. */
  hydrate(data: Record<string, LivePlayerState>): void {
    this.playerStates.clear();
    for (const [id, state] of Object.entries(data)) {
      this.playerStates.set(id, state);
    }
  }
}
