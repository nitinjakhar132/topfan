import { desc } from "drizzle-orm";
import { ensureArchiveDatabase, getDb } from "@/db";
import { fixtures, teams } from "@/db/schema";

export async function GET() {
  await ensureArchiveDatabase();
  const db = getDb();
  const [fixtureRows, teamRows] = await Promise.all([
    db.select().from(fixtures).orderBy(desc(fixtures.startsAt)),
    db.select().from(teams),
  ]);
  const teamMap = new Map(teamRows.map((team) => [team.id, team]));
  return Response.json(fixtureRows.map((fixture) => ({
    ...fixture,
    homeTeam: teamMap.get(fixture.homeTeamId) ?? null,
    awayTeam: teamMap.get(fixture.awayTeamId) ?? null,
  })));
}
