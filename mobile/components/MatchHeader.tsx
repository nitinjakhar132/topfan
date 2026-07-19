import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LiveFixture } from "../types/match";
import { COLORS } from "../theme/colors";

interface MatchHeaderProps {
  fixture: LiveFixture;
  selectedTeamId: string;
  onBackPressed: () => void;
}

function getTeamInitials(name: string): string {
  if (!name) return "TM";
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.slice(0, 3).toUpperCase();
}

export const MatchHeader: React.FC<MatchHeaderProps> = ({
  fixture,
  selectedTeamId,
  onBackPressed,
}) => {
  const isCompleted = fixture.status === "COMPLETED";
  const isLive = fixture.status === "LIVE" || fixture.status === "HALF_TIME";
  const homeScore = fixture.homeScore ?? "—";
  const awayScore = fixture.awayScore ?? "—";
  const selectedTeamName =
    selectedTeamId === fixture.homeTeamId
      ? fixture.homeTeam
      : selectedTeamId === fixture.awayTeamId
      ? fixture.awayTeam
      : "";

  return (
    <View style={styles.container}>
      {/* Top Bar navigation */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={onBackPressed}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={20} color={COLORS.textPrimary} />
          <Text style={styles.backText}>Matches</Text>
        </TouchableOpacity>

        <View style={styles.statusPill}>
          <Text style={styles.statusText}>COMPLETED</Text>
        </View>
      </View>

      {/* Tournament sub-title */}
      <Text style={styles.tournamentText}>
        FIFA World Cup 2026™ · {fixture.tournamentName || "SEMI-FINAL"}
      </Text>

      {/* Score Banner */}
      <View style={styles.scoreBanner}>
        {/* Home Team */}
        <View style={styles.teamCol}>
          <View style={styles.teamAvatar}>
            <Text style={styles.teamInitials}>
              {getTeamInitials(fixture.homeTeam)}
            </Text>
          </View>
          <Text style={styles.teamName} numberOfLines={1}>
            {fixture.homeTeam}
          </Text>
        </View>

        {/* Score Display */}
        <View style={styles.scoreContainer}>
          <View style={styles.scoreBox}>
            <Text style={styles.scoreDigit}>{homeScore}</Text>
            <Text style={styles.scoreSeparator}>–</Text>
            <Text style={styles.scoreDigit}>{awayScore}</Text>
          </View>
          <Text style={styles.timeLabel}>Full Time</Text>
        </View>

        {/* Away Team */}
        <View style={styles.teamCol}>
          <View style={styles.teamAvatar}>
            <Text style={styles.teamInitials}>
              {getTeamInitials(fixture.awayTeam)}
            </Text>
          </View>
          <Text style={styles.teamName} numberOfLines={1}>
            {fixture.awayTeam}
          </Text>
        </View>
      </View>

      {selectedTeamName ? (
        <View style={styles.mechanicNotice}>
          <Ionicons name="shield-checkmark" size={15} color={COLORS.successGreen} />
          <Text style={styles.mechanicNoticeText}>
            You supported <Text style={styles.boldTeam}>{selectedTeamName}</Text>
          </Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.surface,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    paddingRight: 12,
  },
  backText: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: "600",
    marginLeft: 6,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: COLORS.card,
    flexDirection: "row",
    alignItems: "center",
  },
  statusCompleted: {
    backgroundColor: COLORS.completedBg,
  },
  statusLive: {
    backgroundColor: COLORS.livePulse,
  },
  liveIndicatorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.liveText,
    marginRight: 6,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.textSecondary,
    letterSpacing: 0.8,
  },
  statusTextCompleted: {
    color: COLORS.completedText,
  },
  statusTextLive: {
    color: COLORS.liveText,
  },
  tournamentText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 16,
    textAlign: "center",
  },
  scoreBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  teamCol: {
    flex: 1,
    alignItems: "center",
  },
  teamAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: COLORS.card,
    borderWidth: 2,
    borderColor: COLORS.border,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  teamAvatarSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryMuted,
  },
  teamInitials: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: "800",
  },
  teamName: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  selectedBadge: {
    marginTop: 4,
    backgroundColor: COLORS.primaryMuted,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(0, 240, 255, 0.3)",
  },
  selectedBadgeText: {
    color: COLORS.primary,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  scoreContainer: {
    paddingHorizontal: 16,
    alignItems: "center",
  },
  scoreBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.background,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
  },
  scoreDigit: {
    fontSize: 28,
    fontWeight: "900",
    color: COLORS.textPrimary,
    minWidth: 28,
    textAlign: "center",
  },
  scoreSeparator: {
    fontSize: 26,
    fontWeight: "700",
    color: COLORS.textMuted,
    marginHorizontal: 6,
  },
  timeLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: "600",
    marginTop: 6,
  },
  mechanicNotice: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.glassBg,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 18,
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
  },
  mechanicNoticeText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginLeft: 8,
    flex: 1,
    lineHeight: 16,
  },
  boldTeam: {
    color: COLORS.primary,
    fontWeight: "800",
  },
});
