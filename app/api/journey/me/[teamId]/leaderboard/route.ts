import { eq, and, desc, sql, count, gte, lte } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import type { LeaderboardEntry } from "@/lib/journey/types";

export async function GET(
  request: Request,
  context: { params: Promise<{ teamId: string }> },
) {
  try {
    const { teamId } = await context.params;
    const url = new URL(request.url);
    const wallet = url.searchParams.get("wallet") || request.headers.get("x-wallet-address");
    const aroundMe = url.searchParams.get("aroundMe") === "true";
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);

    if (!wallet) {
      return Response.json(
        { error: "Missing required wallet parameter/header." },
        { status: 400 }
      );
    }

    const db = getDb();
    const competitionId = "72"; // World Cup 2026

    // 1. Get user's current rank & score
    const [userJourney] = await db
      .select({
        wallet: schema.supporterTeamJourneys.wallet,
        totalScore: schema.supporterTeamJourneys.totalJourneyScore,
        currentTeamRank: schema.supporterTeamJourneys.currentTeamRank,
      })
      .from(schema.supporterTeamJourneys)
      .where(
        and(
          eq(schema.supporterTeamJourneys.wallet, wallet),
          eq(schema.supporterTeamJourneys.competitionId, competitionId),
          eq(schema.supporterTeamJourneys.teamId, teamId),
        ),
      )
      .limit(1);

    const userScore = userJourney?.totalScore ?? 0;
    const userRank = userJourney?.currentTeamRank ?? null;

    // 2. Fetch total participants count
    const [participantsResult] = await db
      .select({ count: count() })
      .from(schema.supporterTeamJourneys)
      .where(
        and(
          eq(schema.supporterTeamJourneys.competitionId, competitionId),
          eq(schema.supporterTeamJourneys.teamId, teamId),
        ),
      );
    const totalParticipants = participantsResult?.count ?? 0;

    // 3. Fetch Leaders (Top ranks)
    const leadersQuery = await db
      .select({
        wallet: schema.supporterTeamJourneys.wallet,
        totalScore: schema.supporterTeamJourneys.totalJourneyScore,
        currentTeamRank: schema.supporterTeamJourneys.currentTeamRank,
      })
      .from(schema.supporterTeamJourneys)
      .where(
        and(
          eq(schema.supporterTeamJourneys.competitionId, competitionId),
          eq(schema.supporterTeamJourneys.teamId, teamId),
        ),
      )
      .orderBy(desc(schema.supporterTeamJourneys.totalJourneyScore))
      .limit(limit);

    // Map leaders with displayName
    const leaders: LeaderboardEntry[] = await Promise.all(
      leadersQuery.map(async (entry, idx) => {
        const [user] = await db
          .select({ displayName: schema.users.displayName })
          .from(schema.users)
          .where(eq(schema.users.wallet, entry.wallet))
          .limit(1);
        return {
          rank: entry.currentTeamRank ?? idx + 1,
          wallet: entry.wallet,
          displayName: user?.displayName ?? entry.wallet.substring(0, 12) + "...",
          totalScore: entry.totalScore,
          isCurrentUser: entry.wallet === wallet,
        };
      })
    );

    // 4. Fetch around me entries if requested
    let entriesAroundMe: LeaderboardEntry[] = [];
    if (aroundMe && userRank && userRank > limit) {
      const minRank = Math.max(1, userRank - 5);
      const maxRank = Math.min(totalParticipants, userRank + 5);

      const aroundQuery = await db
        .select({
          wallet: schema.supporterTeamJourneys.wallet,
          totalScore: schema.supporterTeamJourneys.totalJourneyScore,
          currentTeamRank: schema.supporterTeamJourneys.currentTeamRank,
        })
        .from(schema.supporterTeamJourneys)
        .where(
          and(
            eq(schema.supporterTeamJourneys.competitionId, competitionId),
            eq(schema.supporterTeamJourneys.teamId, teamId),
            gte(schema.supporterTeamJourneys.currentTeamRank, minRank),
            lte(schema.supporterTeamJourneys.currentTeamRank, maxRank),
          ),
        )
        .orderBy(schema.supporterTeamJourneys.currentTeamRank);

      entriesAroundMe = await Promise.all(
        aroundQuery.map(async (entry) => {
          const [user] = await db
            .select({ displayName: schema.users.displayName })
            .from(schema.users)
            .where(eq(schema.users.wallet, entry.wallet))
            .limit(1);
          return {
            rank: entry.currentTeamRank ?? 0,
            wallet: entry.wallet,
            displayName: user?.displayName ?? entry.wallet.substring(0, 12) + "...",
            totalScore: entry.totalScore,
            isCurrentUser: entry.wallet === wallet,
          };
        })
      );
    }

    // 5. Calculate next milestone cutoff
    // Let's check cutoffs for top 1%, top 10% and top 100
    const top1Idx = Math.max(0, Math.ceil(totalParticipants * 0.01) - 1);
    const top10Idx = Math.max(0, Math.ceil(totalParticipants * 0.1) - 1);
    const top100Idx = Math.min(totalParticipants - 1, 99);

    const getCutoffScore = async (idx: number) => {
      if (totalParticipants <= idx) return null;
      const [cutoffEntry] = await db
        .select({ score: schema.supporterTeamJourneys.totalJourneyScore })
        .from(schema.supporterTeamJourneys)
        .where(
          and(
            eq(schema.supporterTeamJourneys.competitionId, competitionId),
            eq(schema.supporterTeamJourneys.teamId, teamId),
          ),
        )
        .orderBy(desc(schema.supporterTeamJourneys.totalJourneyScore))
        .limit(1)
        .offset(idx);
      return cutoffEntry?.score ?? null;
    };

    const top1Cutoff = await getCutoffScore(top1Idx);
    const top10Cutoff = await getCutoffScore(top10Idx);
    const top100Cutoff = await getCutoffScore(top100Idx);

    let nextCutoff = null;
    if (top10Cutoff && userScore < top10Cutoff) {
      nextCutoff = {
        label: "Top 10%",
        score: top10Cutoff,
        distance: top10Cutoff - userScore,
      };
    } else if (top1Cutoff && userScore < top1Cutoff) {
      nextCutoff = {
        label: "Top 1%",
        score: top1Cutoff,
        distance: top1Cutoff - userScore,
      };
    } else if (top100Cutoff && userScore < top100Cutoff) {
      nextCutoff = {
        label: "Top 100",
        score: top100Cutoff,
        distance: top100Cutoff - userScore,
      };
    }

    return Response.json({
      leaders,
      aroundMe: entriesAroundMe,
      user: userRank ? {
        rank: userRank,
        wallet,
        displayName: "You",
        totalScore: userScore,
        isCurrentUser: true,
      } : null,
      nextCutoff,
      totalParticipants,
    });
  } catch (error) {
    console.error("[Leaderboard API] Error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not load leaderboard" },
      { status: 500 },
    );
  }
}
