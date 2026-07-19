import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { COLORS } from "../theme/colors";
import type { JourneyLeaderboardEntry } from "../types/match";

interface JourneyLeaderboardPreviewProps {
  top: JourneyLeaderboardEntry[];
  user: JourneyLeaderboardEntry | null;
  totalParticipants: number;
  top1PercentCutoff: number | null;
  rankHistory: number[];
  teamName: string;
  userScore: number;
}

export const JourneyLeaderboardPreview: React.FC<JourneyLeaderboardPreviewProps> = ({
  top,
  user,
  totalParticipants,
  top1PercentCutoff,
  rankHistory,
  teamName,
  userScore,
}) => {
  // Calculate distance to top 1%
  const distanceTo1Percent =
    top1PercentCutoff !== null ? Math.max(0, top1PercentCutoff - userScore) : null;

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>{teamName.toUpperCase()} SUPPORTER LEADERBOARD</Text>

      <View style={styles.card}>
        {/* Header row */}
        <View style={styles.headerRow}>
          <Text style={styles.headerText}>#</Text>
          <Text style={[styles.headerText, styles.headerName]}>Supporter</Text>
          <Text style={styles.headerText}>Score</Text>
        </View>

        {/* Top 3 */}
        {top.map((entry) => (
          <View
            key={entry.wallet}
            style={[styles.row, entry.isCurrentUser && styles.currentUserRow]}
          >
            <Text style={styles.rank}>{entry.rank}</Text>
            <Text style={[styles.name, entry.isCurrentUser && styles.currentUserName]}>
              {entry.isCurrentUser ? "You" : entry.displayName}
            </Text>
            <Text style={[styles.score, entry.isCurrentUser && styles.currentUserScore]}>
              {entry.totalScore.toFixed(1)}
            </Text>
          </View>
        ))}

        {/* Separator dots */}
        {user && !top.some((e) => e.isCurrentUser) && (
          <>
            <Text style={styles.dots}>···</Text>
            <View style={[styles.row, styles.currentUserRow]}>
              <Text style={styles.rank}>{user.rank.toLocaleString()}</Text>
              <Text style={[styles.name, styles.currentUserName]}>You</Text>
              <Text style={[styles.score, styles.currentUserScore]}>
                {user.totalScore.toFixed(1)}
              </Text>
            </View>
          </>
        )}

        {/* Top 1% cutoff */}
        {top1PercentCutoff !== null && (
          <View style={styles.cutoffRow}>
            <Text style={styles.cutoffText}>
              Top 1% cutoff: {top1PercentCutoff.toFixed(1)}
            </Text>
            {distanceTo1Percent !== null && distanceTo1Percent > 0 && (
              <Text style={styles.distanceText}>
                {distanceTo1Percent.toFixed(1)} points away
              </Text>
            )}
          </View>
        )}
      </View>

      {/* Next milestone */}
      {distanceTo1Percent !== null && distanceTo1Percent > 0 && (
        <View style={styles.milestoneCard}>
          <Text style={styles.milestoneLabel}>NEXT MILESTONE</Text>
          <Text style={styles.milestoneText}>
            Reach the top 1% · {distanceTo1Percent.toFixed(1)} points away
          </Text>
        </View>
      )}

      {/* Rank history strip */}
      {rankHistory.length > 1 && (
        <View style={styles.rankHistoryCard}>
          <Text style={styles.rankHistoryLabel}>RANK PROGRESSION</Text>
          <Text style={styles.rankHistoryStrip}>
            {rankHistory.map((r) => `#${r.toLocaleString()}`).join(" → ")}
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: "900",
    color: COLORS.textSecondary,
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingBottom: 8,
    marginBottom: 8,
  },
  headerText: {
    fontSize: 8,
    fontWeight: "800",
    color: COLORS.textMuted,
    letterSpacing: 0.5,
  },
  headerName: {
    flex: 1,
    marginLeft: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 5,
  },
  currentUserRow: {
    backgroundColor: COLORS.primaryMuted,
    borderRadius: 8,
    paddingHorizontal: 8,
    marginHorizontal: -4,
  },
  rank: {
    width: 36,
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.textSecondary,
  },
  name: {
    flex: 1,
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  currentUserName: {
    fontWeight: "800",
    color: COLORS.primary,
  },
  score: {
    fontSize: 11,
    fontWeight: "900",
    color: COLORS.textPrimary,
  },
  currentUserScore: {
    color: COLORS.primary,
  },
  dots: {
    textAlign: "center",
    color: COLORS.textMuted,
    fontSize: 14,
    marginVertical: 2,
  },
  cutoffRow: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 8,
    marginTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  cutoffText: {
    fontSize: 9,
    color: COLORS.textMuted,
    fontWeight: "600",
  },
  distanceText: {
    fontSize: 9,
    color: COLORS.accentGold,
    fontWeight: "800",
  },
  milestoneCard: {
    backgroundColor: "rgba(232, 163, 14, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(232, 163, 14, 0.15)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  milestoneLabel: {
    fontSize: 8,
    fontWeight: "900",
    color: COLORS.accentGold,
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  milestoneText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  rankHistoryCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  rankHistoryLabel: {
    fontSize: 8,
    fontWeight: "900",
    color: COLORS.textSecondary,
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  rankHistoryStrip: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.successGreen,
  },
});
