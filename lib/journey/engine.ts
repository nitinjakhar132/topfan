/**
 * ONE NATION — Supporter Journey Engine
 *
 * Server-side business logic for managing supporter team journeys.
 * Handles journey creation, match finalisation, rank recalculation,
 * and eligibility checks.
 */

import { eq, and, desc, sql, count } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import type { SupporterTeamJourney, JourneyEventType } from "./types";
import { TOP_FAN_THRESHOLD } from "./types";

type DB = DrizzleD1Database<typeof schema>;

// ─── ID Generation ──────────────────────────────────────────────────────────

function generateJourneyId(): string {
  // Simple timestamp-based ID with random suffix
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `j_${ts}_${rand}`;
}

// ─── Journey Lifecycle ──────────────────────────────────────────────────────

/**
 * Ensure a team journey exists for the given wallet+competition+team.
 * Creates one if it doesn't exist. Returns the journey record.
 */
export async function ensureTeamJourney(
  db: DB,
  wallet: string,
  competitionId: string,
  teamId: string,
): Promise<SupporterTeamJourney> {
  // Try to find existing journey
  const [existing] = await db
    .select()
    .from(schema.supporterTeamJourneys)
    .where(
      and(
        eq(schema.supporterTeamJourneys.wallet, wallet),
        eq(schema.supporterTeamJourneys.competitionId, competitionId),
        eq(schema.supporterTeamJourneys.teamId, teamId),
      ),
    )
    .limit(1);

  if (existing) {
    return existing as unknown as SupporterTeamJourney;
  }

  // Count eligible matches for this team
  const eligibleCount = await countEligibleMatches(db, competitionId, teamId);

  const id = generateJourneyId();
  const now = new Date().toISOString();

  await db.insert(schema.supporterTeamJourneys).values({
    id,
    wallet,
    competitionId,
    teamId,
    startedAt: now,
    status: "active",
    eligibleMatches: eligibleCount,
    matchesFollowed: 0,
    consecutiveMatches: 0,
    totalJourneyScore: 0,
    topFanEligible: false,
  });

  // Record journey_started event
  await insertJourneyEvent(db, {
    wallet,
    competitionId,
    teamId,
    eventType: "journey_started",
    headline: "JOURNEY STARTED",
    summary: "You began following this team through the World Cup.",
  });

  const [created] = await db
    .select()
    .from(schema.supporterTeamJourneys)
    .where(eq(schema.supporterTeamJourneys.id, id))
    .limit(1);

  return created as unknown as SupporterTeamJourney;
}

// ─── Match Finalisation ─────────────────────────────────────────────────────

/**
 * Record a completed match into the journey system.
 * Called after matchScores are finalised.
 */
export async function finaliseMatchJourney(
  db: DB,
  wallet: string,
  competitionId: string,
  fixtureId: string,
  teamId: string,
  attackerId: string,
  midfielderId: string,
  defenderId: string,
  trioTotal: number,
  oppositionBenchmark: number,
  matchIndex: number,
): Promise<void> {
  // Ensure journey exists
  const journey = await ensureTeamJourney(db, wallet, competitionId, teamId);

  const scoreBefore = journey.totalJourneyScore;
  const scoreAfter = scoreBefore + matchIndex;
  const matchesFollowed = journey.matchesFollowed + 1;
  const rankBefore = journey.currentTeamRank;

  // Insert match journey record
  await db.insert(schema.supporterMatchJourneys).values({
    wallet,
    competitionId,
    fixtureId,
    teamId,
    attackerId,
    midfielderId,
    defenderId,
    trioTotal,
    oppositionBenchmark,
    finalMatchIndex: matchIndex,
    journeyScoreBefore: scoreBefore,
    journeyScoreAfter: scoreAfter,
    rankBefore,
    participationNumber: matchesFollowed,
    finalisedAt: new Date().toISOString(),
  }).onConflictDoUpdate({
    target: [schema.supporterMatchJourneys.wallet, schema.supporterMatchJourneys.fixtureId],
    set: {
      trioTotal,
      oppositionBenchmark,
      finalMatchIndex: matchIndex,
      journeyScoreBefore: scoreBefore,
      journeyScoreAfter: scoreAfter,
      rankBefore,
      participationNumber: matchesFollowed,
      finalisedAt: new Date().toISOString(),
    },
  });

  // Recount eligible matches
  const eligibleCount = await countEligibleMatches(db, competitionId, teamId);

  // Update the team journey totals
  const avgMatchIndex = matchesFollowed > 0 ? scoreAfter / matchesFollowed : null;
  const eligible = computeTopFanEligibility(matchesFollowed, eligibleCount);

  await db
    .update(schema.supporterTeamJourneys)
    .set({
      totalJourneyScore: scoreAfter,
      matchesFollowed,
      averageMatchIndex: avgMatchIndex,
      eligibleMatches: eligibleCount,
      consecutiveMatches: journey.consecutiveMatches + 1,
      lastParticipatedAt: new Date().toISOString(),
      topFanEligible: eligible,
    })
    .where(eq(schema.supporterTeamJourneys.id, journey.id));

  // Recalculate team ranks
  await recalculateTeamRanks(db, competitionId, teamId);

  // Update rankAfter in the match journey
  const [updatedJourney] = await db
    .select()
    .from(schema.supporterTeamJourneys)
    .where(eq(schema.supporterTeamJourneys.id, journey.id))
    .limit(1);

  if (updatedJourney) {
    await db
      .update(schema.supporterMatchJourneys)
      .set({ rankAfter: updatedJourney.currentTeamRank })
      .where(
        and(
          eq(schema.supporterMatchJourneys.wallet, wallet),
          eq(schema.supporterMatchJourneys.fixtureId, fixtureId),
        ),
      );
  }

  // Evaluate Milestones
  await evaluateMilestones(db, wallet, competitionId, teamId, fixtureId);

  // Record match_completed event
  await insertJourneyEvent(db, {
    wallet,
    competitionId,
    teamId,
    fixtureId,
    eventType: "match_completed",
    headline: "MATCH COMPLETED",
    summary: `Match Index ${matchIndex.toFixed(1)} · ${rankBefore ? `#${rankBefore}` : "—"} → #${updatedJourney?.currentTeamRank ?? "—"}`,
    metadata: {
      matchIndex,
      scoreBefore,
      scoreAfter,
      rankBefore,
      rankAfter: updatedJourney?.currentTeamRank ?? null,
    },
  });
}

// ─── Rank Recalculation ─────────────────────────────────────────────────────

/**
 * Recalculate team supporter ranks after a match finalises.
 * Orders all journeys for the same team by totalJourneyScore desc.
 */
export async function recalculateTeamRanks(
  db: DB,
  competitionId: string,
  teamId: string,
): Promise<void> {
  const journeys = await db
    .select({
      id: schema.supporterTeamJourneys.id,
      totalJourneyScore: schema.supporterTeamJourneys.totalJourneyScore,
    })
    .from(schema.supporterTeamJourneys)
    .where(
      and(
        eq(schema.supporterTeamJourneys.competitionId, competitionId),
        eq(schema.supporterTeamJourneys.teamId, teamId),
      ),
    )
    .orderBy(desc(schema.supporterTeamJourneys.totalJourneyScore));

  const total = journeys.length;

  for (let i = 0; i < journeys.length; i++) {
    const rank = i + 1;
    const percentile = total <= 1 ? 100 : ((total - rank) / (total - 1)) * 100;

    // Fetch current best rank
    const [current] = await db
      .select({ bestTeamRank: schema.supporterTeamJourneys.bestTeamRank })
      .from(schema.supporterTeamJourneys)
      .where(eq(schema.supporterTeamJourneys.id, journeys[i].id))
      .limit(1);

    const bestRank = current?.bestTeamRank
      ? Math.min(current.bestTeamRank, rank)
      : rank;

    await db
      .update(schema.supporterTeamJourneys)
      .set({
        currentTeamRank: rank,
        bestTeamRank: bestRank,
        percentile: Math.round(percentile * 10) / 10,
      })
      .where(eq(schema.supporterTeamJourneys.id, journeys[i].id));
  }
}

// ─── Eligibility ────────────────────────────────────────────────────────────

/**
 * Check if a supporter qualifies for top-fan status.
 * Requires following at least 75% of the team's matches.
 */
export function computeTopFanEligibility(
  matchesFollowed: number,
  eligibleMatches: number,
): boolean {
  if (eligibleMatches <= 0) return false;
  return matchesFollowed / eligibleMatches >= TOP_FAN_THRESHOLD;
}

// ─── Tournament Stage ───────────────────────────────────────────────────────

/**
 * Determine the current tournament stage for a team based on their fixtures.
 */
export function getCurrentStage(phase: string | null): string {
  if (!phase) return "Group Stage";
  const stageMap: Record<string, string> = {
    scheduled: "Upcoming",
    group: "Group Stage",
    round_of_32: "Round of 32",
    round_of_16: "Round of 16",
    quarter_final: "Quarter-final",
    semi_final: "Semi-final",
    final: "Final",
    third_place: "Third Place",
  };
  return stageMap[phase.toLowerCase()] ?? phase;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function countEligibleMatches(
  db: DB,
  competitionId: string,
  teamId: string,
): Promise<number> {
  const [result] = await db
    .select({ count: count() })
    .from(schema.fixtures)
    .where(
      and(
        eq(schema.fixtures.competitionId, competitionId),
        sql`(${schema.fixtures.homeTeamId} = ${teamId} OR ${schema.fixtures.awayTeamId} = ${teamId})`,
      ),
    );
  return result?.count ?? 0;
}

async function insertJourneyEvent(
  db: DB,
  event: {
    wallet: string;
    competitionId: string;
    teamId: string;
    fixtureId?: string;
    eventType: JourneyEventType;
    headline: string;
    summary?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(schema.supporterJourneyEvents).values({
    wallet: event.wallet,
    competitionId: event.competitionId,
    teamId: event.teamId,
    fixtureId: event.fixtureId ?? null,
    eventType: event.eventType,
    headline: event.headline,
    summary: event.summary ?? null,
    metadataJson: JSON.stringify(event.metadata ?? {}),
  });
}

/**
 * Evaluate and unlock milestones for a user.
 */
export async function evaluateMilestones(
  db: DB,
  wallet: string,
  competitionId: string,
  teamId: string,
  fixtureId: string,
): Promise<void> {
  const [journey] = await db
    .select()
    .from(schema.supporterTeamJourneys)
    .where(
      and(
        eq(schema.supporterTeamJourneys.wallet, wallet),
        eq(schema.supporterTeamJourneys.competitionId, competitionId),
        eq(schema.supporterTeamJourneys.teamId, teamId),
      ),
    )
    .limit(1);

  if (!journey) return;

  const now = new Date().toISOString();

  const unlockMilestone = async (key: string, headline: string, summary: string) => {
    // Check if already unlocked
    const [existing] = await db
      .select()
      .from(schema.supporterMilestones)
      .where(
        and(
          eq(schema.supporterMilestones.wallet, wallet),
          eq(schema.supporterMilestones.competitionId, competitionId),
          eq(schema.supporterMilestones.teamId, teamId),
          eq(schema.supporterMilestones.milestoneKey, key),
        ),
      )
      .limit(1);

    if (existing) return;

    // Unlock milestone
    await db.insert(schema.supporterMilestones).values({
      wallet,
      competitionId,
      teamId,
      milestoneKey: key,
      fixtureId,
      unlockedAt: now,
      metadataJson: "{}",
    });

    // Record milestone unlock journey event
    await insertJourneyEvent(db, {
      wallet,
      competitionId,
      teamId,
      fixtureId,
      eventType: "rank_milestone",
      headline,
      summary,
    });
  };

  // 1. FIRST_MATCH
  if (journey.matchesFollowed >= 1) {
    await unlockMilestone("FIRST_MATCH", "FIRST MATCH FOLLOWED", "You completed your first match supporting this nation.");
  }

  // 2. THREE_MATCH_STREAK
  if (journey.consecutiveMatches >= 3) {
    await unlockMilestone("THREE_MATCH_STREAK", "THREE-MATCH STREAK", "You followed three consecutive supporter matches!");
  }

  // 3. PERFECT_THREE
  const [scoreRow] = await db
    .select()
    .from(schema.matchScores)
    .where(
      and(
        eq(schema.matchScores.fixtureId, fixtureId),
        eq(schema.matchScores.wallet, wallet)
      )
    )
    .limit(1);

  if (scoreRow && scoreRow.selectionAccuracy >= 1.0) {
    await unlockMilestone("PERFECT_THREE", "PERFECT MATCHDAY TRIO", "You selected the absolute highest-rated ATT, MID and DEF!");
  }

  // 4. TOP_10_PERCENT
  if (journey.percentile && journey.percentile >= 90.0) {
    await unlockMilestone("TOP_10_PERCENT", "TOP 10% SUPPORTER", `You climbed into the top 10% of all fans!`);
  }

  // 5. TOP_1_PERCENT
  if (journey.percentile && journey.percentile >= 99.0) {
    await unlockMilestone("TOP_1_PERCENT", "TOP 1% SUPPORTER", `You climbed into the top 1% of all fans!`);
  }

  // 6. TOP_100
  if (journey.currentTeamRank && journey.currentTeamRank <= 100) {
    await unlockMilestone("TOP_100", "TOP 100 FAN", `You entered the top 100 leaderboard for this team!`);
  }

  // 7. EVER_PRESENT
  if (journey.matchesFollowed === journey.eligibleMatches && journey.status === "completed") {
    await unlockMilestone("EVER_PRESENT", "EVER-PRESENT FAN", `You followed 100% of this team's fixtures through the World Cup!`);
  }
}

