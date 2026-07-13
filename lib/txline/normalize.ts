export type LiveFixture = {
  id: string;
  participant1Id: string;
  participant2Id: string;
  participant1: string;
  participant2: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeam: string;
  awayTeam: string;
  startsAt: string;
  gameState: number | null;
  competitionId: string;
};

export type LivePlayer = {
  id: string;
  name: string;
  number: number | null;
  position: "ATT" | "MID" | "DEF" | "GK" | "OTHER";
  starter: boolean;
  participant: 1 | 2;
  goals: number;
  ownGoals: number;
  shots: number;
  shotsOnTarget: number;
  yellowCards: number;
  redCards: number;
  penaltyAttempts: number;
  penaltyGoals: number;
  impactRating: number | null;
};

export type MatchFeed = {
  players: LivePlayer[];
  participant1Score: number | null;
  participant2Score: number | null;
  action: string | null;
  sequence: number | null;
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function first(source: UnknownRecord | null, keys: string[]) {
  if (!source) return undefined;
  for (const key of keys) if (source[key] !== undefined && source[key] !== null) return source[key];
  return undefined;
}

function text(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function numberValue(value: unknown, fallback = 0) {
  const valueNumber = typeof value === "number" ? value : Number(value);
  return Number.isFinite(valueNumber) ? valueNumber : fallback;
}

function payloadRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const source = record(payload);
  const nested = first(source, ["fixtures", "Fixtures", "data", "Data", "items", "Items"]);
  return Array.isArray(nested) ? nested : [];
}

export function normalizeFixtures(payload: unknown): LiveFixture[] {
  return payloadRows(payload).flatMap((value) => {
    const row = record(value);
    if (!row) return [];
    const id = text(first(row, ["FixtureId", "fixtureId", "id"]));
    const participant1 = text(first(row, ["Participant1", "participant1", "Participant1Name", "participant1Name"]));
    const participant2 = text(first(row, ["Participant2", "participant2", "Participant2Name", "participant2Name"]));
    if (!id || !participant1 || !participant2) return [];
    const participant1Id = text(first(row, ["Participant1Id", "participant1Id"]), participant1);
    const participant2Id = text(first(row, ["Participant2Id", "participant2Id"]), participant2);
    const participant1IsHome = Boolean(first(row, ["Participant1IsHome", "participant1IsHome"]));
    const startRaw = first(row, ["StartTime", "startTime", "startsAt"]);
    const startNumber = Number(startRaw);
    const startsAt = typeof startRaw === "string" && Number.isNaN(startNumber)
      ? new Date(startRaw).toISOString()
      : new Date(startNumber < 10_000_000_000 ? startNumber * 1000 : startNumber).toISOString();
    return [{
      id,
      participant1Id,
      participant2Id,
      participant1,
      participant2,
      homeTeamId: participant1IsHome ? participant1Id : participant2Id,
      awayTeamId: participant1IsHome ? participant2Id : participant1Id,
      homeTeam: participant1IsHome ? participant1 : participant2,
      awayTeam: participant1IsHome ? participant2 : participant1,
      startsAt,
      gameState: first(row, ["GameState", "gameState"]) === undefined ? null : numberValue(first(row, ["GameState", "gameState"])),
      competitionId: text(first(row, ["CompetitionId", "competitionId"])),
    }];
  }).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

function walk(value: unknown, visitor: (source: UnknownRecord) => boolean, depth = 0): UnknownRecord | null {
  if (depth > 8) return null;
  if (Array.isArray(value)) {
    for (const item of value) { const found = walk(item, visitor, depth + 1); if (found) return found; }
    return null;
  }
  const source = record(value);
  if (!source) return null;
  if (visitor(source)) return source;
  for (const child of Object.values(source)) { const found = walk(child, visitor, depth + 1); if (found) return found; }
  return null;
}

function actionName(value: UnknownRecord) {
  return text(first(value, ["Action", "action", "Type", "type"])).toLowerCase();
}

function positionFrom(entry: UnknownRecord): LivePlayer["position"] {
  const raw = text(first(entry, ["unitId", "UnitId", "unit", "positionId", "PositionId", "position"])).toLowerCase();
  if (/attack|forward|striker|winger|^4$/.test(raw)) return "ATT";
  if (/mid|^3$/.test(raw)) return "MID";
  if (/def|back|^2$/.test(raw)) return "DEF";
  if (/goal|keeper|^1$/.test(raw)) return "GK";
  return "OTHER";
}

function lineupSide(container: UnknownRecord, participant: 1 | 2): unknown[] {
  const side = record(first(container, participant === 1 ? ["Participant1", "participant1"] : ["Participant2", "participant2"]));
  const rows = first(side, ["lineups", "Lineups", "players", "Players"]);
  return Array.isArray(rows) ? rows : [];
}

function statMap(payload: unknown, participant: 1 | 2): UnknownRecord {
  const stats = walk(payload, (source) => Object.keys(source).some((key) => key.toLowerCase() === "playerstatssoccer"));
  if (!stats) return {};
  const key = Object.keys(stats).find((name) => name.toLowerCase() === "playerstatssoccer");
  const soccer = record(key ? stats[key] : null);
  return record(first(soccer, participant === 1 ? ["Participant1", "participant1"] : ["Participant2", "participant2"])) ?? {};
}

function rating(stats: UnknownRecord | null) {
  if (!stats || Object.keys(stats).length === 0) return null;
  const goals = numberValue(first(stats, ["goals", "Goals"]));
  const shots = numberValue(first(stats, ["shots", "Shots"]));
  const yellow = numberValue(first(stats, ["yellowCards", "YellowCards"]));
  const red = numberValue(first(stats, ["redCards", "RedCards"]));
  const ownGoals = numberValue(first(stats, ["ownGoals", "OwnGoals"]));
  const penaltyGoals = numberValue(first(stats, ["penaltyGoals", "PenaltyGoals"]));
  return Math.min(10, Math.max(0, 6 + goals * 1.2 + shots * .1 + penaltyGoals * .4 - yellow * .3 - red * 1.5 - ownGoals));
}

function latestScore(payload: unknown) {
  const rows = payloadRows(payload);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = record(rows[index]);
    const state = record(first(row, ["State", "state"]));
    const soccer = record(first(state, ["Soccer", "soccer"])) ?? state;
    const p1 = first(soccer, ["Participant1", "participant1"]);
    const p2 = first(soccer, ["Participant2", "participant2"]);
    if (typeof p1 === "number" && typeof p2 === "number") return { participant1Score: p1, participant2Score: p2 };
  }
  return { participant1Score: null, participant2Score: null };
}

export function normalizeMatchFeed(payload: unknown): MatchFeed {
  const rows = payloadRows(payload);
  const lineupEvent = [...rows].reverse().map(record).find((row) => row && actionName(row).includes("lineup"));
  const data = record(first(lineupEvent ?? null, ["Data", "data"])) ?? lineupEvent ?? null;
  const lineupContainer = data ? walk(data, (source) => {
    const side1 = record(first(source, ["Participant1", "participant1"]));
    const side2 = record(first(source, ["Participant2", "participant2"]));
    return Boolean(side1 && side2 && (Array.isArray(first(side1, ["lineups", "Lineups"])) || Array.isArray(first(side2, ["lineups", "Lineups"]))));
  }) : null;
  const players: LivePlayer[] = [];
  for (const participant of [1, 2] as const) {
    const stats = statMap(payload, participant);
    for (const item of lineupContainer ? lineupSide(lineupContainer, participant) : []) {
      const entry = record(item);
      if (!entry) continue;
      const playerObject = record(first(entry, ["player", "Player"])) ?? entry;
      const id = text(first(entry, ["fixturePlayerId", "FixturePlayerId", "playerId", "PlayerId", "id"]));
      const name = text(first(playerObject, ["preferredName", "PreferredName", "name", "Name"]));
      if (!id || !name) continue;
      const playerStats = record(stats[id]) ?? null;
      players.push({
        id,
        name,
        number: first(entry, ["rosterNumber", "RosterNumber", "shirtNumber"]) === undefined ? null : numberValue(first(entry, ["rosterNumber", "RosterNumber", "shirtNumber"])),
        position: positionFrom(entry),
        starter: Boolean(first(entry, ["starter", "Starter", "isStarter"])),
        participant,
        goals: numberValue(first(playerStats, ["goals", "Goals"])),
        ownGoals: numberValue(first(playerStats, ["ownGoals", "OwnGoals"])),
        shots: numberValue(first(playerStats, ["shots", "Shots"])),
        shotsOnTarget: numberValue(first(playerStats, ["shotsOnTarget", "ShotsOnTarget"])),
        yellowCards: numberValue(first(playerStats, ["yellowCards", "YellowCards"])),
        redCards: numberValue(first(playerStats, ["redCards", "RedCards"])),
        penaltyAttempts: numberValue(first(playerStats, ["penaltyAttempts", "PenaltyAttempts"])),
        penaltyGoals: numberValue(first(playerStats, ["penaltyGoals", "PenaltyGoals"])),
        impactRating: rating(playerStats),
      });
    }
  }
  const score = latestScore(payload);
  const latest = record(rows.at(-1));
  return { players, ...score, action: latest ? actionName(latest) || null : null, sequence: latest && first(latest, ["Seq", "seq"]) !== undefined ? numberValue(first(latest, ["Seq", "seq"])) : null };
}

