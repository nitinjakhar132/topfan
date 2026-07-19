import React, { useState } from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { LivePlayer } from "../types/match";
import { COLORS, getRatingColor } from "../theme/colors";

interface BenchListProps {
  homeSubs: LivePlayer[];
  awaySubs: LivePlayer[];
  homeTeamName: string;
  awayTeamName: string;
}

function getPlayerPhotoUrl(player: LivePlayer): { uri: string } | null {
  if (player.sofascoreId) {
    return { uri: `https://api.sofascore.app/api/v1/player/${player.sofascoreId}/image` };
  }
  return null;
}

const BenchRow: React.FC<{ player: LivePlayer }> = ({ player }) => {
  const [imgError, setImgError] = useState(false);
  const photoUrl = getPlayerPhotoUrl(player);
  const rating = player.impactRating;
  const ratingColor = getRatingColor(rating);

  return (
    <View style={styles.benchRow}>
      <View style={styles.playerInfo}>
        <View style={styles.avatarMini}>
          {!imgError && photoUrl ? (
            <Image source={photoUrl} style={styles.avatarImg} onError={() => setImgError(true)} />
          ) : (
            <Text style={styles.avatarInitials}>{player.name.slice(0, 2).toUpperCase()}</Text>
          )}
        </View>

        <View style={styles.textCol}>
          <Text style={styles.playerName} numberOfLines={1}>
            {player.shirtNumber ? `#${player.shirtNumber} ` : ""}
            {player.name}
          </Text>
          <Text style={styles.playerMeta}>
            {player.position}
            {player.goals > 0 ? ` · ⚽ ${player.goals}` : ""}
            {player.yellowCards > 0 ? " · 🟨" : ""}
            {player.redCards > 0 ? " · 🟥" : ""}
          </Text>
        </View>
      </View>

      <View style={[styles.ratingChip, { backgroundColor: ratingColor }]}>
        <Text style={styles.ratingText}>{rating !== null ? rating.toFixed(1) : "—"}</Text>
      </View>
    </View>
  );
};

export const BenchList: React.FC<BenchListProps> = ({
  homeSubs,
  awaySubs,
  homeTeamName,
  awayTeamName,
}) => {
  return (
    <View style={styles.container}>
      {/* Home Bench */}
      <View style={styles.teamSection}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{homeTeamName} BENCH ({homeSubs.length})</Text>
        </View>
        {homeSubs.length > 0 ? (
          homeSubs.map((player) => <BenchRow key={player.id} player={player} />)
        ) : (
          <Text style={styles.emptyText}>No substitute data returned for {homeTeamName}.</Text>
        )}
      </View>

      {/* Away Bench */}
      <View style={[styles.teamSection, { marginTop: 24 }]}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{awayTeamName} BENCH ({awaySubs.length})</Text>
        </View>
        {awaySubs.length > 0 ? (
          awaySubs.map((player) => <BenchRow key={player.id} player={player} />)
        ) : (
          <Text style={styles.emptyText}>No substitute data returned for {awayTeamName}.</Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  teamSection: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sectionHeader: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingBottom: 10,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.textPrimary,
    letterSpacing: 0.8,
  },
  benchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: "rgba(255, 255, 255, 0.05)",
  },
  playerInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  avatarMini: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.card,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: "hidden",
  },
  avatarImg: {
    width: 36,
    height: 36,
  },
  avatarInitials: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  textCol: {
    flex: 1,
  },
  playerName: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  playerMeta: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  ratingChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginLeft: 12,
  },
  ratingText: {
    color: "#090B10",
    fontSize: 12,
    fontWeight: "900",
  },
  emptyText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontStyle: "italic",
    paddingVertical: 12,
    textAlign: "center",
  },
});
