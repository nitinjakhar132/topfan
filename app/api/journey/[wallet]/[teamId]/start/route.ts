/**
 * POST /api/journey/[wallet]/[teamId]/start
 *
 * Creates or reactivates a team journey.
 * Called automatically when a user first selects a team in a match.
 */

import { getDb } from "@/db";
import { ensureTeamJourney } from "@/lib/journey/engine";

export async function POST(
  _request: Request,
  context: { params: Promise<{ wallet: string; teamId: string }> },
) {
  try {
    const { wallet, teamId } = await context.params;
    const db = getDb();
    const competitionId = "72"; // World Cup 2026

    const journey = await ensureTeamJourney(db, wallet, competitionId, teamId);

    return Response.json({
      success: true,
      journey: {
        id: journey.id,
        status: journey.status,
        matchesFollowed: journey.matchesFollowed,
        totalJourneyScore: journey.totalJourneyScore,
      },
    });
  } catch (error) {
    console.error("[Journey API] Error starting journey:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not start journey" },
      { status: 500 },
    );
  }
}
