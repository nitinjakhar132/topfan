import { eq } from "drizzle-orm";
import { ensureArchiveDatabase, getDb } from "@/db";
import { fixtureSyncState, fixtures, lineups, playerMatchStats, players, teams } from "@/db/schema";

export async function GET(_request: Request, context: { params: Promise<{ fixtureId: string }> }) {
  const { fixtureId } = await context.params;
  await ensureArchiveDatabase();
  const db = getDb();
  const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId)).limit(1);
  if (!fixture) return Response.json({ error: "Fixture not found." }, { status: 404 });
  const [teamRows, lineupRows, statRows, playerRows, syncRows] = await Promise.all([
    db.select().from(teams),
    db.select().from(lineups).where(eq(lineups.fixtureId, fixtureId)),
    db.select().from(playerMatchStats).where(eq(playerMatchStats.fixtureId, fixtureId)),
    db.select().from(players),
    db.select().from(fixtureSyncState).where(eq(fixtureSyncState.fixtureId, fixtureId)).limit(1),
  ]);
  const playerMap = new Map(playerRows.map((player) => [player.id, player]));
  const statMap = new Map(statRows.map((stats) => [stats.playerId, stats]));
  return Response.json({
    fixture: {
      ...fixture,
      homeTeam: teamRows.find((team) => team.id === fixture.homeTeamId) ?? null,
      awayTeam: teamRows.find((team) => team.id === fixture.awayTeamId) ?? null,
    },
    players: lineupRows.map((lineup) => ({ ...playerMap.get(lineup.playerId), ...lineup, stats: statMap.get(lineup.playerId) ?? null })),
    sync: syncRows[0] ?? null,
  });
}
