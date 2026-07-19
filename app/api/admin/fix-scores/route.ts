import { ensureArchiveDatabase, getDb } from "@/db";
import { fixtures } from "@/db/schema";
import { eq } from "drizzle-orm";
import { KNOWN_FIXTURE_SCORES } from "@/lib/live/scores";

export async function GET() {
  await ensureArchiveDatabase();
  const db = getDb();
  
  let updatedCount = 0;

  for (const [fixtureId, scores] of Object.entries(KNOWN_FIXTURE_SCORES)) {
    try {
      await db.update(fixtures)
        .set({ homeScore: scores[0], awayScore: scores[1] })
        .where(eq(fixtures.id, fixtureId));
      updatedCount++;
    } catch (err) {
      console.error(`Error updating fixture ${fixtureId}:`, err);
    }
  }

  return Response.json({ success: true, updatedCount });
}
