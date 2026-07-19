import { env } from "cloudflare:workers";
import { ensureArchiveDatabase, getDb } from "@/db";
import { players, playerTournamentStats, lineups, playerTraits, userPlayerHistory } from "@/db/schema";
import { rebuildPlayerRepository, PlayerRepositoryListItem } from "@/lib/player-repository/repository";
import { eq, and } from "drizzle-orm";

/**
 * Player Repository List & Rebuild API
 *
 * GET /api/data/players/repository?competitionId=...&teamId=...&position=...
 * Returns a compact list of players optimized for selection cards.
 *
 * POST /api/data/players/repository
 * Triggers a complete batch rebuild of the player repository from archived events.
 * Protected by ingest secret.
 */

function authorised(request: Request) {
  const expected = (env as unknown as { TXLINE_INGEST_SECRET?: string }).TXLINE_INGEST_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(expected && supplied && expected === supplied);
}

import { normalizePlayerName } from "@/lib/player-repository/identity";

export async function GET(request: Request) {
  await ensureArchiveDatabase();
  const db = getDb();
  
  const url = new URL(request.url);
  const competitionId = url.searchParams.get("competitionId") || "worldcup2026";
  const teamId = url.searchParams.get("teamId");
  const position = url.searchParams.get("position");
  const wallet = url.searchParams.get("wallet") || undefined;
  const fixtureId = url.searchParams.get("fixtureId");
  const sort = url.searchParams.get("sort") || "recommended";

  // Fetch lineups if fixtureId is provided
  let matchdayLineup: any[] = [];
  if (fixtureId) {
    let query = db.select().from(lineups).where(eq(lineups.fixtureId, fixtureId));
    matchdayLineup = await query;
    if (teamId) {
      matchdayLineup = matchdayLineup.filter(l => String(l.teamId) === teamId);
    }
  }
  const lineupMap = new Map(matchdayLineup.map(l => [l.playerId, l]));

  // Fetch players matching filters
  let allPlayers = await db.select().from(players);
  if (teamId) {
    allPlayers = allPlayers.filter(p => String(p.teamId) === teamId);
  }
  if (position) {
    allPlayers = allPlayers.filter(p => p.position === position);
  }

  // If fixtureId is supplied, filter player list to those in the official lineup
  if (fixtureId) {
    allPlayers = allPlayers.filter(p => lineupMap.has(p.id));
  }

  // Load aggregates
  const aggregates = await db
    .select()
    .from(playerTournamentStats)
    .where(eq(playerTournamentStats.competitionId, competitionId));

  const aggMap = new Map(aggregates.map((a) => [a.playerId, a]));

  // Load traits
  const traitsList = await db
    .select()
    .from(playerTraits)
    .where(eq(playerTraits.competitionId, competitionId));

  const traitsMap = new Map<string, typeof traitsList>();
  for (const trait of traitsList) {
    let list = traitsMap.get(trait.playerId);
    if (!list) {
      list = [];
      traitsMap.set(trait.playerId, list);
    }
    list.push(trait);
  }

  // Load user-player history
  const historyMap = new Map<string, any>();
  if (wallet) {
    const journey = await db
      .select()
      .from(userPlayerHistory)
      .where(
        and(
          eq(userPlayerHistory.wallet, wallet),
          eq(userPlayerHistory.competitionId, competitionId)
        )
      );
    for (const j of journey) {
      historyMap.set(j.playerId, j);
    }
  }

  // Map to compact list response
  let items = allPlayers.map((player) => {
    const agg = aggMap.get(player.id);
    const pTraits = traitsMap.get(player.id) || [];
    const journey = historyMap.get(player.id);
    const lineupInfo = lineupMap.get(player.id);

    const matchdayStatus = {
      starter: lineupInfo ? Boolean(lineupInfo.starter) : false,
      officialSubstitute: lineupInfo ? Boolean(lineupInfo.officialSubstitute) : false,
      shirtNumber: lineupInfo ? (lineupInfo.shirtNumber ?? player.shirtNumber) : player.shirtNumber,
    };

    // Build role-relevant key stats
    const keyStats = [];
    if (agg) {
      if (player.position === "ATT") {
        keyStats.push({ key: "goals", label: "Goals", value: agg.totalGoals ?? 0 });
        keyStats.push({ key: "assists", label: "Assists", value: agg.totalAssists ?? 0 });
      } else if (player.position === "MID") {
        keyStats.push({ key: "goals", label: "Goals", value: agg.totalGoals ?? 0 });
        keyStats.push({ key: "assists", label: "Assists", value: agg.totalAssists ?? 0 });
      } else if (player.position === "DEF") {
        keyStats.push({ key: "tackles", label: "Tackles", value: agg.totalTackles ?? 0 });
        keyStats.push({ key: "defends", label: "Defends", value: (agg as any).totalDefensiveActions ?? 0 });
        keyStats.push({ key: "cleanSheets", label: "Clean Sheets", value: (agg as any).totalCleanSheets ?? 0 });
      } else if (player.position === "GK") {
        keyStats.push({ key: "cleanSheets", label: "Clean Sheets", value: (agg as any).totalCleanSheets ?? 0 });
        keyStats.push({ key: "defends", label: "Saves", value: (agg as any).totalDefensiveActions ?? 0 });
      } else {
        keyStats.push({ key: "tackles", label: "Tackles", value: agg.totalTackles ?? 0 });
      }
      keyStats.push({ key: "totalMinutes", label: "Minutes", value: agg.totalMinutes ?? 0 });
      keyStats.push({ key: "avgRating", label: "Avg Rating", value: agg.simpleAverageRating ? agg.simpleAverageRating.toFixed(2) : "—" });
    }

    // Recommendation calculation
    const formRating = agg?.recentFormRating ?? agg?.minutesWeightedRating ?? agg?.simpleAverageRating ?? 6.0;
    const formScore = (formRating / 10.0) * 100;

    const tournRating = agg?.minutesWeightedRating ?? agg?.simpleAverageRating ?? 6.0;
    const tournScore = (tournRating / 10.0) * 100;

    const participationScore = matchdayStatus.starter ? 100 : matchdayStatus.officialSubstitute ? 30 : 0;

    let productionScore = 50;
    if (agg) {
      if (player.position === "ATT") {
        productionScore = Math.min(100, (agg.totalGoals ?? 0) * 30 + (agg.totalShotsOnTarget ?? 0) * 10);
      } else if (player.position === "MID") {
        productionScore = Math.min(100, (agg.totalAssists ?? 0) * 30 + (agg.totalChancesCreated ?? 0) * 10);
      } else if (player.position === "DEF") {
        productionScore = Math.min(100, (agg.totalTackles ?? 0) * 8 + (agg.appearances ?? 0) * 10);
      }
    }

    const confidenceMap: Record<string, number> = { high: 100, medium: 80, low: 50, none: 20 };
    const confidenceScore = confidenceMap[agg?.sampleQuality ?? "none"];

    const recommendedScore =
      (formScore * 0.3) +
      (tournScore * 0.25) +
      (participationScore * 0.2) +
      (productionScore * 0.15) +
      (confidenceScore * 0.1);

    // Form strip mapping (grab raw recent ratings if available)
    const recentRatings = (agg as any)?.recentFormRatingsJson ? JSON.parse((agg as any).recentFormRatingsJson) : [];

    return {
      player: {
        id: player.id,
        name: player.name,
        displayName: normalizePlayerName(player.displayName || player.name),
        photoUrl: player.photoUrl,
        teamId: player.teamId,
        position: player.position,
        sofascoreId: player.sofascoreId,
      },
      matchdayStatus,
      tournament: {
        appearances: agg?.appearances ?? 0,
        starts: agg?.starts ?? 0,
        totalMinutes: agg?.totalMinutes ?? 0,
        tournamentRating: agg?.minutesWeightedRating ?? agg?.simpleAverageRating ?? null,
        recentFormRating: agg?.recentFormRating ?? null,
        formTrend: agg?.formTrend ?? "insufficient_data",
        sampleQuality: agg?.sampleQuality ?? "none",
        keyStats,
        recentRatings,
      },
      traits: pTraits.map(t => ({
        key: t.traitKey,
        label: t.traitKey.replace(/_/g, " "),
      })),
      personalHistory: journey ? {
        timesSelected: journey.timesSelected,
        averageRatingWhenSelected: journey.averageRatingWhenSelected,
      } : undefined,
      recommendedScore,
    };
  });

  // Deduplicate items by displayName to fix repeating players
  const uniqueItemsMap = new Map<string, typeof items[0]>();
  for (const item of items) {
    const key = item.player.displayName.toLowerCase();
    const existing = uniqueItemsMap.get(key);
    if (!existing) {
      uniqueItemsMap.set(key, item);
    } else {
      existing.tournament.appearances += item.tournament.appearances;
      existing.tournament.starts += item.tournament.starts;
      existing.tournament.totalMinutes += item.tournament.totalMinutes;
      existing.recommendedScore = Math.max(existing.recommendedScore, item.recommendedScore);
      if ((item.tournament.tournamentRating || 0) > (existing.tournament.tournamentRating || 0)) {
        existing.tournament.tournamentRating = item.tournament.tournamentRating;
      }
      if ((item.tournament.recentFormRating || 0) > (existing.tournament.recentFormRating || 0)) {
        existing.tournament.recentFormRating = item.tournament.recentFormRating;
      }
      
      for (const stat of item.tournament.keyStats) {
        const existingStat = existing.tournament.keyStats.find(s => s.key === stat.key);
        if (existingStat && typeof existingStat.value === 'number' && typeof stat.value === 'number') {
          existingStat.value += stat.value;
        }
      }
    }
  }
  items = Array.from(uniqueItemsMap.values());

  if (sort === "recommended") {
    items.sort((a, b) => b.recommendedScore - a.recommendedScore);
  } else if (sort === "form") {
    items.sort((a, b) => (b.tournament.recentFormRating ?? 0) - (a.tournament.recentFormRating ?? 0));
  } else if (sort === "rating") {
    items.sort((a, b) => (b.tournament.tournamentRating ?? 0) - (a.tournament.tournamentRating ?? 0));
  } else if (sort === "minutes") {
    items.sort((a, b) => b.tournament.totalMinutes - a.tournament.totalMinutes);
  }

  return Response.json(items);
}

export async function POST(request: Request) {
  if (!authorised(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const competitionId = url.searchParams.get("competitionId") || "worldcup2026";

  try {
    const result = await rebuildPlayerRepository(competitionId);
    return Response.json({
      success: true,
      message: `Complete player repository rebuild finished for competition ${competitionId}.`,
      processed: result.playersProcessed,
      elapsedMs: result.elapsedMs,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return Response.json({ error: msg }, { status: 500 });
  }
}
