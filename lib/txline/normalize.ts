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
  homeScore: number | null;
  awayScore: number | null;
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
  sofascoreId?: number | null;
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
    const comp = text(first(row, ["Competition", "competition", "CompetitionId", "competitionId"])).toLowerCase();
    if (comp && !comp.includes("world cup") && !comp.includes("placeholder")) {
      return [];
    }
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
      homeScore: first(row, [participant1IsHome ? "Participant1Score" : "Participant2Score", "homeScore"]) === undefined ? null : numberValue(first(row, [participant1IsHome ? "Participant1Score" : "Participant2Score", "homeScore"])),
      awayScore: first(row, [participant1IsHome ? "Participant2Score" : "Participant1Score", "awayScore"]) === undefined ? null : numberValue(first(row, [participant1IsHome ? "Participant2Score" : "Participant1Score", "awayScore"])),
    }];
  }).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

function actionName(value: UnknownRecord) {
  return text(first(value, ["Action", "action", "Type", "type"])).toLowerCase();
}

function positionFrom(entry: UnknownRecord): LivePlayer["position"] {
  const positionId = numberValue(first(entry, ["positionId", "PositionId"]), -1);
  if (positionId === 37) return "ATT";
  if (positionId === 36) return "MID";
  if (positionId === 35) return "DEF";
  if (positionId === 34) return "GK";
  const raw = text(first(entry, ["position", "Position", "unit", "Unit", "unitId", "UnitId"])).toLowerCase();
  if (/attack|forward|striker|winger|^4$/.test(raw)) return "ATT";
  if (/mid|^3$/.test(raw)) return "MID";
  if (/def|back|^2$/.test(raw)) return "DEF";
  if (/goal|keeper|^1$/.test(raw)) return "GK";
  return "OTHER";
}

function latestLineups(rows: unknown[]): unknown[][] {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = record(rows[index]);
    const sides = first(row, ["lineups", "Lineups"]);
    if (!Array.isArray(sides) || sides.length < 2) continue;
    const participantIds = [text(first(row, ["participant1Id", "Participant1Id"])), text(first(row, ["participant2Id", "Participant2Id"]))];
    const orderedSides = participantIds.every(Boolean)
      ? participantIds.map((participantId) => sides.find((side) => text(first(record(side), ["id", "Id"])) === participantId)).map((side, sideIndex) => side ?? sides[sideIndex])
      : sides.slice(0, 2);
    const normalized = orderedSides.map((side) => {
      const sideRecord = record(side);
      const players = first(sideRecord, ["lineups", "Lineups", "players", "Players"]);
      return Array.isArray(players) ? players : [];
    });
    if (normalized.some((players) => players.length)) return normalized;
  }
  return [[], []];
}

function statMap(rows: unknown[], participant: 1 | 2): UnknownRecord {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = record(rows[index]);
    const soccer = record(first(row, ["playerStatsSoccer", "PlayerStatsSoccer"]));
    const side = record(first(soccer, participant === 1 ? ["Participant1", "participant1"] : ["Participant2", "participant2"]));
    if (side && Object.keys(side).length) return side;
  }
  return {};
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
    const soccer = record(first(row, ["scoreSoccer", "ScoreSoccer"]));
    const p1 = record(first(soccer, ["Participant1", "participant1"]));
    const p2 = record(first(soccer, ["Participant2", "participant2"]));
    const p1Total = record(first(p1, ["Total", "total"]));
    const p2Total = record(first(p2, ["Total", "total"]));
    const p1Goals = first(p1Total, ["Goals", "goals"]);
    const p2Goals = first(p2Total, ["Goals", "goals"]);
    if (p1Goals !== undefined && p2Goals !== undefined) {
      return { participant1Score: numberValue(p1Goals), participant2Score: numberValue(p2Goals) };
    }
  }
  return { participant1Score: null, participant2Score: null };
}

export function normalizeMatchFeed(payload: unknown): MatchFeed {
  const rows = payloadRows(payload);
  const lineups = latestLineups(rows);
  const players: LivePlayer[] = [];
  for (const participant of [1, 2] as const) {
    const stats = statMap(rows, participant);
    for (const item of lineups[participant - 1] ?? []) {
      const entry = record(item);
      if (!entry) continue;
      const playerObject = record(first(entry, ["player", "Player"])) ?? entry;
      const id = text(first(entry, ["fixturePlayerId", "FixturePlayerId", "playerId", "PlayerId", "id"]));
      const name = text(first(playerObject, ["preferredName", "PreferredName", "name", "Name"]));
      if (!id || !name) continue;
       const playerStats = record(stats[id]) ?? null;
       const sofascoreIdVal = first(playerObject, ["normativeId", "NormativeId"]);
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
         sofascoreId: sofascoreIdVal !== undefined ? numberValue(sofascoreIdVal) : null,
       });
     }
   }
  const score = latestScore(payload);
  const latest = record(rows.at(-1));
  return { players, ...score, action: latest ? actionName(latest) || null : null, sequence: latest && first(latest, ["Seq", "seq"]) !== undefined ? numberValue(first(latest, ["Seq", "seq"])) : null };
}
