import { eq, and, desc, sql } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { getCurrentStage } from "@/lib/journey/engine";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const wallet = url.searchParams.get("wallet") || request.headers.get("x-wallet-address");

    if (!wallet) {
      return Response.json(
        { error: "Missing required wallet parameter/header." },
        { status: 400 }
      );
    }

    const db = getDb();
    const competitionId = "72"; // World Cup 2026

    // 1. Fetch all journeys for this user
    const journeys = await db
      .select({
        id: schema.supporterTeamJourneys.id,
        teamId: schema.supporterTeamJourneys.teamId,
        teamName: schema.teams.name,
        teamCode: schema.teams.code,
        flag: schema.teams.flag,
        status: schema.supporterTeamJourneys.status,
        matchesFollowed: schema.supporterTeamJourneys.matchesFollowed,
        eligibleMatches: schema.supporterTeamJourneys.eligibleMatches,
        totalJourneyScore: schema.supporterTeamJourneys.totalJourneyScore,
        averageMatchIndex: schema.supporterTeamJourneys.averageMatchIndex,
        currentTeamRank: schema.supporterTeamJourneys.currentTeamRank,
        percentile: schema.supporterTeamJourneys.percentile,
        topFanEligible: schema.supporterTeamJourneys.topFanEligible,
        startedAt: schema.supporterTeamJourneys.startedAt,
        completedAt: schema.supporterTeamJourneys.completedAt,
        lastParticipatedAt: schema.supporterTeamJourneys.lastParticipatedAt,
      })
      .from(schema.supporterTeamJourneys)
      .innerJoin(schema.teams, eq(schema.supporterTeamJourneys.teamId, schema.teams.id))
      .where(
        and(
          eq(schema.supporterTeamJourneys.wallet, wallet),
          eq(schema.supporterTeamJourneys.competitionId, competitionId)
        )
      )
      .orderBy(desc(schema.supporterTeamJourneys.totalJourneyScore));

    // 2. Enrich journeys with next fixtures & rank delta
    const enrichedJourneys = await Promise.all(
      journeys.map(async (j) => {
        // A. Determine current stage from latest fixture
        const [latestFixture] = await db
          .select({ phase: schema.fixtures.phase })
          .from(schema.fixtures)
          .where(
            sql`(${schema.fixtures.homeTeamId} = ${j.teamId} OR ${schema.fixtures.awayTeamId} = ${j.teamId})`
          )
          .orderBy(desc(schema.fixtures.startsAt))
          .limit(1);

        const currentStage = getCurrentStage(latestFixture?.phase ?? null);

        // B. Get rank delta from last finalized match
        const [lastMatch] = await db
          .select({
            rankBefore: schema.supporterMatchJourneys.rankBefore,
            rankAfter: schema.supporterMatchJourneys.rankAfter,
          })
          .from(schema.supporterMatchJourneys)
          .where(
            and(
              eq(schema.supporterMatchJourneys.wallet, wallet),
              eq(schema.supporterMatchJourneys.teamId, j.teamId)
            )
          )
          .orderBy(desc(schema.supporterMatchJourneys.finalisedAt))
          .limit(1);

        const rankDeltaLastMatch =
          lastMatch?.rankBefore && lastMatch?.rankAfter
            ? lastMatch.rankBefore - lastMatch.rankAfter
            : null;

        // C. Find next upcoming fixture
        const nowStr = new Date().toISOString();
        const [nextFix] = await db
          .select()
          .from(schema.fixtures)
          .where(
            and(
              eq(schema.fixtures.competitionId, competitionId),
              sql`(${schema.fixtures.homeTeamId} = ${j.teamId} OR ${schema.fixtures.awayTeamId} = ${j.teamId})`,
              sql`${schema.fixtures.startsAt} > ${nowStr}`
            )
          )
          .orderBy(schema.fixtures.startsAt)
          .limit(1);

        let nextFixtureData = null;
        if (nextFix) {
          const opponentId =
            nextFix.homeTeamId === j.teamId ? nextFix.awayTeamId : nextFix.homeTeamId;

          const [opponent] = await db
            .select({ name: schema.teams.name })
            .from(schema.teams)
            .where(eq(schema.teams.id, opponentId))
            .limit(1);

          // In this mockup, lineups status is confirmed if startsAt is within 2 hours
          const startsAtMs = new Date(nextFix.startsAt).getTime();
          const timeDiff = startsAtMs - Date.now();
          const lineupStatus = timeDiff < 2 * 60 * 60 * 1000 ? "confirmed" : "pending";

          nextFixtureData = {
            id: nextFix.id,
            opponentName: opponent?.name ?? "TBD",
            startsAt: nextFix.startsAt,
            lineupStatus: lineupStatus as "pending" | "confirmed",
            matchStatus: (nextFix.phase === "live" || nextFix.phase === "half_time" ? "live" : "scheduled") as "scheduled" | "live",
          };
        }

        return {
          teamId: j.teamId,
          teamName: j.teamName,
          flagUrl: j.flag,
          status: j.status,
          currentStage,
          matchesFollowed: j.matchesFollowed,
          eligibleMatches: j.eligibleMatches,
          totalJourneyScore: j.totalJourneyScore,
          currentRank: j.currentTeamRank,
          rankDeltaLastMatch,
          percentile: j.percentile,
          topFanEligible: j.topFanEligible,
          nextFixture: nextFixtureData,
        };
      })
    );

    // Categorize journeys
    const active = enrichedJourneys.filter((j) => j.status === "active");
    const completed = enrichedJourneys.filter(
      (j) => j.status === "completed" || j.status === "eliminated"
    );

    // Primary journey is the active journey with highest score or most recent participation
    const primaryJourney = active.length > 0 ? active[0] : null;
    const activeJourneys = active.filter((j) => j.teamId !== primaryJourney?.teamId);

    // 3. Fetch recent events
    const recentEvents = await db
      .select({
        id: schema.supporterJourneyEvents.id,
        wallet: schema.supporterJourneyEvents.wallet,
        competitionId: schema.supporterJourneyEvents.competitionId,
        teamId: schema.supporterJourneyEvents.teamId,
        fixtureId: schema.supporterJourneyEvents.fixtureId,
        eventType: schema.supporterJourneyEvents.eventType,
        occurredAt: schema.supporterJourneyEvents.occurredAt,
        headline: schema.supporterJourneyEvents.headline,
        summary: schema.supporterJourneyEvents.summary,
      })
      .from(schema.supporterJourneyEvents)
      .where(
        and(
          eq(schema.supporterJourneyEvents.wallet, wallet),
          eq(schema.supporterJourneyEvents.competitionId, competitionId)
        )
      )
      .orderBy(desc(schema.supporterJourneyEvents.occurredAt))
      .limit(10);

    return Response.json({
      primaryJourney,
      activeJourneys,
      completedJourneys: completed,
      recentEvents,
    });
  } catch (error) {
    console.error("[Support Hub API] Error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
