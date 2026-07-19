/**
 * ONE NATION — Live Leaderboard
 *
 * In-memory leaderboard per fixture. Tracks trio totals for all participating
 * wallets and emits rank-change events whenever ratings update.
 *
 * Design decisions:
 * - In-memory only during the match; persisted to matchScores only at FT
 * - Ranks update whenever ANY player rating changes (affects all trios that include that player)
 * - Only the affected wallet's SSE connection receives its update
 */

export type LeaderboardEntry = {
  wallet: string;
  attackerId: string;
  midfielderId: string;
  defenderId: string;
  /** Current live trio total rating */
  trioTotal: number;
  /** Current rank (1 = best) */
  rank: number;
  /** Rank from previous recalculation */
  prevRank: number;
};

export type LeaderboardUpdate = {
  wallet: string;
  rank: number;
  prevRank: number;
  rankDelta: number;
  totalParticipants: number;
  trioTotal: number;
  /** Human-readable movement label */
  movementLabel: string;
  ts: string;
};

// ─── LiveLeaderboard ─────────────────────────────────────────────────────────

export class LiveLeaderboard {
  private fixtureId: string;
  /** wallet → entry */
  private entries: Map<string, LeaderboardEntry> = new Map();
  /** playerId → Set of wallets that have that player in their trio */
  private playerToWallets: Map<string, Set<string>> = new Map();

  constructor(fixtureId: string) {
    this.fixtureId = fixtureId;
  }

  /**
   * Register a wallet's trio for live tracking.
   * Returns the initial LeaderboardUpdate so it can be sent on connection.
   */
  registerTrio(
    wallet: string,
    attackerId: string,
    midfielderId: string,
    defenderId: string,
    currentRatings: Record<string, number>,
  ): LeaderboardUpdate {
    const trioTotal = this.calcTrioTotal(attackerId, midfielderId, defenderId, currentRatings);

    const existingEntry = this.entries.get(wallet);
    const prevRank = existingEntry?.rank ?? 0;

    this.entries.set(wallet, {
      wallet,
      attackerId,
      midfielderId,
      defenderId,
      trioTotal,
      rank: 0, // will be set by recalculate
      prevRank,
    });

    // Index player→wallet
    for (const pid of [attackerId, midfielderId, defenderId]) {
      if (!this.playerToWallets.has(pid)) this.playerToWallets.set(pid, new Set());
      this.playerToWallets.get(pid)!.add(wallet);
    }

    this.recalculateRanks();
    return this.buildUpdate(wallet);
  }

  /**
   * Called when a player rating changes. Returns an array of LeaderboardUpdates
   * for all wallets whose trios include that player AND whose rank changed.
   */
  onPlayerRatingChange(
    playerId: string,
    newRating: number,
    allRatings: Record<string, number>,
  ): LeaderboardUpdate[] {
    const affectedWallets = this.playerToWallets.get(playerId) ?? new Set<string>();
    if (affectedWallets.size === 0) return [];

    // Update trio totals for affected wallets
    const updatedAllRatings = { ...allRatings, [playerId]: newRating };

    for (const wallet of affectedWallets) {
      const entry = this.entries.get(wallet);
      if (!entry) continue;
      entry.trioTotal = this.calcTrioTotal(
        entry.attackerId,
        entry.midfielderId,
        entry.defenderId,
        updatedAllRatings,
      );
    }

    // Recalculate all ranks
    const prevRanks = new Map<string, number>();
    for (const [w, e] of this.entries) prevRanks.set(w, e.rank);

    this.recalculateRanks();

    // Emit updates only for wallets whose rank actually changed
    const updates: LeaderboardUpdate[] = [];
    for (const wallet of affectedWallets) {
      const entry = this.entries.get(wallet);
      if (!entry) continue;
      if (entry.rank !== prevRanks.get(wallet)) {
        updates.push(this.buildUpdate(wallet));
      }
    }
    return updates;
  }

  /**
   * Get current leaderboard update for a wallet.
   */
  getUpdate(wallet: string): LeaderboardUpdate | null {
    if (!this.entries.has(wallet)) return null;
    return this.buildUpdate(wallet);
  }

  /** Total participants registered */
  get size(): number {
    return this.entries.size;
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private calcTrioTotal(
    attackerId: string,
    midfielderId: string,
    defenderId: string,
    ratings: Record<string, number>,
  ): number {
    const total =
      (ratings[attackerId] ?? 6.0) +
      (ratings[midfielderId] ?? 6.0) +
      (ratings[defenderId] ?? 6.0);
    return Math.round(total * 10) / 10;
  }

  private recalculateRanks(): void {
    // Sort by trioTotal descending, then by wallet alphabetically for stable ordering
    const sorted = Array.from(this.entries.values()).sort((a, b) => {
      if (b.trioTotal !== a.trioTotal) return b.trioTotal - a.trioTotal;
      return a.wallet.localeCompare(b.wallet);
    });

    for (let i = 0; i < sorted.length; i++) {
      const entry = this.entries.get(sorted[i].wallet)!;
      entry.prevRank = entry.rank || i + 1;
      entry.rank = i + 1;
    }
  }

  private buildUpdate(wallet: string): LeaderboardUpdate {
    const entry = this.entries.get(wallet)!;
    const rankDelta = entry.prevRank > 0 ? entry.prevRank - entry.rank : 0;
    let movementLabel = "";

    if (rankDelta > 0) {
      movementLabel = `You moved up ${rankDelta} place${rankDelta !== 1 ? "s" : ""}`;
    } else if (rankDelta < 0) {
      movementLabel = `You dropped ${Math.abs(rankDelta)} place${Math.abs(rankDelta) !== 1 ? "s" : ""}`;
    }

    return {
      wallet,
      rank: entry.rank,
      prevRank: entry.prevRank,
      rankDelta,
      totalParticipants: this.entries.size,
      trioTotal: entry.trioTotal,
      movementLabel,
      ts: new Date().toISOString(),
    };
  }
}
