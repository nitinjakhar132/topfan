import { eq, or } from "drizzle-orm";
import { ensureArchiveDatabase, getDb } from "@/db";
import { fixtures, playerMatchStats, players, teams } from "@/db/schema";

export async function GET(_request: Request, context: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await context.params;
  await ensureArchiveDatabase();
  const db = getDb();
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) return Response.json({ error: "Team not found." }, { status: 404 });
  const [fixtureRows, playerRows] = await Promise.all([
    db.select().from(fixtures).where(or(eq(fixtures.homeTeamId, teamId), eq(fixtures.awayTeamId, teamId))),
    db.select().from(players).where(eq(players.teamId, teamId)),
  ]);
  const stats = await db.select().from(playerMatchStats);
  const teamPlayerIds = new Set(playerRows.map((player) => player.id));
  const teamStats = stats.filter((row) => teamPlayerIds.has(row.playerId));
  return Response.json({ team, fixtures: fixtureRows, players: playerRows.map((player) => ({
    ...player,
    totals: teamStats.filter((row) => row.playerId === player.id).reduce((sum, row) => ({
      minutes: sum.minutes + row.minutes,
      goals: sum.goals + row.goals,
      assists: sum.assists + row.assists,
      chancesCreated: sum.chancesCreated + row.chancesCreated,
      tackles: sum.tackles + row.tackles,
      shotsOnTarget: sum.shotsOnTarget + row.shotsOnTarget,
      performanceScore: sum.performanceScore + row.performanceScore,
    }), { minutes: 0, goals: 0, assists: 0, chancesCreated: 0, tackles: 0, shotsOnTarget: 0, performanceScore: 0 }),
  })) });
}
