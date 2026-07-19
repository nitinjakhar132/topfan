/**
 * POST /api/live/fixtures/:fixtureId/pick
 *
 * Registers or updates a supporter's trio selection for a fixture.
 * Used for live leaderboard tracking.
 *
 * Body: { wallet: string, teamId: string, attackerId: string, midfielderId: string, defenderId: string }
 */

import { eq, and } from "drizzle-orm";
import { ensureArchiveDatabase, getDb } from "@/db";
import { picks, fixtures } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ fixtureId: string }> },
) {
  try {
    const { fixtureId } = await context.params;

    await ensureArchiveDatabase();
    const db = getDb();

    // Validate fixture exists
    const [fixture] = await db
      .select({ id: fixtures.id, competitionId: fixtures.competitionId })
      .from(fixtures)
      .where(eq(fixtures.id, fixtureId))
      .limit(1);

    if (!fixture) {
      return Response.json({ error: "Fixture not found" }, { status: 404 });
    }

    const body = (await request.json()) as {
      wallet?: string;
      teamId?: string;
      attackerId?: string;
      midfielderId?: string;
      defenderId?: string;
    };

    const { wallet, teamId, attackerId, midfielderId, defenderId } = body;

    if (!wallet || !teamId || !attackerId || !midfielderId || !defenderId) {
      return Response.json(
        { error: "Missing required fields: wallet, teamId, attackerId, midfielderId, defenderId" },
        { status: 400 },
      );
    }

    // Upsert pick
    const existing = await db
      .select({ id: picks.id })
      .from(picks)
      .where(and(eq(picks.fixtureId, fixtureId), eq(picks.wallet, wallet)))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(picks)
        .set({ teamId, attackerId, midfielderId, defenderId })
        .where(and(eq(picks.fixtureId, fixtureId), eq(picks.wallet, wallet)));
    } else {
      await db.insert(picks).values({
        fixtureId,
        wallet,
        teamId,
        attackerId,
        midfielderId,
        defenderId,
      });
    }

    // Supporter Journey Initialization & Lock Event
    try {
      const { ensureTeamJourney } = await import("@/lib/journey/engine");
      const { supporterJourneyEvents } = await import("@/db/schema");
      const competitionId = fixture.competitionId || "72";
      
      // Ensure the journey exists
      await ensureTeamJourney(db as any, wallet, competitionId, teamId);

      // Record trio_locked journey event
      await db.insert(supporterJourneyEvents).values({
        wallet,
        competitionId,
        teamId,
        fixtureId,
        eventType: "trio_locked",
        headline: "TRIO LOCKED",
        summary: "Locked your attacker, midfielder and defender selection for this match.",
        metadataJson: JSON.stringify({
          attackerId,
          midfielderId,
          defenderId,
        }),
      });
    } catch (journeyErr) {
      console.error("[pick] Supporter journey initialisation failed:", journeyErr);
    }

    return Response.json({
      ok: true,
      fixtureId,
      wallet,
      trio: { attackerId, midfielderId, defenderId },
    });
  } catch (err) {
    console.error("[pick] Error:", err);
    return Response.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
