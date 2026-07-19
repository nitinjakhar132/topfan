import { getDb } from "@/db";
import { playerTournamentStats } from "@/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * Same-Position Percentile & Spider Chart Dimension Calculator
 *
 * Compares players within their specific position group (ATT, MID, DEF, GK)
 * and competition stage. Computes the 6 universal capability-aware axes:
 * Form, Impact, Threat, Big Moments, Reliability, Discipline.
 *
 * Stores percentiles between 0 and 100. Unqualified/no-data dimensions are stored as null.
 */

interface RawStatsForPercentile {
  playerId: string;
  position: string;
  teamId: string;
  qualified: boolean;
  
  // raw dimensions
  formVal: number;
  impactVal: number;
  threatVal: number;
  bigMomentsVal: number;
  reliabilityVal: number;
  disciplineVal: number; // lower is better, we invert it
}

export async function recalculatePositionPercentiles(competitionId: string): Promise<number> {
  const db = getDb();

  // Load all tournament stats for this competition
  const allStats = await db
    .select()
    .from(playerTournamentStats)
    .where(eq(playerTournamentStats.competitionId, competitionId));

  if (!allStats.length) return 0;

  // Map to raw percentile values
  const players = allStats.map((p) => {
    // 1. Form dimension raw value
    const formVal = p.recentFormRating ?? p.simpleAverageRating ?? 6.0;

    // 2. Impact dimension raw value
    const impactVal = p.minutesWeightedRating ?? p.simpleAverageRating ?? 6.0;

    // 3. Threat dimension: goals and shots on target per 90, penalty goals
    const threatVal =
      (p.goalsPer90 ?? 0) * 1.5 +
      (p.shotsOnTargetPer90 ?? 0) * 0.4 +
      ((p.totalPenaltyGoals ?? 0) / Math.max(1, p.appearances)) * 0.5;

    // 4. Big Moments: decisive actions (goals + assists + penalties)
    const bigMomentsVal =
      (p.totalGoals ?? 0) * 1.0 +
      (p.totalAssists ?? 0) * 0.8 +
      (p.totalPenaltyGoals ?? 0) * 0.5;

    // 5. Reliability: appearances rate + starts rate + total minutes
    const matchesNamed = Math.max(1, p.matchesNamed);
    const reliabilityVal =
      (p.appearances / matchesNamed) * 50 +
      (p.starts / matchesNamed) * 50 +
      (p.totalMinutes / 90) * 10;

    // 6. Discipline: yellow/red cards, own goals per match. Higher cards = worse.
    const appearances = Math.max(1, p.appearances);
    const cardsPerMatch =
      ((p.totalYellowCards ?? 0) * 1.0 +
        (p.totalRedCards ?? 0) * 3.0 +
        (p.totalOwnGoals ?? 0) * 2.5) /
      appearances;
    
    // We want higher disciplineVal to mean BETTER discipline (fewer cards)
    // Map disciplineVal to max out at 10 and subtract penalty
    const disciplineVal = Math.max(0, 10 - cardsPerMatch);

    return {
      playerId: p.playerId,
      position: p.position,
      teamId: p.teamId,
      qualified: p.qualifiedForPercentiles,
      formVal,
      impactVal,
      threatVal,
      bigMomentsVal,
      reliabilityVal,
      disciplineVal,
      ratingForRank: p.minutesWeightedRating ?? p.simpleAverageRating ?? 0.0,
    };
  });

  // Helper to calculate rank-percentile: 0 to 100
  // Formula: (rank - 1) / (total - 1) * 100
  const calculatePercentile = (sortedVals: number[], val: number): number => {
    if (sortedVals.length <= 1) return 100;
    const index = sortedVals.indexOf(val);
    if (index === -1) return 50;
    return Math.round((index / (sortedVals.length - 1)) * 100);
  };

  // Group by position
  const positions = ["ATT", "MID", "DEF", "GK"];
  let updatedCount = 0;

  for (const pos of positions) {
    const posPlayers = players.filter((p) => p.position === pos);
    const qualifiedPlayers = posPlayers.filter((p) => p.qualified);

    // Sorted arrays of qualified values for percentiles
    const forms = qualifiedPlayers.map(p => p.formVal).sort((a, b) => a - b);
    const impacts = qualifiedPlayers.map(p => p.impactVal).sort((a, b) => a - b);
    const threats = qualifiedPlayers.map(p => p.threatVal).sort((a, b) => a - b);
    const bigMoments = qualifiedPlayers.map(p => p.bigMomentsVal).sort((a, b) => a - b);
    const reliabilities = qualifiedPlayers.map(p => p.reliabilityVal).sort((a, b) => a - b);
    const disciplines = qualifiedPlayers.map(p => p.disciplineVal).sort((a, b) => a - b);

    // Calculate ranking by rating (all position players)
    const sortedByRating = [...posPlayers].sort((a, b) => b.ratingForRank - a.ratingForRank);

    for (const player of posPlayers) {
      // Rankings
      const posRank = sortedByRating.findIndex(p => p.playerId === player.playerId) + 1;

      // Team rank
      const teamPlayers = players.filter(p => p.teamId === player.teamId);
      const sortedTeam = [...teamPlayers].sort((a, b) => b.ratingForRank - a.ratingForRank);
      const teamRank = sortedTeam.findIndex(p => p.playerId === player.playerId) + 1;

      // Percentiles (only for qualified players, otherwise null)
      const spiderForm = player.qualified ? calculatePercentile(forms, player.formVal) : null;
      const spiderImpact = player.qualified ? calculatePercentile(impacts, player.impactVal) : null;
      const spiderThreat = player.qualified ? calculatePercentile(threats, player.threatVal) : null;
      const spiderBigMoments = player.qualified ? calculatePercentile(bigMoments, player.bigMomentsVal) : null;
      const spiderReliability = player.qualified ? calculatePercentile(reliabilities, player.reliabilityVal) : null;
      const spiderDiscipline = player.qualified ? calculatePercentile(disciplines, player.disciplineVal) : null;

      await db
        .update(playerTournamentStats)
        .set({
          spiderForm,
          spiderImpact,
          spiderThreat,
          spiderBigMoments,
          spiderReliability,
          spiderDiscipline,
          positionRank: posRank,
          teamRank,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(playerTournamentStats.playerId, player.playerId),
            eq(playerTournamentStats.competitionId, competitionId)
          )
        );

      updatedCount++;
    }
  }

  return updatedCount;
}
