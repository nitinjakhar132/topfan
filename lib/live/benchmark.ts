/**
 * ONE NATION — Dynamic Opposition Benchmark
 *
 * Continuously tracks the best-performing ATT, MID, DEF from the
 * opposition team based on live ratings. Recalculates on every
 * player rating update and emits benchmark_update events when the
 * best trio changes.
 */

import type { LivePlayer } from "../txline/normalize";
import type { OppositionBenchmark, OppositionBenchmarkPlayer, LivePlayerState } from "./types";
import type { LiveRatingEngine } from "./rating-engine";

/**
 * Calculate the best opposition trio from the given participant side.
 * Returns the highest-rated ATT, MID, and DEF from the opposition.
 */
export function calculateOppositionBenchmark(
  engine: LiveRatingEngine,
  oppositionParticipantId: string,
  previousBenchmark?: OppositionBenchmark,
): OppositionBenchmark {
  const oppositionPlayers = engine.getPlayersByParticipant(oppositionParticipantId);

  const best: Record<string, OppositionBenchmarkPlayer | null> = {
    ATT: null,
    MID: null,
    DEF: null,
  };

  for (const player of oppositionPlayers) {
    if (player.isSubstitutedOut) continue;
    const pos = player.position;
    if (pos !== "ATT" && pos !== "MID" && pos !== "DEF") continue;

    const current = best[pos];
    if (!current || player.rating > current.rating) {
      best[pos] = {
        playerId: player.playerId,
        playerName: player.playerName,
        position: player.position,
        rating: player.rating,
      };
    }
  }

  const benchmarkTotal = Math.round(
    ((best.ATT?.rating ?? 0) + (best.MID?.rating ?? 0) + (best.DEF?.rating ?? 0)) * 10
  ) / 10;

  return {
    bestATT: best.ATT,
    bestMID: best.MID,
    bestDEF: best.DEF,
    benchmarkTotal,
    previousTotal: previousBenchmark?.benchmarkTotal,
  };
}

/**
 * Check if the benchmark has changed (different player IDs or rating threshold).
 * Used to determine whether to emit a benchmark_update event.
 */
export function hasBenchmarkChanged(
  prev: OppositionBenchmark,
  next: OppositionBenchmark,
): boolean {
  // Player change
  if (prev.bestATT?.playerId !== next.bestATT?.playerId) return true;
  if (prev.bestMID?.playerId !== next.bestMID?.playerId) return true;
  if (prev.bestDEF?.playerId !== next.bestDEF?.playerId) return true;

  // Significant rating change (0.1+ difference in total)
  if (Math.abs(prev.benchmarkTotal - next.benchmarkTotal) >= 0.1) return true;

  return false;
}

/**
 * Determine which participant ID is the opposition for the user's team.
 */
export function getOppositionParticipantId(
  userTeamId: string,
  participant1Id: string,
  participant2Id: string,
): string {
  // The user's team is one participant; the opposition is the other.
  return userTeamId === participant1Id ? "2" : "1";
}
