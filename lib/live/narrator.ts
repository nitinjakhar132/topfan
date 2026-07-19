/**
 * ONE NATION — Event Narrator
 *
 * Rule-based event narrator that transforms raw TxLINE events into
 * personalised user-facing cards. Each card tells the supporter whether
 * the event helped or hurt their trio, with context.
 */

import type {
  NarratorCard,
  NormalizedMatchEvent,
  PlayerRatingUpdate,
  OppositionBenchmark,
  UserTrio,
} from "./types";
import type { LiveRatingEngine } from "./rating-engine";

// ─── Headline Templates ────────────────────────────────────────────────────

const HEADLINES: Record<string, { user: string; opposition: string; neutral: string }> = {
  goal:                { user: "YOUR PLAYER SCORES! ⚽",        opposition: "OPPOSITION GOAL ⚽",       neutral: "GOAL! ⚽" },
  own_goal:            { user: "OWN GOAL DISASTER 😰",          opposition: "LUCKY BREAK — OWN GOAL!",  neutral: "OWN GOAL" },
  shot:                { user: "YOUR PLAYER SHOOTS",             opposition: "OPPOSITION SHOOTS",        neutral: "SHOT" },
  penalty:             { user: "YOUR PLAYER AT THE SPOT",        opposition: "OPPOSITION PENALTY",       neutral: "PENALTY" },
  yellow_card:         { user: "YOUR PLAYER BOOKED 🟨",         opposition: "OPPOSITION BOOKED 🟨",     neutral: "YELLOW CARD 🟨" },
  red_card:            { user: "YOUR PLAYER SENT OFF! 🟥",      opposition: "OPPOSITION RED CARD 🟥",   neutral: "RED CARD 🟥" },
  second_yellow_card:  { user: "YOUR PLAYER OFF! 🟨🟥",         opposition: "OPPOSITION OFF! 🟨🟥",     neutral: "SECOND YELLOW 🟨🟥" },
  substitution:        { user: "YOUR PLAYER SUBSTITUTED",        opposition: "OPPOSITION SUBSTITUTION",  neutral: "SUBSTITUTION" },
  corner:              { user: "YOUR TEAM — CORNER",             opposition: "OPPOSITION CORNER",        neutral: "CORNER KICK" },
  free_kick:           { user: "YOUR TEAM — FREE KICK",          opposition: "OPPOSITION FREE KICK",     neutral: "FREE KICK" },
  var:                 { user: "VAR CHECK 🔍",                   opposition: "VAR CHECK 🔍",             neutral: "VAR CHECK 🔍" },
  var_end:             { user: "VAR DECISION",                   opposition: "VAR DECISION",             neutral: "VAR DECISION" },
};

// ─── Detail Templates ──────────────────────────────────────────────────────

function detailForGoal(event: NormalizedMatchEvent, ratingUpdate?: PlayerRatingUpdate): string {
  const name = event.playerName ?? "Unknown";
  const minute = event.minute ? ` (${event.minute}')` : "";
  if (ratingUpdate) {
    const direction = ratingUpdate.delta > 0 ? "↑" : "↓";
    return `${name} finds the net${minute} — Rating ${direction} ${Math.abs(ratingUpdate.delta).toFixed(1)}`;
  }
  return `${name} scores${minute}`;
}

function detailForShot(event: NormalizedMatchEvent, ratingUpdate?: PlayerRatingUpdate): string {
  const name = event.playerName ?? "Unknown";
  const outcomes: Record<string, string> = {
    ontarget: "tests the keeper",
    offtarget: "fires wide",
    blocked: "shot blocked",
    woodwork: "hits the woodwork!",
  };
  const outcomeText = event.outcome ? outcomes[event.outcome.toLowerCase()] ?? event.outcome : "takes a shot";
  const minute = event.minute ? ` (${event.minute}')` : "";
  return `${name} ${outcomeText}${minute}`;
}

function detailForPenalty(event: NormalizedMatchEvent): string {
  const name = event.playerName ?? "Unknown";
  const outcomes: Record<string, string> = {
    scored: "converts from the spot!",
    missed: "misses the penalty!",
    retake: "penalty to be retaken",
  };
  const outcomeText = event.outcome ? outcomes[event.outcome.toLowerCase()] ?? event.outcome : "steps up";
  return `${name} ${outcomeText}`;
}

function detailForCard(event: NormalizedMatchEvent, type: string): string {
  const name = event.playerName ?? "Unknown";
  const minute = event.minute ? ` (${event.minute}')` : "";
  if (type === "red_card") return `${name} shown a straight red${minute}`;
  if (type === "second_yellow_card") return `${name} gets a second yellow and is off${minute}`;
  return `${name} picks up a yellow card${minute}`;
}

function detailForSubstitution(event: NormalizedMatchEvent): string {
  const name = event.playerName ?? "Unknown";
  const minute = event.minute ? ` at ${event.minute}'` : "";
  return `${name} makes way for a substitute${minute}`;
}

function detailGeneric(event: NormalizedMatchEvent): string {
  const name = event.playerName ?? "";
  const minute = event.minute ? ` (${event.minute}')` : "";
  return `${name} ${event.action.replace(/_/g, " ")}${minute}`.trim();
}

// ─── Narrator ──────────────────────────────────────────────────────────────

export function narrateEvent(
  event: NormalizedMatchEvent,
  ratingUpdate: PlayerRatingUpdate | undefined,
  userTrio: UserTrio,
  engine: LiveRatingEngine,
  oppositionBenchmark: OppositionBenchmark,
): NarratorCard | null {
  // Skip non-meaningful events for narration
  const meaningfulActions = new Set([
    "goal", "own_goal", "shot", "penalty", "yellow_card",
    "red_card", "second_yellow_card", "substitution", "var", "var_end",
  ]);

  // Only narrate shots that are on-target or woodwork (too noisy otherwise)
  if (event.action === "shot") {
    const outcome = event.outcome?.toLowerCase();
    if (outcome !== "ontarget" && outcome !== "woodwork") return null;
  }

  if (!meaningfulActions.has(event.action)) return null;

  // Skip player-specific events if they don't have a player ID
  const playerActions = new Set([
    "goal", "own_goal", "shot", "penalty", "yellow_card",
    "red_card", "second_yellow_card", "substitution"
  ]);
  if (playerActions.has(event.action) && !event.playerId) {
    return null;
  }

  const userPlayerIds = new Set([userTrio.attackerId, userTrio.midfielderId, userTrio.defenderId]);
  const isUserPlayer = event.playerId ? userPlayerIds.has(event.playerId) : false;

  // Determine if this event is from the user's team or opposition
  const userParticipant = getUserParticipant(userTrio, engine);
  const isUserTeamEvent = event.participantId === userParticipant;
  const isOppositionBenchmarkPlayer = event.playerId
    ? [oppositionBenchmark.bestATT?.playerId, oppositionBenchmark.bestMID?.playerId, oppositionBenchmark.bestDEF?.playerId].includes(event.playerId)
    : false;

  // Select headline
  const templates = HEADLINES[event.action] ?? { user: event.action.toUpperCase(), opposition: event.action.toUpperCase(), neutral: event.action.toUpperCase() };
  const headline = isUserPlayer ? templates.user : (isUserTeamEvent ? templates.neutral : templates.opposition);

  // Generate detail text
  let detail: string;
  switch (event.action) {
    case "goal": detail = detailForGoal(event, ratingUpdate); break;
    case "own_goal": detail = detailForGoal(event, ratingUpdate); break;
    case "shot": detail = detailForShot(event, ratingUpdate); break;
    case "penalty": detail = detailForPenalty(event); break;
    case "yellow_card":
    case "red_card":
    case "second_yellow_card": detail = detailForCard(event, event.action); break;
    case "substitution": detail = detailForSubstitution(event); break;
    default: detail = detailGeneric(event); break;
  }

  // Trio totals
  const trioIds = [userTrio.attackerId, userTrio.midfielderId, userTrio.defenderId];
  const trioTotalAfter = engine.getTrioTotal(trioIds);
  const trioTotalBefore = ratingUpdate
    ? Math.round((trioTotalAfter - ratingUpdate.delta) * 10) / 10
    : trioTotalAfter;

  return {
    headline,
    detail,
    playerRatingBefore: ratingUpdate?.ratingBefore ?? 0,
    playerRatingAfter: ratingUpdate?.ratingAfter ?? 0,
    trioTotalBefore,
    trioTotalAfter,
    isUserPlayer,
    isOppositionBenchmark: isOppositionBenchmarkPlayer,
    minute: event.minute,
    action: event.action,
    playerName: event.playerName ?? "Unknown",
    participantId: event.participantId ?? "",
  };
}

function getUserParticipant(userTrio: UserTrio, engine: LiveRatingEngine): string {
  // Determine which participant side the user's trio belongs to
  const attPlayer = engine.getPlayer(userTrio.attackerId);
  if (attPlayer) return attPlayer.participantId;
  const midPlayer = engine.getPlayer(userTrio.midfielderId);
  if (midPlayer) return midPlayer.participantId;
  const defPlayer = engine.getPlayer(userTrio.defenderId);
  if (defPlayer) return defPlayer.participantId;
  return "1"; // Default fallback
}
