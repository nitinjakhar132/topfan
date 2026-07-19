/**
 * GET /api/journey/[wallet]
 *
 * Returns all team journeys for a wallet — powers the My Teams hub.
 */

import { eq, desc } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { getCurrentStage } from "@/lib/journey/engine";

export async function GET(
  _request: Request,
  context: { params: Promise<{ wallet: string }> },
) {
  try {
    const { wallet } = await context.params;
    const db = getDb();

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
      })
      .from(schema.supporterTeamJourneys)
      .innerJoin(schema.teams, eq(schema.supporterTeamJourneys.teamId, schema.teams.id))
      .where(eq(schema.supporterTeamJourneys.wallet, wallet))
      .orderBy(desc(schema.supporterTeamJourneys.totalJourneyScore));

    // Determine current stage for each team from their latest fixture
    const enriched = await Promise.all(
      journeys.map(async (j) => {
        // Get the latest fixture for this team to determine stage
        const [latestFixture] = await db
          .select({ phase: schema.fixtures.phase })
          .from(schema.fixtures)
          .where(eq(schema.fixtures.homeTeamId, j.teamId))
          .orderBy(desc(schema.fixtures.startsAt))
          .limit(1);

        const currentStage = getCurrentStage(latestFixture?.phase ?? null);

        return {
          ...j,
          currentStage,
        };
      }),
    );

    // Sort: active first, then by score desc
    enriched.sort((a, b) => {
      if (a.status === "active" && b.status !== "active") return -1;
      if (a.status !== "active" && b.status === "active") return 1;
      return b.totalJourneyScore - a.totalJourneyScore;
    });

    return Response.json({ journeys: enriched });
  } catch (error) {
    console.error("[Journey API] Error loading journeys:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not load journeys" },
      { status: 500 },
    );
  }
}
