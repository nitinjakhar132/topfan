import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image } from "react-native";
import { LivePlayer, Position } from "../types/match";
import { COLORS } from "../theme/colors";

interface TrioSelectionSlotsProps {
  selected: Partial<Record<Position, LivePlayer>>;
  activePosition: Position;
  onSelectSlot: (pos: Position) => void;
  getPlayerImageSrc?: (player: LivePlayer) => any;
}

export const TrioSelectionSlots: React.FC<TrioSelectionSlotsProps> = ({
  selected,
  activePosition,
  onSelectSlot,
  getPlayerImageSrc
}) => {
  const chosenCount = [selected.ATT, selected.MID, selected.DEF].filter(Boolean).length;
  const progressPercent = (chosenCount / 3) * 100;

  const renderSlot = (pos: Position, label: string, icon: string) => {
    const player = selected[pos];
    const isActive = activePosition === pos;
    const isFilled = !!player;

    return (
      <TouchableOpacity
        style={[
          styles.slotCard,
          isActive && !isFilled && styles.activeEmptySlot,
          isFilled && styles.filledSlot
        ]}
        onPress={() => onSelectSlot(pos)}
        activeOpacity={0.7}
      >
        {isFilled ? (
          <>
            {getPlayerImageSrc ? (
              <Image source={getPlayerImageSrc(player)} style={styles.slotPhoto} />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Text style={styles.photoPlaceholderText}>{player.name[0]}</Text>
              </View>
            )}
            <Text style={styles.slotLabel}>{label}</Text>
            <Text style={styles.slotPlayerName} numberOfLines={1}>
              {player.name}
            </Text>
          </>
        ) : (
          <>
            <View style={styles.slotIconWrapper}>
              <Text style={styles.slotIconText}>{icon}</Text>
            </View>
            <Text style={styles.slotLabel}>{label}</Text>
            <Text style={styles.slotChooseText}>Choose</Text>
          </>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>YOUR MATCHDAY THREE</Text>
      <View style={styles.slotsRow}>
        {renderSlot("ATT", "ATTACKER", "⚡")}
        {renderSlot("MID", "MIDFIELDER", "⚙️")}
        {renderSlot("DEF", "DEFENDER", "🛡️")}
      </View>

      <View style={styles.progressRow}>
        <Text style={styles.progressText}>{chosenCount} of 3 selected</Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${progressPercent}%` }]} />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line || "#e2e8f0",
    backgroundColor: COLORS.paper || "#ffffff"
  },
  title: {
    fontSize: 11,
    fontWeight: "900",
    color: COLORS.muted || "#64748b",
    letterSpacing: 0.8,
    marginBottom: 12
  },
  slotsRow: {
    flexDirection: "row",
    justifyContent: "space-between"
  },
  slotCard: {
    width: "31%",
    backgroundColor: COLORS.paper || "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.line || "#e2e8f0",
    borderStyle: "dashed",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: "center"
  },
  activeEmptySlot: {
    borderColor: COLORS.green || "#2d653d",
    borderStyle: "solid",
    backgroundColor: "rgba(45, 101, 61, 0.02)"
  },
  filledSlot: {
    borderColor: COLORS.green || "#2d653d",
    borderStyle: "solid",
    backgroundColor: "rgba(45, 101, 61, 0.04)"
  },
  slotIconWrapper: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.cardHover || "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6
  },
  slotIconText: {
    fontSize: 12
  },
  slotPhoto: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginBottom: 6
  },
  photoPlaceholder: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.cardHover || "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6
  },
  photoPlaceholderText: {
    fontSize: 10,
    fontWeight: "800",
    color: COLORS.muted || "#64748b"
  },
  slotLabel: {
    fontSize: 9,
    fontWeight: "900",
    color: COLORS.muted || "#64748b"
  },
  slotPlayerName: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.ink || "#0f172a",
    marginTop: 2,
    textAlign: "center"
  },
  slotChooseText: {
    fontSize: 11,
    fontStyle: "italic",
    color: COLORS.muted || "#64748b",
    marginTop: 2
  },
  progressRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 14
  },
  progressText: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.muted || "#64748b"
  },
  track: {
    flex: 1,
    height: 4,
    backgroundColor: COLORS.cardHover || "#f1f5f9",
    borderRadius: 2,
    marginLeft: 10,
    overflow: "hidden"
  },
  fill: {
    height: "100%",
    backgroundColor: COLORS.green || "#2d653d",
    borderRadius: 2
  }
});
