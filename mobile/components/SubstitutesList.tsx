import React, { useState } from "react";
import { View, Text, StyleSheet, Image, TouchableOpacity } from "react-native";
import { LivePlayer } from "../types/match";
import { COLORS, getRatingColor } from "../theme/colors";

interface SubstitutesListProps {
  homeSubs: LivePlayer[];
  awaySubs: LivePlayer[];
  homeTeamName: string;
  awayTeamName: string;
  onPlayerPress?: (player: LivePlayer) => void;
  initialTeamId?: string;
  homeTeamId: string;
  awayTeamId: string;
}

const SubRow: React.FC<{ player: LivePlayer; onPress?: () => void }> = ({ player, onPress }) => {
  const [imgError, setImgError] = useState(false);
  const photoUrl = player.sofascoreId ? { uri: `https://api.sofascore.app/api/v1/player/${player.sofascoreId}/image` } : null;
  const rating = player.impactRating;
  const ratingColor = getRatingColor(rating);

  return (
    <TouchableOpacity style={styles.subRow} activeOpacity={0.7} onPress={onPress}>
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
            {player.position} · Substitute
            {player.goals > 0 ? ` · ⚽ ${player.goals}` : ""}
            {player.yellowCards > 0 ? " · 🟨" : ""}
            {player.redCards > 0 ? " · 🟥" : ""}
          </Text>
        </View>
      </View>

      {rating !== null && (
        <View style={[styles.ratingChip, { backgroundColor: ratingColor }]}>
          <Text style={styles.ratingText}>{rating.toFixed(1)}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

export const SubstitutesList: React.FC<SubstitutesListProps> = ({
  homeSubs,
  awaySubs,
  homeTeamName,
  awayTeamName,
  onPlayerPress,
  initialTeamId,
  homeTeamId,
  awayTeamId,
}) => {
  const [activeTeamId, setActiveTeamId] = useState<string>(initialTeamId || homeTeamId);
  const selectedSubs = activeTeamId === homeTeamId ? homeSubs : awaySubs;
  const selectedTeamName = activeTeamId === homeTeamId ? homeTeamName : awayTeamName;

  return (
    <View style={styles.container}>
      {/* Team Switcher */}
      <View style={styles.switcherContainer}>
        <TouchableOpacity
          style={[styles.switcherButton, activeTeamId === homeTeamId && styles.switcherActive]}
          onPress={() => setActiveTeamId(homeTeamId)}
          activeOpacity={0.7}
        >
          <Text style={[styles.switcherText, activeTeamId === homeTeamId && styles.switcherTextActive]}>
            {homeTeamName}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.switcherButton, activeTeamId === awayTeamId && styles.switcherActive]}
          onPress={() => setActiveTeamId(awayTeamId)}
          activeOpacity={0.7}
        >
          <Text style={[styles.switcherText, activeTeamId === awayTeamId && styles.switcherTextActive]}>
            {awayTeamName}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.teamSection}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{selectedTeamName.toUpperCase()} SUBSTITUTES ({selectedSubs.length})</Text>
        </View>
        {selectedSubs.length > 0 ? (
          selectedSubs.map((player) => (
            <SubRow
              key={player.id}
              player={player}
              onPress={() => onPlayerPress?.(player)}
            />
          ))
        ) : (
          <Text style={styles.emptyText}>No substitute data recorded for this team.</Text>
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
  switcherContainer: {
    flexDirection: "row",
    backgroundColor: COLORS.cardHover,
    borderRadius: 12,
    padding: 3,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  switcherButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 9,
  },
  switcherActive: {
    backgroundColor: COLORS.primary,
  },
  switcherText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.textSecondary,
  },
  switcherTextActive: {
    color: COLORS.surface,
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
    fontSize: 10,
    fontWeight: "900",
    color: COLORS.textPrimary,
    letterSpacing: 0.8,
  },
  subRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
  },
  playerInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  avatarMini: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.cardHover,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: "hidden",
  },
  avatarImg: {
    width: 32,
    height: 32,
  },
  avatarInitials: {
    fontSize: 10,
    fontWeight: "800",
    color: COLORS.textSecondary,
  },
  textCol: {
    flex: 1,
  },
  playerName: {
    fontSize: 12,
    fontWeight: "750",
    color: COLORS.textPrimary,
  },
  playerMeta: {
    fontSize: 10,
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
    color: COLORS.surface,
    fontSize: 11,
    fontWeight: "900",
  },
  emptyText: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontStyle: "italic",
    paddingVertical: 12,
    textAlign: "center",
  },
});
