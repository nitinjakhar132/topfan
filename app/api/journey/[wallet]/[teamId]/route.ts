/**
 * GET /api/journey/[wallet]/[teamId]
 *
 * Returns the full Team Journey page data:
 * - Hero metrics (rank, score, percentile, eligibility)
 * - Match timeline with trio names, Match Index, rank movement
 * - Trusted players (most-selected)
 * - Leaderboard preview (top 3 + user position)
 * - Rank history strip
 */

import { eq, and, desc, sql, count, asc } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { getCurrentStage } from "@/lib/journey/engine";
import { getFixtureScores } from "@/lib/live/scores";
import type {
  TeamJourneyPageData,
  MatchTimelineEntry,
  TrustedPlayerSummary,
  LeaderboardEntry,
} from "@/lib/journey/types";

export async function GET(
  _request: Request,
  context: { params: Promise<{ wallet: string; teamId: string }> },
) {
  try {
    const { wallet, teamId } = await context.params;
    const db = getDb();
    const competitionId = "72"; // World Cup 2026

    // ── 1. Journey hero metrics ────────────────────────────────────────────
    const [journey] = await db
      .select()
      .from(schema.supporterTeamJourneys)
      .where(
        and(
          eq(schema.supporterTeamJourneys.wallet, wallet),
          eq(schema.supporterTeamJourneys.competitionId, competitionId),
          eq(schema.supporterTeamJourneys.teamId, teamId),
        ),
      )
      .limit(1);

    const [team] = await db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.id, teamId))
      .limit(1);

    if (!team) {
      return Response.json({ error: "Team not found" }, { status: 404 });
    }

    // Get latest fixture phase for stage
    const [latestFixture] = await db
      .select({ phase: schema.fixtures.phase })
      .from(schema.fixtures)
      .where(
        sql`(${schema.fixtures.homeTeamId} = ${teamId} OR ${schema.fixtures.awayTeamId} = ${teamId})`,
      )
      .orderBy(desc(schema.fixtures.startsAt))
      .limit(1);

    const journeyCard = {
      teamId,
      teamName: team.name,
      teamCode: team.code,
      flag: team.flag,
      status: journey?.status ?? "active",
      currentStage: getCurrentStage(latestFixture?.phase ?? null),
      matchesFollowed: journey?.matchesFollowed ?? 0,
      eligibleMatches: journey?.eligibleMatches ?? 0,
      totalJourneyScore: journey?.totalJourneyScore ?? 0,
      averageMatchIndex: journey?.averageMatchIndex ?? null,
      currentTeamRank: journey?.currentTeamRank ?? null,
      percentile: journey?.percentile ?? null,
      topFanEligible: journey?.topFanEligible ?? false,
    };

    // ── 2. Match timeline ──────────────────────────────────────────────────
    // Get all fixtures for this team
    const teamFixtures = await db
      .select()
      .from(schema.fixtures)
      .where(
        and(
          eq(schema.fixtures.competitionId, competitionId),
          sql`(${schema.fixtures.homeTeamId} = ${teamId} OR ${schema.fixtures.awayTeamId} = ${teamId})`,
        ),
      )
      .orderBy(asc(schema.fixtures.startsAt));

    // Get all match journeys for this user+team
    const matchJourneys = await db
      .select()
      .from(schema.supporterMatchJourneys)
      .where(
        and(
          eq(schema.supporterMatchJourneys.wallet, wallet),
          eq(schema.supporterMatchJourneys.teamId, teamId),
        ),
      );

    const matchJourneyMap = new Map(matchJourneys.map((mj) => [mj.fixtureId, mj]));

    // Build timeline
    const timeline: MatchTimelineEntry[] = await Promise.all(
      teamFixtures.map(async (f) => {
        const isHome = f.homeTeamId === teamId;
        const opponentId = isHome ? f.awayTeamId : f.homeTeamId;

        // Get opponent team name
        const [oppTeam] = await db
          .select({ name: schema.teams.name, flag: schema.teams.flag })
          .from(schema.teams)
          .where(eq(schema.teams.id, opponentId))
          .limit(1);

        const mj = matchJourneyMap.get(f.id);

        // Determine status
        let status: MatchTimelineEntry["status"] = "upcoming";
        const phaseLower = (f.phase || "").toLowerCase();
        if (f.finalisedAt || phaseLower === "final" || phaseLower === "completed" || phaseLower === "finished") status = "completed";
        else if (phaseLower === "live" || phaseLower === "2nd half" || phaseLower === "half_time" || phaseLower === "1st half") status = "live";

        // Build match result string
        let matchResult: string | null = null;
        const { homeScore, awayScore } = getFixtureScores(f.id, f.homeScore, f.awayScore);
        if (homeScore !== null && awayScore !== null) {
          const homeName = isHome ? team.name : (oppTeam?.name ?? "Unknown");
          const awayName = isHome ? (oppTeam?.name ?? "Unknown") : team.name;
          matchResult = `${homeName} ${homeScore}–${awayScore} ${awayName}`;
        }

        // Get trio player names if match was followed
        let trioNames: [string, string, string] | null = null;
        if (mj) {
          const playerIds = [mj.attackerId, mj.midfielderId, mj.defenderId];
          const players = await db
            .select({ id: schema.players.id, displayName: schema.players.displayName, name: schema.players.name })
            .from(schema.players)
            .where(sql`${schema.players.id} IN (${sql.join(playerIds.map((id) => sql`${id}`), sql`, `)})`);

          const nameMap = new Map(players.map((p) => [p.id, p.displayName ?? p.name.split(",")[0]]));
          trioNames = [
            nameMap.get(mj.attackerId) ?? "Unknown",
            nameMap.get(mj.midfielderId) ?? "Unknown",
            nameMap.get(mj.defenderId) ?? "Unknown",
          ];
        }

        return {
          fixtureId: f.id,
          stage: getCurrentStage(f.phase),
          opponent: oppTeam?.name ?? "Unknown",
          opponentFlag: oppTeam?.flag ?? "",
          matchResult,
          trioNames,
          finalMatchIndex: mj?.finalMatchIndex ?? null,
          rankBefore: mj?.rankBefore ?? null,
          rankAfter: mj?.rankAfter ?? null,
          status,
          startsAt: f.startsAt,
        };
      }),
    );

    // ── 3. Trusted players ─────────────────────────────────────────────────
    const playerHistory = await db
      .select({
        playerId: schema.userPlayerHistory.playerId,
        timesSelected: schema.userPlayerHistory.timesSelected,
        averageRatingWhenSelected: schema.userPlayerHistory.averageRatingWhenSelected,
        supporterPointsGenerated: schema.userPlayerHistory.supporterPointsGenerated,
        bestFixtureId: schema.userPlayerHistory.bestFixtureId,
      })
      .from(schema.userPlayerHistory)
      .where(
        and(
          eq(schema.userPlayerHistory.wallet, wallet),
          eq(schema.userPlayerHistory.competitionId, competitionId),
        ),
      )
      .orderBy(desc(schema.userPlayerHistory.timesSelected))
      .limit(5);

    const trustedPlayers: TrustedPlayerSummary[] = await Promise.all(
      playerHistory.map(async (ph) => {
        const [player] = await db
          .select({
            displayName: schema.players.displayName,
            name: schema.players.name,
            position: schema.players.position,
            teamId: schema.players.teamId,
          })
          .from(schema.players)
          .where(eq(schema.players.id, ph.playerId))
          .limit(1);

        // Only include players from this team
        if (player && player.teamId !== teamId) {
          return null;
        }

        // Get best fixture opponent name
        let bestFixtureOpponent: string | null = null;
        if (ph.bestFixtureId) {
          const [bestFixture] = await db
            .select()
            .from(schema.fixtures)
            .where(eq(schema.fixtures.id, ph.bestFixtureId))
            .limit(1);
          if (bestFixture) {
            const oppId = bestFixture.homeTeamId === teamId ? bestFixture.awayTeamId : bestFixture.homeTeamId;
            const [oppTeam] = await db
              .select({ name: schema.teams.name })
              .from(schema.teams)
              .where(eq(schema.teams.id, oppId))
              .limit(1);
            bestFixtureOpponent = oppTeam?.name ?? null;
          }
        }

        return {
          playerId: ph.playerId,
          playerName: player?.displayName ?? player?.name ?? "Unknown",
          position: player?.position ?? "ATT",
          timesSelected: ph.timesSelected,
          averageRatingWhenSelected: ph.averageRatingWhenSelected,
          supporterPointsGenerated: ph.supporterPointsGenerated,
          bestFixtureId: ph.bestFixtureId,
          bestFixtureOpponent,
        };
      }),
    );

    const filteredTrusted = trustedPlayers.filter((p): p is TrustedPlayerSummary => p !== null);

    // ── 4. Leaderboard preview ─────────────────────────────────────────────
    const top3 = await db
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
      .limit(3);

    // Get display names for top 3
    const leaderboardTop: LeaderboardEntry[] = await Promise.all(
      top3.map(async (entry, idx) => {
        const [user] = await db
          .select({ displayName: schema.users.displayName })
          .from(schema.users)
          .where(eq(schema.users.wallet, entry.wallet))
          .limit(1);
        return {
          rank: idx + 1,
          wallet: entry.wallet,
          displayName: user?.displayName ?? entry.wallet.substring(0, 12) + "...",
          totalScore: entry.totalScore,
          isCurrentUser: entry.wallet === wallet,
        };
      }),
    );

    // User's entry if not in top 3
    let userEntry: LeaderboardEntry | null = null;
    if (!leaderboardTop.some((e) => e.isCurrentUser) && journey) {
      const [user] = await db
        .select({ displayName: schema.users.displayName })
        .from(schema.users)
        .where(eq(schema.users.wallet, wallet))
        .limit(1);
      userEntry = {
        rank: journey.currentTeamRank ?? 0,
        wallet,
        displayName: user?.displayName ?? "You",
        totalScore: journey.totalJourneyScore,
        isCurrentUser: true,
      };
    }

    // Total participants
    const [participantsResult] = await db
      .select({ count: count() })
      .from(schema.supporterTeamJourneys)
      .where(
        and(
          eq(schema.supporterTeamJourneys.competitionId, competitionId),
          eq(schema.supporterTeamJourneys.teamId, teamId),
        ),
      );

    // Top 1% cutoff
    const totalParticipants = participantsResult?.count ?? 0;
    const top1PercentIdx = Math.max(0, Math.ceil(totalParticipants * 0.01) - 1);
    let top1PercentCutoff: number | null = null;
    if (totalParticipants > 0) {
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
        .offset(top1PercentIdx);
      top1PercentCutoff = cutoffEntry?.score ?? null;
    }

    // ── 5. Rank history strip ──────────────────────────────────────────────
    const rankHistory = matchJourneys
      .filter((mj) => mj.rankAfter !== null)
      .sort((a, b) => a.participationNumber - b.participationNumber)
      .map((mj) => mj.rankAfter!);

    // ── Assemble response ──────────────────────────────────────────────────
    const response: TeamJourneyPageData = {
      journey: journeyCard,
      timeline,
      trustedPlayers: filteredTrusted,
      leaderboard: {
        top: leaderboardTop,
        user: userEntry,
        totalParticipants,
        top1PercentCutoff,
      },
      rankHistory,
    };

    return Response.json(response);
  } catch (error) {
    console.error("[Journey API] Error loading team journey:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not load team journey" },
      { status: 500 },
    );
  }
}
