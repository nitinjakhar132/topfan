import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { COLORS, getRatingColor } from "../theme/colors";
import type { TrustedPlayerSummary } from "../types/match";

interface TrustedPlayersProps {
  players: TrustedPlayerSummary[];
}

export const TrustedPlayers: React.FC<TrustedPlayersProps> = ({ players }) => {
  if (players.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No player selections recorded yet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>YOUR TRUSTED PLAYERS</Text>

      {players.map((player) => (
        <View key={player.playerId} style={styles.playerCard}>
          <View style={styles.playerHeader}>
            <View style={styles.positionBadge}>
              <Text style={styles.positionText}>{player.position}</Text>
            </View>
            <View style={styles.playerInfo}>
              <Text style={styles.playerName}>{player.playerName}</Text>
              <Text style={styles.selectionCount}>
                Selected {player.timesSelected} time{player.timesSelected !== 1 ? "s" : ""}
              </Text>
            </View>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text
                style={[
                  styles.statValue,
                  player.averageRatingWhenSelected
                    ? { color: getRatingColor(player.averageRatingWhenSelected) }
                    : {},
                ]}
              >
                {player.averageRatingWhenSelected
                  ? player.averageRatingWhenSelected.toFixed(2)
                  : "—"}
              </Text>
              <Text style={styles.statLabel}>Avg rating when selected</Text>
            </View>

            <View style={styles.statBox}>
              <Text style={styles.statValue}>
                {player.supporterPointsGenerated.toFixed(1)}
              </Text>
              <Text style={styles.statLabel}>Journey points generated</Text>
            </View>

            {player.bestFixtureOpponent && (
              <View style={styles.statBox}>
                <Text style={styles.statValueSmall}>
                  vs {player.bestFixtureOpponent}
                </Text>
                <Text style={styles.statLabel}>Best match</Text>
              </View>
            )}
          </View>
        </View>
      ))}
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
  emptyContainer: {
    padding: 24,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontStyle: "italic",
  },
  playerCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
  },
  playerHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  positionBadge: {
    backgroundColor: COLORS.cardHover,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 10,
  },
  positionText: {
    fontSize: 9,
    fontWeight: "900",
    color: COLORS.textPrimary,
  },
  playerInfo: {
    flex: 1,
  },
  playerName: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  selectionCount: {
    fontSize: 10,
    color: COLORS.textSecondary,
    fontWeight: "600",
    marginTop: 1,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 8,
  },
  statBox: {
    flex: 1,
  },
  statValue: {
    fontSize: 13,
    fontWeight: "900",
    color: COLORS.primary,
  },
  statValueSmall: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.primary,
  },
  statLabel: {
    fontSize: 7,
    fontWeight: "600",
    color: COLORS.textMuted,
    marginTop: 2,
    textTransform: "uppercase",
  },
});
