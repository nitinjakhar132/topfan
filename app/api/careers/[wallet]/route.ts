import { and, count, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { matchScores, teams, users } from "@/db/schema";

export async function GET(_request: Request, context: { params: Promise<{ wallet: string }> }) {
  try {
    const { wallet } = await context.params;
    const db = getDb();
    const [profile] = await db.select().from(users).where(eq(users.wallet, wallet)).limit(1);
    const careers = await db
      .select({
        teamId: matchScores.teamId,
        teamName: teams.name,
        code: teams.code,
        flag: teams.flag,
        matchesSupported: count(matchScores.fixtureId),
        cumulativeScore: sql<number>`sum(${matchScores.contribution})`,
        averagePercentile: sql<number>`avg(${matchScores.percentile})`,
      })
      .from(matchScores)
      .innerJoin(teams, eq(matchScores.teamId, teams.id))
      .where(eq(matchScores.wallet, wallet))
      .groupBy(matchScores.teamId)
      .orderBy(desc(count(matchScores.fixtureId)), desc(sql`sum(${matchScores.contribution})`));

    const ranked = await Promise.all(careers.map(async (career) => {
      const totals = db
        .select({ wallet: matchScores.wallet, total: sql<number>`sum(${matchScores.contribution})`.as("total") })
        .from(matchScores)
        .where(eq(matchScores.teamId, career.teamId))
        .groupBy(matchScores.wallet)
        .as("totals");
      const [standing] = await db.select({
        rank: sql<number>`1 + sum(case when ${totals.total} > ${career.cumulativeScore} then 1 else 0 end)`,
        supporters: count(),
      }).from(totals);
      const percentile = standing.supporters <= 1 ? 100 :
        ((standing.supporters - standing.rank) / (standing.supporters - 1)) * 100;
      return { ...career, rank: standing.rank, supporters: standing.supporters, percentile };
    }));

    ranked.sort((a, b) => {
      if (a.teamId === profile?.primaryTeamId) return -1;
      if (b.teamId === profile?.primaryTeamId) return 1;
      return b.matchesSupported - a.matchesSupported || b.cumulativeScore - a.cumulativeScore;
    });
    return Response.json({ profile, careers: ranked });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load careers" }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ wallet: string }> }) {
  try {
    const { wallet } = await context.params;
    const body = await request.json() as { primaryTeamId?: string; displayName?: string };
    if (!body.primaryTeamId) return Response.json({ error: "primaryTeamId is required" }, { status: 400 });
    const db = getDb();
    const [existing] = await db.select().from(users).where(eq(users.wallet, wallet)).limit(1);
    if (existing?.primaryTeamId && existing.primaryTeamId !== body.primaryTeamId) {
      return Response.json({ error: "Primary fan team is locked once selected." }, { status: 409 });
    }
    await db.insert(users).values({ wallet, primaryTeamId: body.primaryTeamId, displayName: body.displayName ?? "Supporter" })
      .onConflictDoUpdate({ target: users.wallet, set: { primaryTeamId: body.primaryTeamId } });
    return Response.json({ saved: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save primary team" }, { status: 500 });
  }
}

