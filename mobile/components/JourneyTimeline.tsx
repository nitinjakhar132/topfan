import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { COLORS } from "../theme/colors";
import type { MatchTimelineEntry } from "../types/match";

interface JourneyTimelineProps {
  entries: MatchTimelineEntry[];
  teamName: string;
  onMatchPress?: (fixtureId: string) => void;
}

export const JourneyTimeline: React.FC<JourneyTimelineProps> = ({
  entries,
  teamName,
  onMatchPress,
}) => {
  if (entries.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No matches in this journey yet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>{teamName.toUpperCase()}'S WORLD CUP JOURNEY</Text>

      {entries.map((entry, index) => {
        const isLast = index === entries.length - 1;
        const statusIcon = entry.status === "completed" ? "✓" : entry.status === "live" ? "●" : "○";
        const statusColor =
          entry.status === "completed"
            ? COLORS.successGreen
            : entry.status === "live"
            ? COLORS.accentGold
            : COLORS.textMuted;

        const isFollowed = entry.trioNames !== null;
        const isInteractive = entry.status === "completed" && isFollowed;

        const rankMovement =
          entry.rankBefore !== null && entry.rankAfter !== null
            ? `#${entry.rankBefore.toLocaleString()} → #${entry.rankAfter.toLocaleString()}`
            : null;

        const CardWrapper = isInteractive ? TouchableOpacity : View;
        const wrapperProps = isInteractive
          ? { activeOpacity: 0.7, onPress: () => onMatchPress?.(entry.fixtureId) }
          : {};

        return (
          <View key={entry.fixtureId} style={styles.entryRow}>
            {/* Timeline spine */}
            <View style={styles.spine}>
              <Text style={[styles.statusIcon, { color: statusColor }]}>
                {statusIcon}
              </Text>
              {!isLast && <View style={styles.spineBar} />}
            </View>

            {/* Match card */}
            <CardWrapper
              style={[
                styles.matchCard,
                entry.status === "live" && styles.matchCardLive,
                entry.status === "upcoming" && styles.matchCardUpcoming,
              ]}
              {...(wrapperProps as any)}
            >
              <Text style={styles.stageLabel}>{entry.stage}</Text>

              {entry.matchResult ? (
                <Text style={styles.matchResult}>{entry.matchResult}</Text>
              ) : (
                <Text style={styles.matchResult}>
                  {teamName} vs {entry.opponent}
                </Text>
              )}

              {isFollowed && entry.trioNames ? (
                <>
                  <Text style={styles.trioLine}>
                    Your trio: {entry.trioNames.join(" · ")}
                  </Text>
                  {entry.finalMatchIndex !== null && (
                    <View style={styles.metricsRow}>
                      <Text style={styles.metricChip}>
                        Match Index: {entry.finalMatchIndex.toFixed(1)}
                      </Text>
                      {rankMovement && (
                        <Text style={styles.rankChip}>{rankMovement}</Text>
                      )}
                    </View>
                  )}
                </>
              ) : entry.status === "upcoming" ? (
                <Text style={styles.pendingText}>
                  {entry.status === "upcoming" ? "Official lineup pending" : "In progress"}
                </Text>
              ) : null}
            </CardWrapper>
          </View>
        );
      })}
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
    marginBottom: 12,
  },
  emptyContainer: {
    padding: 24,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontStyle: "italic",
  },
  entryRow: {
    flexDirection: "row",
    marginBottom: 0,
  },
  spine: {
    width: 28,
    alignItems: "center",
    paddingTop: 4,
  },
  statusIcon: {
    fontSize: 14,
    fontWeight: "800",
  },
  spineBar: {
    width: 2,
    flex: 1,
    backgroundColor: COLORS.border,
    marginTop: 4,
    marginBottom: -4,
    borderRadius: 1,
  },
  matchCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
  },
  matchCardLive: {
    borderColor: COLORS.accentGold,
    backgroundColor: "rgba(232, 163, 14, 0.04)",
  },
  matchCardUpcoming: {
    opacity: 0.7,
    borderStyle: "dashed" as any,
  },
  stageLabel: {
    fontSize: 8,
    fontWeight: "800",
    color: COLORS.textSecondary,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  matchResult: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  trioLine: {
    fontSize: 10,
    color: COLORS.textSecondary,
    fontWeight: "600",
    marginBottom: 6,
  },
  metricsRow: {
    flexDirection: "row",
    gap: 8,
  },
  metricChip: {
    fontSize: 9,
    fontWeight: "800",
    color: COLORS.primary,
    backgroundColor: COLORS.primaryMuted,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: "hidden",
  },
  rankChip: {
    fontSize: 9,
    fontWeight: "700",
    color: COLORS.successGreen,
    backgroundColor: "rgba(45, 101, 61, 0.08)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: "hidden",
  },
  pendingText: {
    fontSize: 10,
    color: COLORS.textMuted,
    fontStyle: "italic",
  },
});
