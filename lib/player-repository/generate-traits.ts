import { getDb } from "@/db";
import { playerTournamentStats, playerTraits } from "@/db/schema";
import { TraitKey } from "./types";
import { eq, and } from "drizzle-orm";

/**
 * Rule-Based Player Trait Generator
 *
 * Scans player tournament aggregates and generates deterministic, evidence-backed
 * traits (e.g. IN_FORM, RISING, SUPER_SUB, GOAL_THREAT).
 *
 * Saves trait records with numerical strength and JSON evidence fields.
 */

interface TraitRule {
  key: TraitKey;
  evaluate: (p: any) => { qualified: boolean; strength: number; evidence: Record<string, unknown> } | null;
}

const TRAIT_RULES: TraitRule[] = [
  {
    key: "IN_FORM",
    evaluate: (p) => {
      const minApps = 3;
      if (p.appearances >= minApps && p.recentFormRating && p.recentFormRating >= 7.5) {
        return {
          qualified: true,
          strength: (p.recentFormRating - 7.5) * 40 + 50, // Scales 50-100 for ratings 7.5-8.75
          evidence: {
            rule: "recentFormRating >= 7.5",
            recentFormRating: p.recentFormRating,
            appearances: p.appearances,
          },
        };
      }
      return null;
    },
  },
  {
    key: "RISING",
    evaluate: (p) => {
      if (p.formTrend === "rising" && p.appearances >= 3) {
        return {
          qualified: true,
          strength: 75,
          evidence: {
            rule: 'formTrend === "rising"',
            recentFormRating: p.recentFormRating,
            simpleAverageRating: p.simpleAverageRating,
          },
        };
      }
      return null;
    },
  },
  {
    key: "CONSISTENT",
    evaluate: (p) => {
      if (p.consistencyScore && p.consistencyScore >= 1.5 && p.appearances >= 3) {
        return {
          qualified: true,
          strength: Math.min(100, p.consistencyScore * 10),
          evidence: {
            rule: "consistencyScore >= 1.5",
            consistencyScore: p.consistencyScore,
            appearances: p.appearances,
          },
        };
      }
      return null;
    },
  },
  {
    key: "NAILED_STARTER",
    evaluate: (p) => {
      if (p.appearances >= 3 && p.starts / p.appearances >= 0.8) {
        const rate = p.starts / p.appearances;
        return {
          qualified: true,
          strength: rate * 100,
          evidence: {
            rule: "starts / appearances >= 80%",
            starts: p.starts,
            appearances: p.appearances,
            startRate: Math.round(rate * 100) / 100,
          },
        };
      }
      return null;
    },
  },
  {
    key: "SUPER_SUB",
    evaluate: (p) => {
      if (p.substituteAppearances >= 2 && p.totalGoals && p.totalGoals / p.substituteAppearances >= 0.25) {
        return {
          qualified: true,
          strength: Math.min(100, (p.totalGoals / p.substituteAppearances) * 100),
          evidence: {
            rule: "substituteGoalsRate >= 25%",
            substituteAppearances: p.substituteAppearances,
            substituteGoals: p.totalGoals,
          },
        };
      }
      return null;
    },
  },
  {
    key: "IRON_MAN",
    evaluate: (p) => {
      if (p.totalMinutes >= 270 && p.starts === p.appearances) {
        return {
          qualified: true,
          strength: 90,
          evidence: {
            rule: "starts === appearances & minutes >= 270",
            totalMinutes: p.totalMinutes,
            starts: p.starts,
          },
        };
      }
      return null;
    },
  },
  {
    key: "GOAL_THREAT",
    evaluate: (p) => {
      if ((p.totalGoals && p.totalGoals >= 2) || (p.goalsPer90 && p.goalsPer90 >= 0.4)) {
        return {
          qualified: true,
          strength: (p.goalsPer90 ?? 0.4) * 80,
          evidence: {
            rule: "totalGoals >= 2 or goalsPer90 >= 0.4",
            totalGoals: p.totalGoals,
            goalsPer90: p.goalsPer90,
          },
        };
      }
      return null;
    },
  },
  {
    key: "BIG_GAME_PLAYER",
    evaluate: (p) => {
      // Big game player is triggered if player matches weighted rating is high and has appearances
      if (p.minutesWeightedRating && p.minutesWeightedRating >= 7.6 && p.appearances >= 3) {
        return {
          qualified: true,
          strength: (p.minutesWeightedRating - 7.6) * 50 + 50,
          evidence: {
            rule: "minutesWeightedRating >= 7.6",
            minutesWeightedRating: p.minutesWeightedRating,
            appearances: p.appearances,
          },
        };
      }
      return null;
    },
  },
  {
    key: "DISCIPLINE_RISK",
    evaluate: (p) => {
      const cardsWeight = (p.totalYellowCards ?? 0) * 1 + (p.totalRedCards ?? 0) * 3;
      if (cardsWeight >= 3) {
        return {
          qualified: true,
          strength: Math.min(100, cardsWeight * 20),
          evidence: {
            rule: "yellows + 3*reds >= 3",
            yellowCards: p.totalYellowCards,
            redCards: p.totalRedCards,
          },
        };
      }
      return null;
    },
  },
];

export async function generateFixturePlayerTraits(
  competitionId: string,
  targetPlayerIds?: string[]
): Promise<number> {
  const db = getDb();

  // 1. Fetch tournament stats
  let tourStats = await db
    .select()
    .from(playerTournamentStats)
    .where(eq(playerTournamentStats.competitionId, competitionId));

  if (targetPlayerIds && targetPlayerIds.length > 0) {
    const playerSet = new Set(targetPlayerIds);
    tourStats = tourStats.filter((p) => playerSet.has(p.playerId));
  }

  let count = 0;

  for (const stats of tourStats) {
    // Clear existing traits for target player
    await db
      .delete(playerTraits)
      .where(
        and(
          eq(playerTraits.playerId, stats.playerId),
          eq(playerTraits.competitionId, competitionId)
        )
      );

    for (const rule of TRAIT_RULES) {
      const result = rule.evaluate(stats);
      if (result && result.qualified) {
        await db.insert(playerTraits).values({
          playerId: stats.playerId,
          competitionId,
          traitKey: rule.key,
          traitStrength: result.strength,
          evidenceJson: JSON.stringify(result.evidence),
          ratingVersion: "position-v1",
          generatedAt: new Date().toISOString(),
        });
        count++;
      }
    }
  }

  return count;
}
