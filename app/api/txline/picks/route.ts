import { eq, and } from "drizzle-orm";
import { ensureArchiveDatabase, getDb } from "@/db";
import { fixtures, lineups, players, picks } from "@/db/schema";

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      fixtureId?: string;
      teamId?: string;
      attackerId?: string;
      midfielderId?: string;
      defenderId?: string;
      wallet?: string;
    };

    const { fixtureId, teamId, attackerId, midfielderId, defenderId, wallet } = body;

    if (!fixtureId || !teamId || !attackerId || !midfielderId || !defenderId || !wallet) {
      return Response.json({ error: "Missing required fields: fixtureId, teamId, attackerId, midfielderId, defenderId, wallet." }, { status: 400 });
    }

    if (attackerId === midfielderId || attackerId === defenderId || midfielderId === defenderId) {
      return Response.json({ error: "Duplicate player selections are not allowed." }, { status: 400 });
    }

    await ensureArchiveDatabase();
    const db = getDb();

    // 1. Fetch fixture
    const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId)).limit(1);
    if (!fixture) {
      return Response.json({ error: "Fixture not found." }, { status: 404 });
    }

    // 2. Validate Kickoff (Server-side time check)
    const startsAtMs = Date.parse(fixture.startsAt);
    if (startsAtMs <= Date.now()) {
      return Response.json({ error: "Selections are locked. The match has already started." }, { status: 400 });
    }

    // 3. Fetch Lineups & Players to validate eligibility
    const pickedIds = [attackerId, midfielderId, defenderId];
    
    // Fetch lineup rows for this match
    const matchLineups = await db.select().from(lineups).where(eq(lineups.fixtureId, fixtureId));
    const lineupMap = new Map(matchLineups.map(l => [l.playerId, l]));

    // Fetch players profiles
    const playerRows = await db.select().from(players);
    const playerMap = new Map(playerRows.map(p => [p.id, p]));

    // Validate Attacker
    const attPlayer = playerMap.get(attackerId);
    const attLineup = lineupMap.get(attackerId);
    if (!attPlayer || attPlayer.teamId !== teamId || attPlayer.position !== "ATT") {
      return Response.json({ error: `Invalid attacker selection: ${attPlayer ? attPlayer.name : attackerId}.` }, { status: 400 });
    }
    if (!attLineup || (!attLineup.starter && !attLineup.officialSubstitute)) {
      return Response.json({ error: `Selected attacker ${attPlayer.name} is not in the matchday squad.` }, { status: 400 });
    }

    // Validate Midfielder
    const midPlayer = playerMap.get(midfielderId);
    const midLineup = lineupMap.get(midfielderId);
    if (!midPlayer || midPlayer.teamId !== teamId || midPlayer.position !== "MID") {
      return Response.json({ error: `Invalid midfielder selection: ${midPlayer ? midPlayer.name : midfielderId}.` }, { status: 400 });
    }
    if (!midLineup || (!midLineup.starter && !midLineup.officialSubstitute)) {
      return Response.json({ error: `Selected midfielder ${midPlayer.name} is not in the matchday squad.` }, { status: 400 });
    }

    // Validate Defender
    const defPlayer = playerMap.get(defenderId);
    const defLineup = lineupMap.get(defenderId);
    if (!defPlayer || defPlayer.teamId !== teamId || defPlayer.position !== "DEF") {
      return Response.json({ error: `Invalid defender selection: ${defPlayer ? defPlayer.name : defenderId}.` }, { status: 400 });
    }
    if (!defLineup || (!defLineup.starter && !defLineup.officialSubstitute)) {
      return Response.json({ error: `Selected defender ${defPlayer.name} is not in the matchday squad.` }, { status: 400 });
    }

    // 4. Save pick record in atomic SQLite transaction / write
    const [existingPick] = await db
      .select()
      .from(picks)
      .where(and(eq(picks.fixtureId, fixtureId), eq(picks.wallet, wallet)))
      .limit(1);

    const nowStr = new Date().toISOString();

    if (existingPick) {
      await db
        .update(picks)
        .set({
          teamId,
          attackerId,
          midfielderId,
          defenderId,
          lockedAt: nowStr
        })
        .where(eq(picks.id, existingPick.id));
    } else {
      await db.insert(picks).values({
        fixtureId,
        wallet,
        teamId,
        attackerId,
        midfielderId,
        defenderId,
        lockedAt: nowStr
      });
    }

    return Response.json({
      success: true,
      pick: {
        fixtureId,
        teamId,
        playerIds: pickedIds,
        lockedAt: nowStr
      }
    });

  } catch (error) {
    console.error("Failed to save picks:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to lock selections on server." }, { status: 500 });
  }
}
