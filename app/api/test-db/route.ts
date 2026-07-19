import { getDb } from "@/db";
import { rawScoreEvents } from "@/db/schema";
import { sql } from "drizzle-orm";

export async function GET() {
  try {
    const db = getDb();
    const result = await db.insert(rawScoreEvents).values({
      fixtureId: "test3",
      sequence: 1,
      rawPayload: "{}",
      ingestedAt: new Date().toISOString()
    });
    return Response.json({ success: true, result });
  } catch (error) {
    const e = error as any;
    return Response.json({ success: false, error: e.message, cause: e.cause?.message || String(e.cause) });
  }
}
