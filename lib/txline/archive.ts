import { LiveFixture, LivePlayer, normalizeMatchFeed } from "./normalize";
import {
  PLAYER_SCORE_FORMULA_VERSION,
  PlayerStatTotals,
  ScorePosition,
  calculatePlayerPerformanceScore,
  performanceScoreToRating,
} from "../scoring";

type UnknownRecord = Record<string, unknown>;
export type DataCoverage = "complete" | "partial" | "unavailable";

export type ArchivedPlayer = LivePlayer & PlayerStatTotals & {
  teamId: string;
  performanceScore: number;
  impactRating: number;
  dataCoverage: DataCoverage;
  formulaVersion: string;
};

export type ArchivedEvent = {
  fixtureId: string;
  sequence: number;
  action: string;
  participant: number | null;
  eventEpoch: number | null;
  status: string;
  payload: string;
};

export type TxlineArchive = {
  fixture: LiveFixture & {
    phase: string;
    participant1Score: number | null;
    participant2Score: number | null;
    finalised: boolean;
  };
  players: ArchivedPlayer[];
  events: ArchivedEvent[];
  coverage: DataCoverage;
  formulaVersion: string;
  lastSequence: number;
  attributedEventCount: number;
};

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

function numeric(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringValue(value: unknown) {
  return value === undefined || value === null ? "" : String(value);
}

function rows(payload: unknown) {
  if (Array.isArray(payload)) return payload;
  const source = record(payload);
  const nested = first(source, ["data", "items", "events"]);
  return Array.isArray(nested) ? nested : [];
}

function statNumber(stats: UnknownRecord | null, aliases: string[]) {
  return numeric(first(stats, aliases));
}

function aggregatedStats(payloadRows: unknown[]) {
  for (let index = payloadRows.length - 1; index >= 0; index -= 1) {
    const row = record(payloadRows[index]);
    const soccer = record(first(row, ["playerStatsSoccer"]));
    if (!soccer) continue;
    const sides = [record(first(soccer, ["Participant1"])), record(first(soccer, ["Participant2"]))];
    if (sides.some((side) => side && Object.keys(side).length)) return sides;
  }
  return [null, null];
}

function playerAliases(payloadRows: unknown[]) {
  const aliases = new Map<string, string>();
  for (let index = payloadRows.length - 1; index >= 0; index -= 1) {
    const row = record(payloadRows[index]);
    const sides = first(row, ["Lineups"]);
    if (!Array.isArray(sides)) continue;
    for (const sideValue of sides) {
      const side = record(sideValue);
      const entries = first(side, ["Lineups", "Players"]);
      if (!Array.isArray(entries)) continue;
      for (const entryValue of entries) {
        const entry = record(entryValue);
        const fixturePlayerId = stringValue(first(entry, ["FixturePlayerId", "PlayerId"]));
        if (!fixturePlayerId) continue;
        const player = record(first(entry, ["Player"])) ?? entry;
        for (const alias of [fixturePlayerId, stringValue(first(player, ["NormativeId"])), stringValue(first(player, ["Id"]))]) {
          if (alias) aliases.set(alias, fixturePlayerId);
        }
      }
    }
    if (aliases.size) break;
  }
  return aliases;
}

function playerIdFrom(data: UnknownRecord | null, aliases = ["PlayerId", "FixturePlayerId", "Id"]) {
  const value = first(data, aliases);
  return value === undefined || value === null ? "" : String(value);
}

function actionOf(row: UnknownRecord | null) {
  return stringValue(first(row, ["Action", "Type"])).toLowerCase();
}

function eventData(row: UnknownRecord | null) {
  return record(first(row, ["DataSoccer", "Data"]));
}

function emptyStats(): PlayerStatTotals & { shots: number; penaltyAttempts: number; penaltyGoals: number } {
  return {
    minutes: 0, goals: 0, assists: 0, chancesCreated: 0, tackles: 0,
    shotsOnTarget: 0, yellowCards: 0, redCards: 0, ownGoals: 0,
    shots: 0, penaltyAttempts: 0, penaltyGoals: 0,
  };
}

function applyEventFallback(target: ReturnType<typeof emptyStats>, action: string, data: UnknownRecord | null) {
  if (action === "goal") target.goals += 1;
  else if (action === "own_goal") target.ownGoals += 1;
  else if (action === "yellow_card") target.yellowCards += 1;
  else if (action === "red_card" || action === "second_yellow_card") target.redCards += 1;
  else if (action === "shot") {
    target.shots += 1;
    if (stringValue(first(data, ["Outcome"])).toLowerCase() === "ontarget") target.shotsOnTarget += 1;
  } else if (/chance.*created/.test(action)) target.chancesCreated += 1;
  else if (/tackle/.test(action)) target.tackles += 1;
  else if (/penalty/.test(action)) {
    target.penaltyAttempts += 1;
    if (stringValue(first(data, ["Outcome"])).toLowerCase() === "scored") target.penaltyGoals += 1;
  }
}

function isPosition(position: LivePlayer["position"]): position is ScorePosition {
  return position === "ATT" || position === "MID" || position === "DEF" || position === "GK";
}

export function createTxlineArchive(fixture: LiveFixture, payload: unknown): TxlineArchive {
  const payloadRows = rows(payload);
  const match = normalizeMatchFeed(payloadRows);
  const aggregateSides = aggregatedStats(payloadRows);
  const aliases = playerAliases(payloadRows);
  const statTotals = new Map(match.players.map((player) => [player.id, emptyStats()]));
  const attributedPlayerIds = new Set<string>();
  let aggregatePlayerCount = 0;

  for (const [sideIndex, side] of aggregateSides.entries()) {
    if (!side) continue;
    for (const [sourcePlayerId, value] of Object.entries(side)) {
      const playerId = aliases.get(sourcePlayerId) ?? sourcePlayerId;
      const stats = record(value);
      if (!stats) continue;
      aggregatePlayerCount += 1;
      const target = statTotals.get(playerId) ?? emptyStats();
      target.minutes = statNumber(stats, ["Minutes", "MinutesPlayed"]);
      target.goals = statNumber(stats, ["Goals"]);
      target.assists = statNumber(stats, ["Assists"]);
      target.chancesCreated = statNumber(stats, ["ChancesCreated", "Chances", "KeyPasses"]);
      target.tackles = statNumber(stats, ["Tackles", "SuccessfulTackles"]);
      target.shots = statNumber(stats, ["Shots", "TotalShots"]);
      target.shotsOnTarget = statNumber(stats, ["ShotsOnTarget", "ShotsOT"]);
      target.yellowCards = statNumber(stats, ["YellowCards"]);
      target.redCards = statNumber(stats, ["RedCards"]);
      target.ownGoals = statNumber(stats, ["OwnGoals"]);
      target.penaltyAttempts = statNumber(stats, ["PenaltyAttempts"]);
      target.penaltyGoals = statNumber(stats, ["PenaltyGoals"]);
      statTotals.set(playerId, target);
      attributedPlayerIds.add(`${sideIndex + 1}:${playerId}`);
    }
  }

  const archivedEvents: ArchivedEvent[] = [];
  let syntheticSequence = 0;
  for (const value of payloadRows) {
    const row = record(value);
    if (!row) continue;
    syntheticSequence += 1;
    const action = actionOf(row) || "unknown";
    const data = eventData(row);
    const sourcePlayerId = playerIdFrom(data, ["PlayerId", "FixturePlayerId"]);
    const sourceAssistId = playerIdFrom(data, ["AssistPlayerId", "AssistedByPlayerId"]);
    const playerId = aliases.get(sourcePlayerId) ?? sourcePlayerId;
    const assistId = aliases.get(sourceAssistId) ?? sourceAssistId;
    if (!aggregatePlayerCount && playerId && statTotals.has(playerId)) {
      applyEventFallback(statTotals.get(playerId)!, action, data);
      attributedPlayerIds.add(`${numeric(first(row, ["Participant"]))}:${playerId}`);
    }
    if (!aggregatePlayerCount && assistId && statTotals.has(assistId) && action === "goal") {
      statTotals.get(assistId)!.assists += 1;
      attributedPlayerIds.add(`${numeric(first(row, ["Participant"]))}:${assistId}`);
    }
    const sequence = numeric(first(row, ["Seq", "Sequence"])) || syntheticSequence;
    archivedEvents.push({
      fixtureId: fixture.id,
      sequence,
      action,
      participant: first(row, ["Participant"]) === undefined ? null : numeric(first(row, ["Participant"])),
      eventEpoch: first(row, ["Epoch", "Timestamp"]) === undefined ? null : numeric(first(row, ["Epoch", "Timestamp"])),
      status: stringValue(first(row, ["Status", "StatusId"])) || "confirmed",
      payload: JSON.stringify(row),
    });
  }

  const finalised = payloadRows.some((value) => {
    const row = record(value);
    return actionOf(row) === "game_finalised" && (numeric(first(row, ["StatusId"])) === 100 || numeric(first(row, ["Period"])) === 100);
  });
  const coverage: DataCoverage = aggregatePlayerCount >= match.players.length && match.players.length > 0
    ? "complete"
    : attributedPlayerIds.size > 0 ? "partial" : "unavailable";
  const players: ArchivedPlayer[] = match.players.map((player) => {
    const stats = statTotals.get(player.id) ?? emptyStats();
    const performanceScore = isPosition(player.position) ? calculatePlayerPerformanceScore(player.position, stats) : 0;
    const teamId = player.participant === 1 ? fixture.participant1Id : fixture.participant2Id;
    return {
      ...player,
      ...stats,
      teamId,
      performanceScore,
      impactRating: performanceScoreToRating(performanceScore),
      dataCoverage: coverage,
      formulaVersion: PLAYER_SCORE_FORMULA_VERSION,
    };
  });
  const latest = payloadRows.map(record).filter(Boolean).at(-1) ?? null;
  const phase = finalised ? "final" : stringValue(first(latest, ["GameState", "Period"])) || "unknown";
  return {
    fixture: { ...fixture, phase, participant1Score: match.participant1Score, participant2Score: match.participant2Score, finalised },
    players,
    events: archivedEvents,
    coverage,
    formulaVersion: PLAYER_SCORE_FORMULA_VERSION,
    lastSequence: archivedEvents.reduce((maximum, event) => Math.max(maximum, event.sequence), 0),
    attributedEventCount: attributedPlayerIds.size,
  };
}
