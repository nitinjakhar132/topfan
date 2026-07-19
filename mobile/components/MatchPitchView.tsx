import React, { useState } from "react";
import { View, Text, StyleSheet, Image, ScrollView, TouchableOpacity } from "react-native";
import { LivePlayer, PositionKey } from "../types/match";
import { COLORS, getRatingColor } from "../theme/colors";

interface MatchPitchViewProps {
  homePlayers: LivePlayer[];
  awayPlayers: LivePlayer[];
  homeTeamName: string;
  awayTeamName: string;
  selectedPlayerIds: Set<string>;
  oppositionBestIds: Set<string>;
  homeTeamId: string;
  awayTeamId: string;
  initialTeamId?: string;
  onPlayerPress?: (player: LivePlayer) => void;
}

function getPlayerPhotoUrl(player: LivePlayer): { uri: string } | null {
  if (player.sofascoreId) {
    return { uri: `https://api.sofascore.app/api/v1/player/${player.sofascoreId}/image` };
  }
  return null;
}

const PitchPlayerNode: React.FC<{
  player: LivePlayer;
  isUserPick: boolean;
  isOppBest: boolean;
  onPress?: () => void;
}> = ({ player, isUserPick, isOppBest, onPress }) => {
  const [imgError, setImgError] = useState(false);
  const photoUrl = getPlayerPhotoUrl(player);
  const rating = player.impactRating;
  const ratingColor = getRatingColor(rating);

  return (
    <TouchableOpacity style={[styles.playerNode, isUserPick && styles.playerNodeUser]} activeOpacity={0.7} onPress={onPress}>
      {/* Pick Tag if User or Opposition Best */}
      {isUserPick && (
        <View style={styles.pickTagUser}>
          <Text style={styles.pickTagTextUser}>★ YOUR PICK</Text>
        </View>
      )}
      {isOppBest && !isUserPick && (
        <View style={styles.pickTagOpp}>
          <Text style={styles.pickTagTextOpp}>⚔ OPP BEST</Text>
        </View>
      )}

      {/* Avatar Circle */}
      <View
        style={[
          styles.avatarCircle,
          isUserPick && styles.avatarCircleUser,
          isOppBest && !isUserPick && styles.avatarCircleOpp,
        ]}
      >
        {!imgError && photoUrl ? (
          <Image source={photoUrl} style={styles.avatarImage} onError={() => setImgError(true)} />
        ) : (
          <View style={styles.fallbackAvatar}>
            <Text style={styles.fallbackText}>{player.name.slice(0, 2).toUpperCase()}</Text>
          </View>
        )}

        {/* Rating Pill */}
        {rating !== null && (
          <View style={[styles.ratingPill, { backgroundColor: ratingColor }]}>
            <Text style={styles.ratingText}>{rating.toFixed(1)}</Text>
          </View>
        )}
      </View>

      {/* Events Row */}
      <View style={styles.eventsRow}>
        {player.goals > 0 && <Text style={styles.eventIcon}>⚽ {player.goals > 1 ? player.goals : ""}</Text>}
        {player.yellowCards > 0 && <Text style={styles.eventIcon}>🟨</Text>}
        {player.redCards > 0 && <Text style={styles.eventIcon}>🟥</Text>}
      </View>

      {/* Name and Number */}
      <View style={[styles.namePill, isUserPick && styles.namePillUser]}>
        <Text style={[styles.nameText, isUserPick && styles.nameTextUser]} numberOfLines={1}>
          {player.shirtNumber || player.number ? `${player.shirtNumber || player.number} ` : ""}
          {player.name.split(" ").slice(-1)[0]}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

export const MatchPitchView: React.FC<MatchPitchViewProps> = ({
  homePlayers,
  awayPlayers,
  homeTeamName,
  awayTeamName,
  selectedPlayerIds,
  oppositionBestIds,
  homeTeamId,
  awayTeamId,
  initialTeamId,
  onPlayerPress,
}) => {
  const [activeTeamId, setActiveTeamId] = useState<string>(initialTeamId || homeTeamId);

  const selectedTeamName = activeTeamId === homeTeamId ? homeTeamName : awayTeamName;
  const starters = activeTeamId === homeTeamId 
    ? homePlayers.filter(p => p.starter) 
    : awayPlayers.filter(p => p.starter);

  const posOrder: PositionKey[] = ["GK", "DEF", "MID", "ATT"];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
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

      {/* Pitch Surface */}
      <View style={styles.pitchOuter}>
        <View style={styles.teamBar}>
          <Text style={styles.teamBarText}>{selectedTeamName.toUpperCase()} FORMATION</Text>
        </View>

        <View style={styles.pitchField}>
          <View style={styles.pitchHalf}>
            {posOrder.map((pos) => {
              const row = starters.filter((p) => p.position === pos);
              if (!row.length) return null;
              return (
                <View style={styles.pitchRow} key={`${activeTeamId}-${pos}`}>
                  {row.map((player) => (
                    <PitchPlayerNode
                      key={player.id}
                      player={player}
                      isUserPick={selectedPlayerIds.has(player.id)}
                      isOppBest={oppositionBestIds.has(player.id)}
                      onPress={() => onPlayerPress?.(player)}
                    />
                  ))}
                </View>
              );
            })}
          </View>
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
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
  pitchOuter: {
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: "#11221A", // Subtle pitch green-black
  },
  teamBar: {
    backgroundColor: COLORS.surface,
    paddingVertical: 10,
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  teamBarText: {
    fontSize: 10,
    fontWeight: "900",
    color: COLORS.textPrimary,
    letterSpacing: 0.8,
  },
  pitchField: {
    paddingVertical: 16,
    minHeight: 380,
    justifyContent: "space-between",
  },
  pitchHalf: {
    flex: 1,
    justifyContent: "space-around",
    paddingVertical: 10,
  },
  pitchRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    marginVertical: 12,
  },
  playerNode: {
    alignItems: "center",
    width: 74,
    marginHorizontal: 2,
  },
  playerNodeUser: {
    transform: [{ scale: 1.05 }],
  },
  pickTagUser: {
    backgroundColor: COLORS.successGreen,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginBottom: 4,
  },
  pickTagTextUser: {
    color: COLORS.surface,
    fontSize: 7,
    fontWeight: "900",
  },
  pickTagOpp: {
    backgroundColor: COLORS.secondary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginBottom: 4,
  },
  pickTagTextOpp: {
    color: COLORS.surface,
    fontSize: 7,
    fontWeight: "900",
  },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 2,
    borderColor: COLORS.border,
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },
  avatarCircleUser: {
    borderColor: COLORS.successGreen,
    borderWidth: 2.5,
  },
  avatarCircleOpp: {
    borderColor: COLORS.secondary,
    borderWidth: 2.5,
  },
  avatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  fallbackAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.cardHover,
    justifyContent: "center",
    alignItems: "center",
  },
  fallbackText: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: "800",
  },
  ratingPill: {
    position: "absolute",
    bottom: -6,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  ratingText: {
    fontSize: 9,
    fontWeight: "900",
    color: COLORS.textPrimary,
  },
  eventsRow: {
    flexDirection: "row",
    marginTop: 6,
    minHeight: 14,
  },
  eventIcon: {
    fontSize: 10,
    marginHorizontal: 1,
  },
  namePill: {
    marginTop: 2,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    maxWidth: 72,
  },
  namePillUser: {
    backgroundColor: COLORS.primaryMuted,
  },
  nameText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#FFFFFF",
    textAlign: "center",
  },
  nameTextUser: {
    color: COLORS.primary,
    fontWeight: "900",
  },
});
