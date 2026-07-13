import { eq } from "drizzle-orm";
import { ensureArchiveDatabase, getDb } from "@/db";
import { fixtures, playerMatchStats, players, teams } from "@/db/schema";

export async function GET(_request: Request, context: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await context.params;
  await ensureArchiveDatabase();
  const db = getDb();
  const [player] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  if (!player) return Response.json({ error: "Player not found." }, { status: 404 });
  const [team, matches, fixtureRows] = await Promise.all([
    db.select().from(teams).where(eq(teams.id, player.teamId)).limit(1),
    db.select().from(playerMatchStats).where(eq(playerMatchStats.playerId, playerId)),
    db.select().from(fixtures),
  ]);
  const fixtureMap = new Map(fixtureRows.map((fixture) => [fixture.id, fixture]));
  const totals = matches.reduce((sum, match) => ({
    minutes: sum.minutes + match.minutes,
    goals: sum.goals + match.goals,
    assists: sum.assists + match.assists,
    chancesCreated: sum.chancesCreated + match.chancesCreated,
    tackles: sum.tackles + match.tackles,
    shotsOnTarget: sum.shotsOnTarget + match.shotsOnTarget,
    performanceScore: sum.performanceScore + match.performanceScore,
  }), { minutes: 0, goals: 0, assists: 0, chancesCreated: 0, tackles: 0, shotsOnTarget: 0, performanceScore: 0 });
  return Response.json({ player, team: team[0] ?? null, totals, matches: matches.map((match) => ({ ...match, fixture: fixtureMap.get(match.fixtureId) ?? null })) });
}
