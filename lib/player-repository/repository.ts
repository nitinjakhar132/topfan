import { ensureArchiveDatabase, getDb } from "@/db";
import { fixtures, playerTournamentStats, players, lineups, playerTraits, userPlayerHistory, playerMatchStats, supporterMatchJourneys, teams } from "@/db/schema";
import { normalizeFixtureEvents } from "./normalize-events";
import { reconstructFixtureMatchStats } from "./calculate-match-stats";
import { rateFixturePlayers } from "./calculate-match-rating";
import { recalculateTournamentStats } from "./calculate-tournament-stats";
import { recalculatePositionPercentiles } from "./calculate-percentiles";
import { generateFixturePlayerTraits } from "./generate-traits";
import { updateUserPlayerJourney } from "./update-user-player-history";
import { PlayerPassportResponse, PlayerIdentity, PlayerTournamentSummary, SpiderProfile, PlayerTrait, PlayerMatchHistoryItem } from "./types";
import { eq, and, desc } from "drizzle-orm";

/**
 * Player Data Repository Core Orchestrator
 *
 * Provides a clean orchestrator interface for full batch rebuilds
 * and quick incremental post-match updates. Exposes high-level data
 * retrieval methods for the API layer.
 */

export async function rebuildPlayerRepository(
  competitionId: string
): Promise<{ playersProcessed: number; elapsedMs: number }> {
  const start = Date.now();
  await ensureArchiveDatabase();
  const db = getDb();

  // Load all matches in competition
  const matches = await db
    .select()
    .from(fixtures)
    .where(eq(fixtures.competitionId, competitionId));

  console.log(`[Repository Rebuild] Found ${matches.length} fixtures in competition ${competitionId}`);

  // Sort chronologically to maintain correct form ratings sequence
  const sortedMatches = [...matches].sort(
    (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)
  );

  let eventsCount = 0;
  let statsCount = 0;
  let ratedCount = 0;

  // 1. Process matches in chronological order
  for (const match of sortedMatches) {
    const isFinal = match.phase === "final" || match.finalisedAt !== null;
    
    // Normalize events
    const ec = await normalizeFixtureEvents(match.id);
    eventsCount += ec;

    // Reconstruct raw stats
    const sc = await reconstructFixtureMatchStats(match.id);
    statsCount += sc;

    // Rate players
    const rc = await rateFixturePlayers(match.id, isFinal);
    ratedCount += rc;

    console.log(`[Repository Rebuild] Fixture ${match.id} normalised. Stats: ${sc}, Events: ${ec}, Rated: ${rc}`);
  }

  // 2. Perform tournament aggregates
  const aggCount = await recalculateTournamentStats(competitionId);
  console.log(`[Repository Rebuild] Compiled aggregates for ${aggCount} players.`);

  // 3. Recalculate position percentiles (requires tournament stats to be computed first)
  const percCount = await recalculatePositionPercentiles(competitionId);
  console.log(`[Repository Rebuild] Calculated same-position percentiles for ${percCount} players.`);

  // 4. Generate traits
  const traitCount = await generateFixturePlayerTraits(competitionId);
  console.log(`[Repository Rebuild] Generated ${traitCount} player traits.`);

  // 5. Update user-player journeys
  let userJourneys = 0;
  for (const match of sortedMatches) {
    if (match.phase === "final" || match.finalisedAt !== null) {
      const uj = await updateUserPlayerJourney(match.id, competitionId);
      userJourneys += uj;
    }
  }
  console.log(`[Repository Rebuild] Updated ${userJourneys} user-player journey records.`);

  const elapsed = Date.now() - start;
  return {
    playersProcessed: aggCount,
    elapsedMs: elapsed,
  };
}

export async function updateIncrementalStats(
  fixtureId: string,
  competitionId: string,
  isFinal: boolean
): Promise<void> {
  await ensureArchiveDatabase();
  
  // 1. Ingest events
  await normalizeFixtureEvents(fixtureId);

  // 2. Reconstruct statistics
  await reconstructFixtureMatchStats(fixtureId);

  // 3. Rate match players
  await rateFixturePlayers(fixtureId, isFinal);

  // Get the players who actually played/were named in this match
  const db = getDb();
  const matchStats = await db
    .select()
    .from(playerMatchStats)
    .where(eq(playerMatchStats.fixtureId, fixtureId));

  const playerIds = matchStats.map((s) => s.playerId);

  if (playerIds.length === 0) return;

  // 4. Update tournament stats incrementally for only these players
  await recalculateTournamentStats(competitionId, playerIds);

  // 5. Recalculate percentiles across positions (since bounds/ranks shift)
  await recalculatePositionPercentiles(competitionId);

  // 6. Regenerate traits for affected players
  await generateFixturePlayerTraits(competitionId, playerIds);

  // 7. Update user-player histories if finalized
  if (isFinal) {
    await updateUserPlayerJourney(fixtureId, competitionId);

    // Supporter Journey Finalisation
    try {
      const { finaliseMatchJourney } = await import("@/lib/journey/engine");
      const { picks: picksTable } = await import("@/db/schema");
      
      const userPicks = await db
        .select()
        .from(picksTable)
        .where(eq(picksTable.fixtureId, fixtureId));

      if (userPicks.length > 0) {
        const playerRatingsMap = new Map(matchStats.map(r => [r.playerId, r.finalRating ?? r.impactRating ?? 6.0]));

        // Fetch fixture teams to identify opposition
        const [fixture] = await db
          .select({
            participant1Id: fixtures.participant1Id,
            participant2Id: fixtures.participant2Id,
          })
          .from(fixtures)
          .where(eq(fixtures.id, fixtureId))
          .limit(1);

        if (fixture) {
          const p1Id = fixture.participant1Id;
          const p2Id = fixture.participant2Id;

          // Helper to calculate benchmark total for a team
          const getBenchmarkTotal = (oppTeamId: string) => {
            const teamRatings = matchStats.filter(r => r.teamId === oppTeamId);
            const getBest = (pos: string) => {
              const posRatings = teamRatings.filter(r => r.position === pos);
              if (posRatings.length === 0) return 6.0;
              return Math.max(...posRatings.map(r => r.finalRating ?? r.impactRating ?? 6.0));
            };
            const bestAtt = getBest("ATT");
            const bestMid = getBest("MID");
            const bestDef = getBest("DEF");
            return Math.round((bestAtt + bestMid + bestDef) * 10) / 10;
          };

          const benchmarkTotalP1 = p1Id ? getBenchmarkTotal(p1Id) : 18.0;
          const benchmarkTotalP2 = p2Id ? getBenchmarkTotal(p2Id) : 18.0;

          for (const pick of userPicks) {
            const wallet = pick.wallet;
            const teamId = pick.teamId;

            // Opponent is the team that is NOT our team
            const oppTeamId = teamId === p1Id ? p2Id : p1Id;
            const oppositionBenchmark = oppTeamId ? (teamId === p1Id ? benchmarkTotalP2 : benchmarkTotalP1) : 18.0;

            const attRating = playerRatingsMap.get(pick.attackerId) ?? 6.0;
            const midRating = playerRatingsMap.get(pick.midfielderId) ?? 6.0;
            const defRating = playerRatingsMap.get(pick.defenderId) ?? 6.0;
            const trioTotal = Math.round((attRating + midRating + defRating) * 10) / 10;

            const matchupIndex = oppositionBenchmark > 0
              ? Math.round((trioTotal / oppositionBenchmark) * 1000) / 10
              : 100.0;

            // Run finalisation for this user's journey
            await finaliseMatchJourney(
              db as any,
              wallet,
              competitionId,
              fixtureId,
              teamId,
              pick.attackerId,
              pick.midfielderId,
              pick.defenderId,
              trioTotal,
              oppositionBenchmark,
              matchupIndex
            );
          }
        }
      }
    } catch (journeyError) {
      console.error("[Journey Finalisation] Failed to process supporter journeys:", journeyError);
    }
  }
}

export async function getPlayerPassport(
  playerId: string,
  competitionId: string,
  wallet?: string
): Promise<PlayerPassportResponse | null> {
  await ensureArchiveDatabase();
  const db = getDb();

  // Load player identity
  const [player] = await db
    .select()
    .from(players)
    .where(eq(players.id, playerId))
    .limit(1);

  if (!player) return null;

  const identity: PlayerIdentity = {
    id: player.id,
    normativeId: player.normativeId,
    preferredName: player.preferredName,
    displayName: player.displayName || player.name,
    teamId: player.teamId,
    position: player.position as any,
    primaryPosition: player.primaryPosition as any,
    shirtNumber: player.shirtNumber,
    photoUrl: player.photoUrl,
  };

  // Load tournament aggregate
  const [tour] = await db
    .select()
    .from(playerTournamentStats)
    .where(
      and(
        eq(playerTournamentStats.playerId, playerId),
        eq(playerTournamentStats.competitionId, competitionId)
      )
    )
    .limit(1);

  let tournament: PlayerTournamentSummary | null = null;
  let spider: SpiderProfile | null = null;

  if (tour) {
    spider = {
      form: tour.spiderForm,
      impact: tour.spiderImpact,
      threat: tour.spiderThreat,
      bigMoments: tour.spiderBigMoments,
      reliability: tour.spiderReliability,
      discipline: tour.spiderDiscipline,
      availableAxes: ["form", "impact", "threat", "bigMoments", "reliability", "discipline"].filter(
        (key) => (tour as any)[`spider${key.charAt(0).toUpperCase() + key.slice(1)}`] !== null
      ),
      sampleQuality: tour.sampleQuality as any,
    };

    tournament = {
      playerId: tour.playerId,
      competitionId: tour.competitionId,
      teamId: tour.teamId,
      position: tour.position as any,
      matchesNamed: tour.matchesNamed,
      appearances: tour.appearances,
      starts: tour.starts,
      substituteAppearances: tour.substituteAppearances,
      totalMinutes: tour.totalMinutes,
      totalGoals: tour.totalGoals,
      totalAssists: tour.totalAssists,
      totalShots: tour.totalShots,
      totalShotsOnTarget: tour.totalShotsOnTarget,
      totalChancesCreated: tour.totalChancesCreated,
      totalTackles: tour.totalTackles,
      totalYellowCards: tour.totalYellowCards,
      totalRedCards: tour.totalRedCards,
      totalOwnGoals: tour.totalOwnGoals,
      totalPenaltyAttempts: tour.totalPenaltyAttempts,
      totalPenaltyGoals: tour.totalPenaltyGoals,
      goalsPer90: tour.goalsPer90,
      assistsPer90: tour.assistsPer90,
      shotsPer90: tour.shotsPer90,
      shotsOnTargetPer90: tour.shotsOnTargetPer90,
      chancesCreatedPer90: tour.chancesCreatedPer90,
      tacklesPer90: tour.tacklesPer90,
      minutesWeightedRating: tour.minutesWeightedRating,
      simpleAverageRating: tour.simpleAverageRating,
      bestRating: tour.bestRating,
      worstRating: tour.worstRating,
      recentFormRating: tour.recentFormRating,
      consistencyScore: tour.consistencyScore,
      formTrend: tour.formTrend as any,
      spider,
      positionRank: tour.positionRank,
      teamRank: tour.teamRank,
      qualifiedForPercentiles: tour.qualifiedForPercentiles === true,
      availableMetrics: JSON.parse(tour.availableMetricsJson),
      sampleQuality: tour.sampleQuality as any,
      ratingVersion: tour.ratingVersion,
    };
  }

  // Load traits
  const traitsRows = await db
    .select()
    .from(playerTraits)
    .where(
      and(
        eq(playerTraits.playerId, playerId),
        eq(playerTraits.competitionId, competitionId)
      )
    );

  const traits: PlayerTrait[] = traitsRows.map((t) => ({
    traitKey: t.traitKey as any,
    traitStrength: t.traitStrength,
    evidence: JSON.parse(t.evidenceJson),
    label: t.traitKey.replace(/_/g, " "),
  }));

  // Load match history (joining with fixture metadata)
  const matchStatsList = await db
    .select()
    .from(playerMatchStats)
    .where(eq(playerMatchStats.playerId, playerId));

  const fixturesList = await db
    .select()
    .from(fixtures)
    .where(eq(fixtures.competitionId, competitionId));

  const fixtureMap = new Map(fixturesList.map((f) => [f.id, f]));

  // Sort match history chronologically (descending)
  const matchHistory: PlayerMatchHistoryItem[] = matchStatsList
    .map((s) => {
      const f = fixtureMap.get(s.fixtureId);
      if (!f) return null;
      
      const isHome = f.homeTeamId === s.teamId;
      const opponentId = isHome ? f.awayTeamId : f.homeTeamId;
      
      // Simple opponent name logic or lookup team name here
      const opponent = isHome ? "Opponent" : "Opponent"; // Resolved in endpoint or UI

      return {
        fixtureId: s.fixtureId,
        opponent,
        opponentId,
        date: f.startsAt,
        competitionStage: f.phase,
        teamScore: isHome ? f.homeScore : f.awayScore,
        opponentScore: isHome ? f.awayScore : f.homeScore,
        starter: s.starter ?? false,
        enteredMatch: s.enteredMatch ?? false,
        minutesPlayed: s.minutesPlayed ?? 0,
        finalRating: s.finalRating,
        goals: s.goals,
        assists: s.assists,
        yellowCards: s.yellowCards,
        redCards: s.redCards,
        availableStats: s.availableMetricsJson ? JSON.parse(s.availableMetricsJson) : [],
        ratingContributions: [], // Hydrated in client detail load
      };
    })
    .filter((x): x is any => x !== null)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date)) as PlayerMatchHistoryItem[];

  // Load personal history
  let personalHistory: any = undefined;
  if (wallet) {
    const [journey] = await db
      .select()
      .from(userPlayerHistory)
      .where(
        and(
          eq(userPlayerHistory.wallet, wallet),
          eq(userPlayerHistory.playerId, playerId),
          eq(userPlayerHistory.competitionId, competitionId)
        )
      )
      .limit(1);

    if (journey) {
      let bestFixtureOpponent: string | null = null;
      if (journey.bestFixtureId) {
        const [bestF] = await db
          .select()
          .from(fixtures)
          .where(eq(fixtures.id, journey.bestFixtureId))
          .limit(1);
        if (bestF) {
          const isHome = bestF.homeTeamId === player.teamId;
          const oppId = isHome ? bestF.awayTeamId : bestF.homeTeamId;
          const [oppT] = await db
            .select({ name: teams.name })
            .from(teams)
            .where(eq(teams.id, oppId))
            .limit(1);
          bestFixtureOpponent = oppT?.name ?? null;
        }
      }

      // Calculate consecutive selections from picks or supporterMatchJourneys
      let consecutiveSelections = 0;
      try {
        const selections = await db
          .select({
            attackerId: supporterMatchJourneys.attackerId,
            midfielderId: supporterMatchJourneys.midfielderId,
            defenderId: supporterMatchJourneys.defenderId,
          })
          .from(supporterMatchJourneys)
          .where(
            and(
              eq(supporterMatchJourneys.wallet, wallet),
              eq(supporterMatchJourneys.competitionId, competitionId)
            )
          )
          .orderBy(desc(supporterMatchJourneys.finalisedAt));

        for (const sel of selections) {
          if (
            sel.attackerId === playerId ||
            sel.midfielderId === playerId ||
            sel.defenderId === playerId
          ) {
            consecutiveSelections++;
          } else {
            break;
          }
        }
      } catch (e) {
        console.error("Error calculating consecutive selections:", e);
      }

      personalHistory = {
        timesSelected: journey.timesSelected,
        completedSelections: journey.completedSelections,
        averageRatingWhenSelected: journey.averageRatingWhenSelected,
        positionComparisonsWon: journey.positionComparisonsWon,
        supporterPointsGenerated: journey.supporterPointsGenerated,
        bestFixtureId: journey.bestFixtureId,
        bestFixtureOpponent,
        consecutiveSelections: consecutiveSelections || 1,
        lastSelectedFixtureId: journey.lastSelectedFixtureId,
      };
    }
  }

  return {
    player: identity,
    tournament,
    spider,
    traits,
    matchHistory,
    availableMetrics: tournament ? tournament.availableMetrics : [],
    personalHistory,
  };
}
export * from "./types";
export * from "./capabilities";
export * from "./identity";
export * from "./normalize-events";
export * from "./calculate-match-stats";
export * from "./calculate-match-rating";
export * from "./calculate-tournament-stats";
export * from "./calculate-percentiles";
export * from "./generate-traits";
export * from "./update-user-player-history";
