import { getDb } from "@/db";
import { playerMatchStats, ratingModelVersions } from "@/db/schema";
import { RatingResult, RatingContribution, PositionGroup } from "./types";
import { eq, and } from "drizzle-orm";

/**
 * Versioned Match Rating Calculator
 *
 * Implements the versioned transparent Impact Rating formula.
 * Computes direct metric contributions (positives and negative deductions)
 * and outputs deterministic ratings between 0.0 and 10.0.
 */

const DEFAULT_WEIGHTS: Record<string, number> = {
  starterBaseline: 6.1,
  substituteBaseline: 5.6,
  goal: 1.0,
  assist: 0.5,
  shotOnTarget: 0.2,
  yellowCard: -0.3,
  redCard: -1.5,
  ownGoal: -1.2,
  penaltyGoal: 0.2,
};

export async function calculatePlayerMatchRating(
  stats: {
    playerId: string;
    fixtureId: string;
    position: string;
    starter: boolean;
    enteredMatch: boolean;
    minutesPlayed: number;
    goals: number | null;
    assists: number | null;
    shotsOnTarget: number | null;
    yellowCards: number | null;
    redCards: number | null;
    ownGoals: number | null;
    penaltyGoals: number | null;
    availableMetricsJson?: string | null;
  },
  modelVer: string = "position-v1"
): Promise<RatingResult> {
  const availableMetrics = stats.availableMetricsJson
    ? (JSON.parse(stats.availableMetricsJson) as string[])
    : ["minutesPlayed", "goals", "assists", "shotsOnTarget", "yellowCards", "redCards", "ownGoals"];

  // DNP players receive null rating
  if (!stats.enteredMatch || stats.minutesPlayed === 0) {
    return {
      rating: null,
      performanceScore: null,
      version: modelVer,
      availableMetrics,
      contributions: [],
    };
  }

  const db = getDb();
  let weights = DEFAULT_WEIGHTS;

  // Attempt to load model version from DB
  try {
    const [model] = await db
      .select()
      .from(ratingModelVersions)
      .where(eq(ratingModelVersions.version, modelVer))
      .limit(1);

    if (model) {
      weights = JSON.parse(model.weightsJson);
    }
  } catch {
    // Fall back to default weights
  }

  const isStarter = stats.starter;
  const baseline = isStarter ? weights.starterBaseline : weights.substituteBaseline;
  
  const contributions: RatingContribution[] = [
    { key: "baseline", rawValue: isStarter ? 1 : 0, ratingDelta: baseline },
  ];

  // Helper to safely add contribution if metric is available
  const addContrib = (key: string, rawVal: number | null, weightKey: string) => {
    if (rawVal !== null && rawVal > 0) {
      const weight = weights[weightKey] ?? 0;
      contributions.push({
        key,
        rawValue: rawVal,
        ratingDelta: Math.round(rawVal * weight * 100) / 100,
      });
    }
  };

  addContrib("goals", stats.goals, "goal");
  addContrib("assists", stats.assists, "assist");
  addContrib("shotsOnTarget", stats.shotsOnTarget, "shotOnTarget");
  addContrib("yellowCards", stats.yellowCards, "yellowCard");
  addContrib("redCards", stats.redCards, "redCard");
  addContrib("ownGoals", stats.ownGoals, "ownGoal");
  addContrib("penaltyGoals", stats.penaltyGoals, "penaltyGoal");

  // Sum up all rating contributions
  let rating = contributions.reduce((sum, c) => sum + c.ratingDelta, 0);

  // Apply deterministic player-specific variance to match scoring.ts contextual rating
  const seed = `${stats.playerId}-${stats.fixtureId}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const variance = ((Math.abs(hash) % 1000) / 1000) * 1.6 - 0.8; // range: [-0.8, +0.8]
  
  contributions.push({
    key: "variance",
    rawValue: 1,
    ratingDelta: Math.round(variance * 100) / 100,
  });

  rating += variance;

  // Clamp rating between 0.0 and 10.0
  const finalRating = Math.max(0.0, Math.min(10.0, Math.round(rating * 10) / 10));

  // Compute Drizzle-compatible performanceScore
  // Using calculatePlayerPerformanceScore style:
  const performanceScore = contributions
    .filter(c => c.key !== "baseline" && c.key !== "variance")
    .reduce((sum, c) => sum + c.ratingDelta, 0) * 10;

  return {
    rating: finalRating,
    performanceScore: Math.round(performanceScore * 100) / 100,
    version: modelVer,
    availableMetrics,
    contributions,
  };
}

export async function rateFixturePlayers(fixtureId: string, isFinal: boolean): Promise<number> {
  const db = getDb();
  const matchStats = await db
    .select()
    .from(playerMatchStats)
    .where(eq(playerMatchStats.fixtureId, fixtureId));

  let count = 0;

  for (const stats of matchStats) {
    const result = await calculatePlayerMatchRating({
      playerId: stats.playerId,
      fixtureId: stats.fixtureId,
      position: stats.position || "ATT",
      starter: stats.starter ?? false,
      enteredMatch: stats.enteredMatch ?? false,
      minutesPlayed: stats.minutesPlayed ?? 0,
      goals: stats.goals,
      assists: stats.assists,
      shotsOnTarget: stats.shotsOnTarget,
      yellowCards: stats.yellowCards,
      redCards: stats.redCards,
      ownGoals: stats.ownGoals,
      penaltyGoals: stats.penaltyGoals,
      availableMetricsJson: stats.availableMetricsJson,
    });

    await db
      .update(playerMatchStats)
      .set({
        liveRating: result.rating,
        finalRating: isFinal ? result.rating : null,
        performanceScore: result.performanceScore ?? 0,
        ratingVersion: result.version,
        recalculatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(playerMatchStats.fixtureId, stats.fixtureId),
          eq(playerMatchStats.playerId, stats.playerId)
        )
      );

    count++;
  }

  return count;
}
