import React, { useState } from "react";
import { View, Text, StyleSheet, Image, TouchableOpacity } from "react-native";
import { LivePlayer, PositionMatchup, TrioComparisonSummary } from "../types/match";
import { COLORS, getRatingColor } from "../theme/colors";

interface TrioMatchupHeroProps {
  summary: TrioComparisonSummary;
  userTeamName: string;
  oppTeamName: string;
  onPlayerPress?: (player: LivePlayer) => void;
}

function getPlayerPhotoUrl(player: LivePlayer | null): { uri: string } | null {
  if (player && player.sofascoreId) {
    return { uri: `https://api.sofascore.app/api/v1/player/${player.sofascoreId}/image` };
  }
  return null;
}

function getPlayerRoleText(player: LivePlayer | null): string {
  if (!player) return "DNP";
  if (player.starter) return "Starter · 90 min";
  if (player.stats && player.stats.minutes > 0) {
    return `Sub · Entered ${90 - player.stats.minutes}'`;
  }
  return "Did not play · DNP";
}

const MatchupRow: React.FC<{
  matchup: PositionMatchup;
  oppTeamName: string;
  onPlayerPress?: (player: LivePlayer) => void;
}> = ({ matchup, oppTeamName, onPlayerPress }) => {
  const { position, userPlayer, oppositionPlayer, userRating, oppositionRating } = matchup;
  const diff = userRating - oppositionRating;
  const [userImgError, setUserImgError] = useState(false);
  const [oppImgError, setOppImgError] = useState(false);

  const userPhoto = getPlayerPhotoUrl(userPlayer);
  const oppPhoto = getPlayerPhotoUrl(oppositionPlayer);

  return (
    <View style={styles.rowContainer}>
      <Text style={styles.positionText}>{position}</Text>
      
      <View style={styles.gridContainer}>
        {/* User Player (Left) */}
        {userPlayer ? (
          <TouchableOpacity
            style={styles.playerBlock}
            activeOpacity={0.7}
            onPress={() => onPlayerPress?.(userPlayer)}
          >
            <View style={styles.avatarContainer}>
              {!userImgError && userPhoto ? (
                <Image source={userPhoto} style={styles.avatar} onError={() => setUserImgError(true)} />
              ) : (
                <View style={styles.fallbackAvatar}>
                  <Text style={styles.fallbackInitials}>{userPlayer.name.slice(0, 2).toUpperCase()}</Text>
                </View>
              )}
            </View>
            <View style={styles.playerInfo}>
              <Text style={styles.playerName} numberOfLines={1}>{userPlayer.name.split(",")[0]}</Text>
              <Text style={styles.playerRole}>{getPlayerRoleText(userPlayer)}</Text>
            </View>
            <Text style={[styles.ratingDigit, { color: getRatingColor(userRating) }]}>
              {userRating > 0 ? userRating.toFixed(1) : "—"}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.playerBlock}>
            <View style={styles.fallbackAvatar} />
            <Text style={styles.playerName}>No pick</Text>
          </View>
        )}

        {/* Diff Badge (Center) */}
        <View style={styles.diffBlock}>
          <Text style={styles.diffLabel}>Diff</Text>
          <View style={[
            styles.diffPill,
            diff > 0 ? styles.diffPositive : diff < 0 ? styles.diffNegative : styles.diffNeutral
          ]}>
            <Text style={[
              styles.diffText,
              diff > 0 ? styles.textPositive : diff < 0 ? styles.textNegative : styles.textNeutral
            ]}>
              {diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1)}
            </Text>
          </View>
        </View>

        {/* Opposition Player (Right) */}
        {oppositionPlayer ? (
          <TouchableOpacity
            style={[styles.playerBlock, styles.rowReverse]}
            activeOpacity={0.7}
            onPress={() => onPlayerPress?.(oppositionPlayer)}
          >
            <View style={styles.avatarContainer}>
              {!oppImgError && oppPhoto ? (
                <Image source={oppPhoto} style={styles.avatar} onError={() => setOppImgError(true)} />
              ) : (
                <View style={styles.fallbackAvatar}>
                  <Text style={styles.fallbackInitials}>{oppositionPlayer.name.slice(0, 2).toUpperCase()}</Text>
                </View>
              )}
            </View>
            <View style={[styles.playerInfo, styles.alignRight]}>
              <Text style={styles.playerName} numberOfLines={1}>{oppositionPlayer.name.split(",")[0]}</Text>
              <Text style={styles.playerRole}>{getPlayerRoleText(oppositionPlayer)}</Text>
            </View>
            <Text style={[styles.ratingDigit, styles.ratingDigitOpp, { color: getRatingColor(oppositionRating) }]}>
              {oppositionRating > 0 ? oppositionRating.toFixed(1) : "—"}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={[styles.playerBlock, styles.rowReverse]}>
            <View style={styles.fallbackAvatar} />
            <Text style={styles.playerName}>—</Text>
          </View>
        )}
      </View>
    </View>
  );
};

export const TrioMatchupHero: React.FC<TrioMatchupHeroProps> = ({
  summary,
  userTeamName,
  oppTeamName,
  onPlayerPress,
}) => {
  const { matchups, userTotalRating, oppositionTotalRating, matchIndex } = summary;

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        {/* Header */}
        <View style={styles.cardHeader}>
          <Text style={styles.headerTitle}>YOUR THREE</Text>
          <Text style={styles.headerTitle}>BEST OF {oppTeamName.toUpperCase()}</Text>
        </View>

        {/* Position rows */}
        <View style={styles.rowsContainer}>
          {matchups.map(m => (
            <MatchupRow
              key={m.position}
              matchup={m}
              oppTeamName={oppTeamName}
              onPlayerPress={onPlayerPress}
            />
          ))}
        </View>

        {/* Comparison Summary Totals */}
        <View style={styles.totalsContainer}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Your Trio</Text>
            <Text style={styles.totalValue}>{userTotalRating.toFixed(1)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Best of {oppTeamName}</Text>
            <Text style={styles.totalValue}>{oppositionTotalRating.toFixed(1)}</Text>
          </View>
          <View style={[styles.totalRow, styles.borderTop]}>
            <Text style={styles.totalLabelBold}>MATCH INDEX</Text>
            <Text style={styles.indexValue}>{matchIndex !== null ? matchIndex.toFixed(1) : "—"}</Text>
          </View>
          {userTotalRating > 0 && oppositionTotalRating > 0 && (
            <Text style={styles.differenceText}>
              Your trio finished {Math.abs(userTotalRating - oppositionTotalRating).toFixed(1)} rating points {userTotalRating >= oppositionTotalRating ? "ahead" : "behind"}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    marginVertical: 8,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingBottom: 10,
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 10,
    fontWeight: "900",
    color: COLORS.textSecondary,
    letterSpacing: 0.8,
  },
  rowsContainer: {
    flexDirection: "column",
  },
  rowContainer: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  positionText: {
    fontSize: 9,
    fontWeight: "900",
    color: COLORS.textMuted,
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  gridContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  playerBlock: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1.2,
    minWidth: 0,
  },
  rowReverse: {
    flexDirection: "row-reverse",
  },
  avatarContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: "hidden",
    backgroundColor: COLORS.background,
  },
  avatar: {
    width: "100%",
    height: "100%",
  },
  fallbackAvatar: {
    width: "100%",
    height: "100%",
    backgroundColor: COLORS.cardHover,
    justifyContent: "center",
    alignItems: "center",
  },
  fallbackInitials: {
    fontSize: 10,
    color: COLORS.textSecondary,
    fontWeight: "800",
  },
  playerInfo: {
    marginLeft: 8,
    marginRight: 8,
    flex: 1,
    minWidth: 0,
  },
  alignRight: {
    alignItems: "flex-end",
  },
  playerName: {
    fontSize: 12,
    fontWeight: "750",
    color: COLORS.textPrimary,
  },
  playerRole: {
    fontSize: 8,
    color: COLORS.textSecondary,
    marginTop: 1,
  },
  ratingDigit: {
    fontSize: 12,
    fontWeight: "900",
    marginLeft: "auto",
  },
  ratingDigitOpp: {
    marginLeft: 0,
    marginRight: "auto",
  },
  diffBlock: {
    width: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  diffLabel: {
    fontSize: 7,
    color: COLORS.textMuted,
    fontWeight: "700",
  },
  diffPill: {
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    marginTop: 2,
  },
  diffPositive: {
    backgroundColor: "rgba(45, 101, 61, 0.08)",
  },
  diffNegative: {
    backgroundColor: "rgba(232, 163, 14, 0.08)",
  },
  diffNeutral: {
    backgroundColor: "rgba(0,0,0,0.03)",
  },
  diffText: {
    fontSize: 9,
    fontWeight: "900",
  },
  textPositive: {
    color: COLORS.successGreen,
  },
  textNegative: {
    color: COLORS.warningAmber,
  },
  textNeutral: {
    color: COLORS.textSecondary,
  },
  totalsContainer: {
    marginTop: 14,
    paddingTop: 12,
    flexDirection: "column",
    gap: 6,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  borderTop: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 8,
    marginTop: 4,
  },
  totalLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  totalValue: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  totalLabelBold: {
    fontSize: 11,
    fontWeight: "900",
    color: COLORS.textPrimary,
    letterSpacing: 0.5,
  },
  indexValue: {
    fontSize: 16,
    fontWeight: "900",
    color: COLORS.primary,
  },
  differenceText: {
    fontSize: 10,
    color: COLORS.textSecondary,
    marginTop: 4,
    fontStyle: "italic",
  },
});
