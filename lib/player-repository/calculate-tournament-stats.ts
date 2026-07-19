import { getDb } from "@/db";
import { playerMatchStats, playerTournamentStats, fixtures } from "@/db/schema";
import { FormTrend, SampleQuality, sampleQualityFromMinutes } from "./types";
import { eq, and } from "drizzle-orm";

/**
 * Tournament Aggregates Calculator
 *
 * Computes tournament averages, totals, form indicators, trends, consistency scores,
 * and per-90 rates using finalised match data.
 */

interface AggregatedPlayerStats {
  playerId: string;
  competitionId: string;
  teamId: string;
  position: string;
  matchesNamed: number;
  appearances: number;
  starts: number;
  substituteAppearances: number;
  totalMinutes: number;

  totalGoals: number | null;
  totalAssists: number | null;
  totalShots: number | null;
  totalShotsOnTarget: number | null;
  totalChancesCreated: number | null;
  totalTackles: number | null;
  totalYellowCards: number | null;
  totalRedCards: number | null;
  totalOwnGoals: number | null;
  totalPenaltyAttempts: number | null;
  totalPenaltyGoals: number | null;
  totalCleanSheets: number | null;
  totalDefensiveActions: number | null;

  ratings: number[];
  ratingMinutes: number[];
}

export async function recalculateTournamentStats(
  competitionId: string,
  targetPlayerIds?: string[]
): Promise<number> {
  const db = getDb();

  // Load finalised fixtures in this competition
  const fixturesList = await db
    .select()
    .from(fixtures)
    .where(eq(fixtures.competitionId, competitionId));

  const finalisedFixtureIds = new Set(
    fixturesList
      .filter((f) => f.phase === "final" || f.finalisedAt !== null)
      .map((f) => f.id)
  );

  if (finalisedFixtureIds.size === 0) return 0;

  // Load match stats for finalised fixtures
  let allStats = await db.select().from(playerMatchStats);
  
  // Filter for finalised matches only
  allStats = allStats.filter((s) => finalisedFixtureIds.has(s.fixtureId));

  if (targetPlayerIds && targetPlayerIds.length > 0) {
    const playerSet = new Set(targetPlayerIds);
    allStats = allStats.filter((s) => playerSet.has(s.playerId));
  }

  // Group stats by player
  const playerGroups = new Map<string, typeof allStats>();
  for (const stat of allStats) {
    let group = playerGroups.get(stat.playerId);
    if (!group) {
      group = [];
      playerGroups.set(stat.playerId, group);
    }
    group.push(stat);
  }

  let count = 0;

  for (const [playerId, statsList] of playerGroups.entries()) {
    const firstStat = statsList[0];
    const teamId = firstStat.teamId || "";
    const position = firstStat.position || "ATT";

    const agg: AggregatedPlayerStats = {
      playerId,
      competitionId,
      teamId,
      position,
      matchesNamed: statsList.length,
      appearances: 0,
      starts: 0,
      substituteAppearances: 0,
      totalMinutes: 0,
      totalGoals: null,
      totalAssists: null,
      totalShots: null,
      totalShotsOnTarget: null,
      totalChancesCreated: null,
      totalTackles: null,
      totalYellowCards: null,
      totalRedCards: null,
      totalOwnGoals: null,
      totalPenaltyAttempts: null,
      totalPenaltyGoals: null,
      totalCleanSheets: null,
      totalDefensiveActions: null,
      ratings: [],
      ratingMinutes: [],
    };

    // Keep track of which metrics are supported (i.e. not null in availableMetricsJson)
    const metricsAvailable = new Set<string>();

    for (const stat of statsList) {
      if (stat.availableMetricsJson) {
        try {
          const arr = JSON.parse(stat.availableMetricsJson) as string[];
          for (const m of arr) metricsAvailable.add(m);
        } catch {}
      }

      if (stat.enteredMatch) {
        agg.appearances += 1;
        agg.totalMinutes += stat.minutesPlayed ?? 0;

        if (stat.starter) {
          agg.starts += 1;
        } else {
          agg.substituteAppearances += 1;
        }

        // Add to ratings history
        if (stat.finalRating !== null && stat.finalRating !== undefined) {
          agg.ratings.push(stat.finalRating);
          agg.ratingMinutes.push(stat.minutesPlayed ?? 1); // 1 min floor
        }
      }

      const sumField = (current: number | null, incoming: number | null, metricName: string) => {
        if (incoming === null) return current;
        metricsAvailable.add(metricName);
        return (current ?? 0) + incoming;
      };

      agg.totalGoals = sumField(agg.totalGoals, stat.goals, "goals");
      agg.totalAssists = sumField(agg.totalAssists, stat.assists, "assists");
      agg.totalShots = sumField(agg.totalShots, stat.shots, "shots");
      agg.totalShotsOnTarget = sumField(agg.totalShotsOnTarget, stat.shotsOnTarget, "shotsOnTarget");
      agg.totalChancesCreated = sumField(agg.totalChancesCreated, stat.chancesCreated, "chancesCreated");
      agg.totalTackles = sumField(agg.totalTackles, stat.tackles, "tackles");
      agg.totalYellowCards = sumField(agg.totalYellowCards, stat.yellowCards, "yellowCards");
      agg.totalRedCards = sumField(agg.totalRedCards, stat.redCards, "redCards");
      agg.totalOwnGoals = sumField(agg.totalOwnGoals, stat.ownGoals, "ownGoals");
      agg.totalPenaltyAttempts = sumField(agg.totalPenaltyAttempts, stat.penaltyAttempts, "penaltyAttempts");
      agg.totalPenaltyGoals = sumField(agg.totalPenaltyGoals, stat.penaltyGoals, "penaltyGoals");
      agg.totalCleanSheets = sumField(agg.totalCleanSheets, stat.cleanSheet ? 1 : (stat.cleanSheet === false ? 0 : null), "cleanSheets");
      agg.totalDefensiveActions = sumField(agg.totalDefensiveActions, stat.defensiveActions, "defensiveActions");
    }

    // A. Rates per 90 (require totalMinutes > 0)
    const per90 = (val: number | null) => {
      if (val === null || agg.totalMinutes <= 0) return null;
      return Math.round((val / agg.totalMinutes) * 90 * 100) / 100;
    };

    const goalsPer90 = per90(agg.totalGoals);
    const assistsPer90 = per90(agg.totalAssists);
    const shotsPer90 = per90(agg.totalShots);
    const shotsOnTargetPer90 = per90(agg.totalShotsOnTarget);
    const chancesCreatedPer90 = per90(agg.totalChancesCreated);
    const tacklesPer90 = per90(agg.totalTackles);

    // B. Weighted Rating
    let minutesWeightedRating: number | null = null;
    let simpleAverageRating: number | null = null;
    let bestRating: number | null = null;
    let worstRating: number | null = null;

    if (agg.ratings.length > 0) {
      let weightedSum = 0;
      let totalRatingMins = 0;
      let simpleSum = 0;

      for (let i = 0; i < agg.ratings.length; i++) {
        const rating = agg.ratings[i];
        const mins = agg.ratingMinutes[i];
        weightedSum += rating * mins;
        totalRatingMins += mins;
        simpleSum += rating;

        if (bestRating === null || rating > bestRating) bestRating = rating;
        if (worstRating === null || rating < worstRating) worstRating = rating;
      }

      minutesWeightedRating = totalRatingMins > 0 ? Math.round((weightedSum / totalRatingMins) * 100) / 100 : null;
      simpleAverageRating = Math.round((simpleSum / agg.ratings.length) * 100) / 100;
    }

    // C. Form, Trend, and Consistency
    let recentFormRating: number | null = null;
    let consistencyScore: number | null = null;
    let formTrend: FormTrend = "insufficient_data";

    if (agg.ratings.length >= 3) {
      // Get the last 3 matches (ordered latest to oldest)
      // Note: statsList is not guaranteed to be ordered by date. Let's join with fixture startsAt to sort correctly.
      // But we can quickly sort agg.ratings. We'll sort by fixture date in the parent repository.
      // Assuming ratings are sorted chronologically:
      const len = agg.ratings.length;
      const r1 = agg.ratings[len - 1]; // latest
      const r2 = agg.ratings[len - 2];
      const r3 = agg.ratings[len - 3];

      // Form calculation: 50% latest, 30% second, 20% third
      recentFormRating = Math.round((r1 * 0.5 + r2 * 0.3 + r3 * 0.2) * 100) / 100;

      // Trend classification
      const diff = recentFormRating - (simpleAverageRating ?? 6.0);
      if (diff > 0.15 && r1 >= r2) {
        formTrend = "rising";
      } else if (diff < -0.15 && r1 <= r2) {
        formTrend = "declining";
      } else {
        formTrend = "stable";
      }

      // Consistency: inverse of standard deviation
      const avg = simpleAverageRating ?? 6.0;
      const variance = agg.ratings.reduce((sum, r) => sum + Math.pow(r - avg, 2), 0) / len;
      const stdDev = Math.sqrt(variance);
      consistencyScore = stdDev > 0 ? Math.round((1 / stdDev) * 100) / 100 : 10; // 10 is max consistency (0 variance)
    }

    const sampleQuality = sampleQualityFromMinutes(agg.totalMinutes);

    // D. Write to player_tournament_stats
    await db.insert(playerTournamentStats).values({
      playerId,
      competitionId,
      teamId,
      position,
      matchesNamed: agg.matchesNamed,
      appearances: agg.appearances,
      starts: agg.starts,
      substituteAppearances: agg.substituteAppearances,
      totalMinutes: agg.totalMinutes,

      totalGoals: agg.totalGoals,
      totalAssists: agg.totalAssists,
      totalShots: agg.totalShots,
      totalShotsOnTarget: agg.totalShotsOnTarget,
      totalChancesCreated: agg.totalChancesCreated,
      totalTackles: agg.totalTackles,
      totalYellowCards: agg.totalYellowCards,
      totalRedCards: agg.totalRedCards,
      totalOwnGoals: agg.totalOwnGoals,
      totalPenaltyAttempts: agg.totalPenaltyAttempts,
      totalPenaltyGoals: agg.totalPenaltyGoals,
      totalCleanSheets: agg.totalCleanSheets,
      totalDefensiveActions: agg.totalDefensiveActions,

      goalsPer90,
      assistsPer90,
      shotsPer90,
      shotsOnTargetPer90,
      chancesCreatedPer90,
      tacklesPer90,

      minutesWeightedRating,
      simpleAverageRating,
      bestRating,
      worstRating,
      recentFormRating,
      consistencyScore,
      formTrend,

      qualifiedForPercentiles: agg.totalMinutes >= 90,
      availableMetricsJson: JSON.stringify([...metricsAvailable]),
      sampleQuality,
      ratingVersion: "position-v1",
      updatedAt: new Date().toISOString(),
    }).onConflictDoUpdate({
      target: [playerTournamentStats.playerId, playerTournamentStats.competitionId],
      set: {
        teamId,
        position,
        matchesNamed: agg.matchesNamed,
        appearances: agg.appearances,
        starts: agg.starts,
        substituteAppearances: agg.substituteAppearances,
        totalMinutes: agg.totalMinutes,

        totalGoals: agg.totalGoals,
        totalAssists: agg.totalAssists,
        totalShots: agg.totalShots,
        totalShotsOnTarget: agg.totalShotsOnTarget,
        totalChancesCreated: agg.totalChancesCreated,
        totalTackles: agg.totalTackles,
        totalYellowCards: agg.totalYellowCards,
        totalRedCards: agg.totalRedCards,
        totalOwnGoals: agg.totalOwnGoals,
        totalPenaltyAttempts: agg.totalPenaltyAttempts,
        totalPenaltyGoals: agg.totalPenaltyGoals,
        totalCleanSheets: agg.totalCleanSheets,
        totalDefensiveActions: agg.totalDefensiveActions,

        goalsPer90,
        assistsPer90,
        shotsPer90,
        shotsOnTargetPer90,
        chancesCreatedPer90,
        tacklesPer90,

        minutesWeightedRating,
        simpleAverageRating,
        bestRating,
        worstRating,
        recentFormRating,
        consistencyScore,
        formTrend,

        qualifiedForPercentiles: agg.totalMinutes >= 90,
        availableMetricsJson: JSON.stringify([...metricsAvailable]),
        sampleQuality,
        updatedAt: new Date().toISOString(),
      }
    });

    count++;
  }

  return count;
}
