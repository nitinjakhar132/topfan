import { env } from "cloudflare:workers";
import { ensureArchiveDatabase, getDb } from "@/db";
import { feedEvents, fixtures, fixtureSyncState, lineups, playerMatchStats, players } from "@/db/schema";

/**
 * TxLINE Capability Audit Endpoint
 *
 * Reads stored raw payloads from feed_events and generates a comprehensive
 * capability report showing which metrics are reliably available, which
 * are player-attributable, and what coverage exists across fixtures.
 *
 * Protected by TXLINE_INGEST_SECRET.
 */

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function first(source: UnknownRecord | null, keys: string[]) {
  if (!source) return undefined;
  for (const key of keys) if (source[key] !== undefined && source[key] !== null) return source[key];
  const lowered = new Map(Object.keys(source).map((key) => [key.toLowerCase(), key]));
  for (const key of keys) {
    const actual = lowered.get(key.toLowerCase());
    if (actual) return source[actual];
  }
  return undefined;
}

function stringValue(value: unknown) {
  return value === undefined || value === null ? "" : String(value);
}

function numericValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface ActionProfile {
  action: string;
  totalOccurrences: number;
  fixturesWithAction: Set<string>;
  playerAttributionCount: number;
  playerInCount: number;
  playerOutCount: number;
  participantCount: number;
  minutesCount: number;
  confirmedCount: number;
  outcomeValues: Map<string, number>;
  goalTypeValues: Map<string, number>;
  dataSoccerFieldCounts: Map<string, number>;
  dataFieldCounts: Map<string, number>;
  samplePayloads: unknown[];
}

interface PlayerStatFieldProfile {
  fieldName: string;
  fixturesPresent: Set<string>;
  playersWithNonZero: number;
  totalPlayersChecked: number;
  sampleValues: number[];
}

interface LineupFieldProfile {
  fieldName: string;
  presenceCount: number;
  totalChecked: number;
  sampleValues: unknown[];
}

interface PlayerIdConsistency {
  fixturePlayerId: string;
  fixturesSeen: string[];
  nameVariants: Set<string>;
  normativeId: string | null;
}

function authorised(request: Request) {
  const expected = (env as unknown as { TXLINE_INGEST_SECRET?: string }).TXLINE_INGEST_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(expected && supplied && expected === supplied);
}

export async function GET(request: Request) {
  if (!authorised(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureArchiveDatabase();
  const db = getDb();

  // ── Load all data ────────────────────────────────────────────────────────
  const allFixtures = await db.select().from(fixtures);
  const allSyncState = await db.select().from(fixtureSyncState);
  const allEvents = await db.select().from(feedEvents);
  const allLineups = await db.select().from(lineups);
  const allPlayers = await db.select().from(players);
  const allStats = await db.select().from(playerMatchStats);

  const syncMap = new Map(allSyncState.map((s) => [s.fixtureId, s]));
  const fixtureIds = new Set(allFixtures.map((f) => f.id));

  // ── 1. Action Profile Analysis ───────────────────────────────────────────
  const actionProfiles = new Map<string, ActionProfile>();

  for (const event of allEvents) {
    let parsed: UnknownRecord | null = null;
    try {
      parsed = record(JSON.parse(event.payload));
    } catch {
      continue;
    }

    const action = stringValue(first(parsed, ["Action", "action", "Type", "type"])).toLowerCase() || "unknown";

    let profile = actionProfiles.get(action);
    if (!profile) {
      profile = {
        action,
        totalOccurrences: 0,
        fixturesWithAction: new Set(),
        playerAttributionCount: 0,
        playerInCount: 0,
        playerOutCount: 0,
        participantCount: 0,
        minutesCount: 0,
        confirmedCount: 0,
        outcomeValues: new Map(),
        goalTypeValues: new Map(),
        dataSoccerFieldCounts: new Map(),
        dataFieldCounts: new Map(),
        samplePayloads: [],
      };
      actionProfiles.set(action, profile);
    }

    profile.totalOccurrences += 1;
    profile.fixturesWithAction.add(event.fixtureId);

    const dataSoccer = record(first(parsed, ["DataSoccer", "dataSoccer"]));
    const data = record(first(parsed, ["Data", "data"]));
    const effectiveData = dataSoccer ?? data;

    // Player attribution
    const playerId = stringValue(first(effectiveData, ["PlayerId", "playerId", "FixturePlayerId", "fixturePlayerId"]));
    if (playerId && playerId !== "0" && playerId !== "") profile.playerAttributionCount += 1;

    const playerInId = stringValue(first(effectiveData, ["PlayerInId", "playerInId"]));
    if (playerInId && playerInId !== "0") profile.playerInCount += 1;

    const playerOutId = stringValue(first(effectiveData, ["PlayerOutId", "playerOutId"]));
    if (playerOutId && playerOutId !== "0") profile.playerOutCount += 1;

    // Participant
    const participant = first(parsed, ["Participant", "participant"]);
    if (participant !== undefined && participant !== null) profile.participantCount += 1;

    // Minutes
    const minutes = first(effectiveData, ["Minutes", "minutes", "Minute", "minute"]);
    if (minutes !== undefined && minutes !== null) profile.minutesCount += 1;

    // Confirmed / Status
    const status = stringValue(first(parsed, ["Status", "status", "StatusId", "statusId"]));
    if (status === "confirmed" || status === "100" || numericValue(first(parsed, ["StatusId", "statusId"])) === 100) {
      profile.confirmedCount += 1;
    }

    // Outcome values
    const outcome = stringValue(first(effectiveData, ["Outcome", "outcome"])).toLowerCase();
    if (outcome) profile.outcomeValues.set(outcome, (profile.outcomeValues.get(outcome) || 0) + 1);

    // GoalType values
    const goalType = stringValue(first(effectiveData, ["GoalType", "goalType"])).toLowerCase();
    if (goalType) profile.goalTypeValues.set(goalType, (profile.goalTypeValues.get(goalType) || 0) + 1);

    // DataSoccer field inventory
    if (dataSoccer) {
      for (const key of Object.keys(dataSoccer)) {
        profile.dataSoccerFieldCounts.set(key, (profile.dataSoccerFieldCounts.get(key) || 0) + 1);
      }
    }

    // Data field inventory
    if (data) {
      for (const key of Object.keys(data)) {
        profile.dataFieldCounts.set(key, (profile.dataFieldCounts.get(key) || 0) + 1);
      }
    }

    // Collect up to 2 sample payloads per action
    if (profile.samplePayloads.length < 2 && effectiveData && Object.keys(effectiveData).length > 0) {
      profile.samplePayloads.push(parsed);
    }
  }

  // ── 2. Player Stats Field Availability ───────────────────────────────────
  const statFieldProfiles = new Map<string, PlayerStatFieldProfile>();
  const statFields = [
    "minutes", "goals", "assists", "chancesCreated", "tackles",
    "shots", "shotsOnTarget", "yellowCards", "redCards", "ownGoals",
    "penaltyAttempts", "penaltyGoals", "performanceScore", "impactRating",
  ];

  for (const field of statFields) {
    const profile: PlayerStatFieldProfile = {
      fieldName: field,
      fixturesPresent: new Set(),
      playersWithNonZero: 0,
      totalPlayersChecked: 0,
      sampleValues: [],
    };
    statFieldProfiles.set(field, profile);
  }

  for (const stat of allStats) {
    for (const field of statFields) {
      const profile = statFieldProfiles.get(field)!;
      const value = (stat as Record<string, unknown>)[field];
      profile.totalPlayersChecked += 1;

      if (value !== null && value !== undefined) {
        profile.fixturesPresent.add(stat.fixtureId);
        const numVal = numericValue(value);
        if (numVal !== null && numVal !== 0) {
          profile.playersWithNonZero += 1;
          if (profile.sampleValues.length < 5) profile.sampleValues.push(numVal);
        }
      }
    }
  }

  // ── 3. Lineup Field Inventory ────────────────────────────────────────────
  // Examine raw feed_events for lineup payloads
  const lineupFieldProfiles = new Map<string, LineupFieldProfile>();
  const lineupPlayerFields = [
    "FixturePlayerId", "fixturePlayerId", "PlayerId", "playerId",
    "RosterNumber", "rosterNumber", "shirtNumber",
    "Starter", "starter", "isStarter",
    "PositionId", "positionId", "Position", "position",
    "Unit", "unit", "UnitId", "unitId",
  ];
  const lineupPlayerObjectFields = [
    "PreferredName", "preferredName", "Name", "name",
    "NormativeId", "normativeId", "Id", "id",
    "DateOfBirth", "dateOfBirth",
  ];

  let lineupPayloadsChecked = 0;
  let lineupPlayersChecked = 0;

  for (const event of allEvents) {
    let parsed: UnknownRecord | null = null;
    try { parsed = record(JSON.parse(event.payload)); } catch { continue; }
    const lineupsSides = first(parsed, ["Lineups", "lineups"]);
    if (!Array.isArray(lineupsSides)) continue;
    lineupPayloadsChecked += 1;

    for (const side of lineupsSides) {
      const sideRecord = record(side);
      const playerEntries = first(sideRecord, ["Lineups", "lineups", "Players", "players"]);
      if (!Array.isArray(playerEntries)) continue;

      for (const entry of playerEntries) {
        const entryRecord = record(entry);
        if (!entryRecord) continue;
        lineupPlayersChecked += 1;

        const playerObject = record(first(entryRecord, ["Player", "player"]));
        const allFields = [...lineupPlayerFields, ...lineupPlayerObjectFields];

        for (const fieldName of allFields) {
          const value = first(entryRecord, [fieldName]) ?? (playerObject ? first(playerObject, [fieldName]) : undefined);
          let profile = lineupFieldProfiles.get(fieldName);
          if (!profile) {
            profile = { fieldName, presenceCount: 0, totalChecked: 0, sampleValues: [] };
            lineupFieldProfiles.set(fieldName, profile);
          }
          profile.totalChecked += 1;
          if (value !== undefined && value !== null) {
            profile.presenceCount += 1;
            if (profile.sampleValues.length < 3) profile.sampleValues.push(value);
          }
        }
      }
    }
  }

  // ── 4. Player ID Stability ───────────────────────────────────────────────
  const playerIdMap = new Map<string, PlayerIdConsistency>();

  for (const player of allPlayers) {
    const existing = playerIdMap.get(player.id);
    if (existing) {
      existing.nameVariants.add(player.name);
    } else {
      playerIdMap.set(player.id, {
        fixturePlayerId: player.id,
        fixturesSeen: [],
        nameVariants: new Set([player.name]),
        normativeId: player.sofascoreId ? String(player.sofascoreId) : null,
      });
    }
  }

  // Check which fixtures each player appears in
  for (const lineup of allLineups) {
    const entry = playerIdMap.get(lineup.playerId);
    if (entry) entry.fixturesSeen.push(lineup.fixtureId);
  }

  // ── 5. Aggregate Stats Coverage ──────────────────────────────────────────
  // Check the playerStatsSoccer payloads in feed_events
  let aggregateStatsFixtures = 0;
  let aggregateStatsTotalPlayers = 0;
  const aggregateStatFields = new Map<string, number>();

  for (const event of allEvents) {
    let parsed: UnknownRecord | null = null;
    try { parsed = record(JSON.parse(event.payload)); } catch { continue; }
    const pss = record(first(parsed, ["playerStatsSoccer", "PlayerStatsSoccer"]));
    if (!pss) continue;

    let hasData = false;
    for (const sideKey of ["Participant1", "participant1", "Participant2", "participant2"]) {
      const side = record(pss[sideKey]);
      if (!side) continue;
      for (const [, playerValue] of Object.entries(side)) {
        const playerStats = record(playerValue);
        if (!playerStats) continue;
        hasData = true;
        aggregateStatsTotalPlayers += 1;
        for (const key of Object.keys(playerStats)) {
          aggregateStatFields.set(key, (aggregateStatFields.get(key) || 0) + 1);
        }
      }
    }
    if (hasData) aggregateStatsFixtures += 1;
  }

  // ── 6. Generate Capability Registry ──────────────────────────────────────
  const totalFixtures = fixtureIds.size;
  const finalisedFixtures = allSyncState.filter((s) => s.finalised).length;

  function metricCapability(name: string, checks: {
    availableInAggregate: boolean;
    aggregateFieldName?: string;
    availableInEvents: boolean;
    eventAction?: string;
    playerAttributionRate: number;
    fixturePresenceRate: number;
  }) {
    return {
      metric: name,
      available: checks.availableInAggregate || checks.availableInEvents,
      sources: {
        aggregateStats: checks.availableInAggregate ? checks.aggregateFieldName : null,
        eventAction: checks.availableInEvents ? checks.eventAction : null,
      },
      playerAttributionRate: Math.round(checks.playerAttributionRate * 100) / 100,
      fixturePresenceRate: Math.round(checks.fixturePresenceRate * 100) / 100,
      reliable: checks.playerAttributionRate >= 0.8 && checks.fixturePresenceRate >= 0.7,
    };
  }

  const goalProfile = actionProfiles.get("goal");
  const shotProfile = actionProfiles.get("shot");
  const yellowProfile = actionProfiles.get("yellow_card");
  const redProfile = actionProfiles.get("red_card");
  const subProfile = actionProfiles.get("substitution");
  const penProfile = actionProfiles.get("penalty");

  const aggregateFieldSet = new Set([...aggregateStatFields.keys()].map((k) => k.toLowerCase()));

  const capabilities = {
    generatedAt: new Date().toISOString(),
    fixturesSurveyed: totalFixtures,
    fixturesFinalised: finalisedFixtures,
    totalEventsAnalysed: allEvents.length,
    totalPlayersInDb: allPlayers.length,
    totalPlayerStatRows: allStats.length,
    aggregateStatPayloads: aggregateStatsFixtures,
    aggregateStatFields: Object.fromEntries([...aggregateStatFields.entries()].sort((a, b) => b[1] - a[1])),
    metrics: {
      goals: metricCapability("goals", {
        availableInAggregate: aggregateFieldSet.has("goals"),
        aggregateFieldName: "Goals",
        availableInEvents: Boolean(goalProfile && goalProfile.playerAttributionCount > 0),
        eventAction: "goal",
        playerAttributionRate: goalProfile
          ? goalProfile.playerAttributionCount / goalProfile.totalOccurrences
          : 0,
        fixturePresenceRate: goalProfile
          ? goalProfile.fixturesWithAction.size / totalFixtures
          : 0,
      }),
      assists: metricCapability("assists", {
        availableInAggregate: aggregateFieldSet.has("assists"),
        aggregateFieldName: "Assists",
        availableInEvents: false,
        playerAttributionRate: aggregateFieldSet.has("assists")
          ? aggregateStatsTotalPlayers > 0 ? (aggregateStatFields.get("Assists") || aggregateStatFields.get("assists") || 0) / aggregateStatsTotalPlayers : 0
          : 0,
        fixturePresenceRate: aggregateStatsFixtures / totalFixtures,
      }),
      shots: metricCapability("shots", {
        availableInAggregate: aggregateFieldSet.has("shots") || aggregateFieldSet.has("totalshots"),
        aggregateFieldName: "Shots",
        availableInEvents: Boolean(shotProfile && shotProfile.playerAttributionCount > 0),
        eventAction: "shot",
        playerAttributionRate: shotProfile
          ? shotProfile.playerAttributionCount / shotProfile.totalOccurrences
          : 0,
        fixturePresenceRate: shotProfile
          ? shotProfile.fixturesWithAction.size / totalFixtures
          : 0,
      }),
      shotsOnTarget: metricCapability("shotsOnTarget", {
        availableInAggregate: aggregateFieldSet.has("shotsontarget") || aggregateFieldSet.has("shotsot"),
        aggregateFieldName: "ShotsOnTarget",
        availableInEvents: Boolean(shotProfile && shotProfile.outcomeValues.has("ontarget")),
        eventAction: "shot (Outcome=OnTarget)",
        playerAttributionRate: shotProfile && shotProfile.outcomeValues.has("ontarget")
          ? (shotProfile.outcomeValues.get("ontarget")! / shotProfile.totalOccurrences)
          : 0,
        fixturePresenceRate: shotProfile
          ? shotProfile.fixturesWithAction.size / totalFixtures
          : 0,
      }),
      chancesCreated: metricCapability("chancesCreated", {
        availableInAggregate: aggregateFieldSet.has("chancescreated") || aggregateFieldSet.has("chances") || aggregateFieldSet.has("keypasses"),
        aggregateFieldName: "ChancesCreated",
        availableInEvents: false,
        playerAttributionRate: 0,
        fixturePresenceRate: aggregateStatsFixtures / totalFixtures,
      }),
      tackles: metricCapability("tackles", {
        availableInAggregate: aggregateFieldSet.has("tackles") || aggregateFieldSet.has("successfultackles"),
        aggregateFieldName: "Tackles",
        availableInEvents: Boolean(actionProfiles.has("tackle")),
        playerAttributionRate: 0,
        fixturePresenceRate: aggregateStatsFixtures / totalFixtures,
      }),
      yellowCards: metricCapability("yellowCards", {
        availableInAggregate: aggregateFieldSet.has("yellowcards"),
        aggregateFieldName: "YellowCards",
        availableInEvents: Boolean(yellowProfile && yellowProfile.playerAttributionCount > 0),
        eventAction: "yellow_card",
        playerAttributionRate: yellowProfile
          ? yellowProfile.playerAttributionCount / yellowProfile.totalOccurrences
          : 0,
        fixturePresenceRate: yellowProfile
          ? yellowProfile.fixturesWithAction.size / totalFixtures
          : 0,
      }),
      redCards: metricCapability("redCards", {
        availableInAggregate: aggregateFieldSet.has("redcards"),
        aggregateFieldName: "RedCards",
        availableInEvents: Boolean(redProfile),
        eventAction: "red_card",
        playerAttributionRate: redProfile
          ? redProfile.playerAttributionCount / (redProfile.totalOccurrences || 1)
          : 0,
        fixturePresenceRate: redProfile
          ? redProfile.fixturesWithAction.size / totalFixtures
          : 0,
      }),
      ownGoals: metricCapability("ownGoals", {
        availableInAggregate: aggregateFieldSet.has("owngoals"),
        aggregateFieldName: "OwnGoals",
        availableInEvents: Boolean(actionProfiles.has("own_goal")),
        eventAction: "own_goal",
        playerAttributionRate: 0,
        fixturePresenceRate: 0,
      }),
      penalties: metricCapability("penalties", {
        availableInAggregate: aggregateFieldSet.has("penaltyattempts") || aggregateFieldSet.has("penaltygoals"),
        aggregateFieldName: "PenaltyAttempts/PenaltyGoals",
        availableInEvents: Boolean(penProfile),
        eventAction: "penalty",
        playerAttributionRate: penProfile
          ? penProfile.playerAttributionCount / (penProfile.totalOccurrences || 1)
          : 0,
        fixturePresenceRate: penProfile
          ? penProfile.fixturesWithAction.size / totalFixtures
          : 0,
      }),
      minutes: metricCapability("minutes", {
        availableInAggregate: aggregateFieldSet.has("minutes") || aggregateFieldSet.has("minutesplayed"),
        aggregateFieldName: "Minutes",
        availableInEvents: Boolean(subProfile),
        eventAction: "substitution (for minute reconstruction)",
        playerAttributionRate: subProfile
          ? (subProfile.playerInCount + subProfile.playerOutCount) / (subProfile.totalOccurrences || 1)
          : 0,
        fixturePresenceRate: subProfile
          ? subProfile.fixturesWithAction.size / totalFixtures
          : 0,
      }),
      substitutions: metricCapability("substitutions", {
        availableInAggregate: false,
        availableInEvents: Boolean(subProfile && subProfile.playerInCount > 0),
        eventAction: "substitution",
        playerAttributionRate: subProfile
          ? subProfile.playerInCount / (subProfile.totalOccurrences || 1)
          : 0,
        fixturePresenceRate: subProfile
          ? subProfile.fixturesWithAction.size / totalFixtures
          : 0,
      }),
    },
    playerIdentity: {
      totalPlayers: allPlayers.length,
      withNormativeId: allPlayers.filter((p) => p.sofascoreId !== null).length,
      multiFixturePlayers: [...playerIdMap.values()].filter((p) => p.fixturesSeen.length > 1).length,
      nameConflicts: [...playerIdMap.values()].filter((p) => p.nameVariants.size > 1).length,
      sampleMultiFixturePlayers: [...playerIdMap.values()]
        .filter((p) => p.fixturesSeen.length > 1)
        .slice(0, 5)
        .map((p) => ({
          id: p.fixturePlayerId,
          names: [...p.nameVariants],
          normativeId: p.normativeId,
          appearances: p.fixturesSeen.length,
        })),
    },
    lineupFields: {
      payloadsChecked: lineupPayloadsChecked,
      playersChecked: lineupPlayersChecked,
      fields: Object.fromEntries(
        [...lineupFieldProfiles.entries()]
          .filter(([, v]) => v.presenceCount > 0)
          .sort((a, b) => b[1].presenceCount - a[1].presenceCount)
          .map(([k, v]) => [k, {
            presenceRate: Math.round((v.presenceCount / v.totalChecked) * 100) / 100,
            count: v.presenceCount,
            samples: v.sampleValues.slice(0, 2),
          }])
      ),
    },
    actionInventory: Object.fromEntries(
      [...actionProfiles.entries()]
        .sort((a, b) => b[1].totalOccurrences - a[1].totalOccurrences)
        .map(([action, profile]) => [action, {
          occurrences: profile.totalOccurrences,
          fixtures: profile.fixturesWithAction.size,
          playerAttribution: profile.playerAttributionCount,
          playerAttributionRate: profile.totalOccurrences > 0
            ? Math.round((profile.playerAttributionCount / profile.totalOccurrences) * 100) / 100
            : 0,
          participantPresence: profile.participantCount,
          minutesPresence: profile.minutesCount,
          confirmedCount: profile.confirmedCount,
          outcomes: Object.fromEntries(profile.outcomeValues),
          goalTypes: Object.fromEntries(profile.goalTypeValues),
          dataSoccerFields: Object.fromEntries(
            [...profile.dataSoccerFieldCounts.entries()].sort((a, b) => b[1] - a[1])
          ),
          dataFields: Object.fromEntries(
            [...profile.dataFieldCounts.entries()].sort((a, b) => b[1] - a[1])
          ),
          samples: profile.samplePayloads,
        }])
    ),
    playerStatsCoverage: Object.fromEntries(
      [...statFieldProfiles.entries()].map(([field, profile]) => [field, {
        fixturesPresent: profile.fixturesPresent.size,
        fixturePresenceRate: totalFixtures > 0
          ? Math.round((profile.fixturesPresent.size / totalFixtures) * 100) / 100
          : 0,
        playersWithNonZero: profile.playersWithNonZero,
        totalPlayersChecked: profile.totalPlayersChecked,
        nonZeroRate: profile.totalPlayersChecked > 0
          ? Math.round((profile.playersWithNonZero / profile.totalPlayersChecked) * 100) / 100
          : 0,
        samples: profile.sampleValues,
      }])
    ),
    fixtureCoverage: allFixtures.map((f) => {
      const sync = syncMap.get(f.id);
      return {
        fixtureId: f.id,
        startsAt: f.startsAt,
        phase: f.phase,
        homeScore: f.homeScore,
        awayScore: f.awayScore,
        dataCoverage: f.dataCoverage,
        finalised: sync?.finalised ?? false,
        eventCount: sync?.eventCount ?? 0,
        playerCount: sync?.playerCount ?? 0,
        attributedEventCount: sync?.attributedEventCount ?? 0,
      };
    }),
  };

  return Response.json(capabilities, {
    headers: { "content-type": "application/json" },
  });
}
