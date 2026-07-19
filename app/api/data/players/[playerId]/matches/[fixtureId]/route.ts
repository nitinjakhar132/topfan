import { ensureArchiveDatabase, getDb } from "@/db";
import { playerMatchStats, playerMatchEvents, fixtures, teams } from "@/db/schema";
import { calculatePlayerMatchRating } from "@/lib/player-repository/calculate-match-rating";
import { eq, and } from "drizzle-orm";

/**
 * Player Match Performance Details API
 *
 * GET /api/data/players/[playerId]/matches/[fixtureId]
 * Returns one detailed match performance: match details, status, rating contribution, and timeline.
 */

export async function GET(
  _request: Request,
  context: { params: Promise<{ playerId: string; fixtureId: string }> }
) {
  const { playerId, fixtureId } = await context.params;
  await ensureArchiveDatabase();
  const db = getDb();

  // Load fixture metadata
  const [fixture] = await db
    .select()
    .from(fixtures)
    .where(eq(fixtures.id, fixtureId))
    .limit(1);

  if (!fixture) {
    return Response.json({ error: "Fixture not found." }, { status: 404 });
  }

  // Load player match stats
  const [stats] = await db
    .select()
    .from(playerMatchStats)
    .where(
      and(
        eq(playerMatchStats.playerId, playerId),
        eq(playerMatchStats.fixtureId, fixtureId)
      )
    )
    .limit(1);

  if (!stats) {
    return Response.json({ error: "Player match stats not found." }, { status: 404 });
  }

  // Calculate versioned transparent rating breakdown
  const ratingDetails = await calculatePlayerMatchRating({
    playerId: stats.playerId,
    fixtureId: stats.fixtureId,
    position: stats.position || "ATT",
    starter: stats.starter ?? false,
    enteredMatch: stats.enteredMatch ?? false,
    minutesPlayed: stats.minutesPlayed ?? 0,
    goals: stats.goals,
    assists: stats.assists,
    shotsOnTarget: stats.shotsOnTarget,
    yellowCards: stats.yellowCards,
    redCards: stats.redCards,
    ownGoals: stats.ownGoals,
    penaltyGoals: stats.penaltyGoals,
    availableMetricsJson: stats.availableMetricsJson,
  });

  // Load player match events
  const events = await db
    .select()
    .from(playerMatchEvents)
    .where(
      and(
        eq(playerMatchEvents.playerId, playerId),
        eq(playerMatchEvents.fixtureId, fixtureId)
      )
    );

  // Load participating teams to get opponent name
  const teamRows = await db.select().from(teams);
  const myTeam = teamRows.find(t => t.id === stats.teamId);
  const isHome = fixture.homeTeamId === stats.teamId;
  const oppTeam = teamRows.find(t => t.id === (isHome ? fixture.awayTeamId : fixture.homeTeamId));

  return Response.json({
    fixtureId,
    opponent: oppTeam?.name || "Opponent",
    date: fixture.startsAt,
    minutesPlayed: stats.minutesPlayed,
    starter: stats.starter,
    enteredMatch: stats.enteredMatch,
    liveRating: stats.liveRating,
    finalRating: stats.finalRating,
    ratingDetails,
    events: events.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      eventSubtype: e.eventSubtype,
      matchMinute: e.matchMinute,
      outcome: e.outcome,
      metadata: JSON.parse(e.metadataJson),
    })),
  });
}
