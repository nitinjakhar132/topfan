import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image } from "react-native";
import { PlayerRepositoryListItem } from "../lib/player-repository/types";
import { PlayerTraitChip } from "./PlayerTraitChip";
import { FormHistory } from "./FormHistory";
import { COLORS } from "../theme/colors";

interface SelectablePlayerCardProps {
  item: PlayerRepositoryListItem;
  isSelected: boolean;
  onSelect: (item: PlayerRepositoryListItem) => void;
  onOpenPreview: (playerId: string) => void;
  getPlayerImageSrc?: (id: string) => any;
  recommendationReason?: string;
}

export const SelectablePlayerCard: React.FC<SelectablePlayerCardProps> = ({
  item,
  isSelected,
  onSelect,
  onOpenPreview,
  getPlayerImageSrc,
  recommendationReason,
}) => {
  const { player, tournament, traits, matchdayStatus } = item;

  const isStarter = matchdayStatus?.starter ?? false;
  const isSub = matchdayStatus?.officialSubstitute ?? false;
  
  // Three different states based on data presence
  const hasHistory = tournament.appearances > 0;
  const isNew = tournament.appearances === 0;

  // Rating Display formatting
  let ratingText = "—";
  if (isNew) {
    ratingText = "NEW";
  } else if (tournament.tournamentRating !== null && tournament.tournamentRating !== undefined) {
    ratingText = tournament.tournamentRating.toFixed(2);
  }

  // Position-specific key stats text
  const statsLine = tournament.keyStats.length > 0
    ? tournament.keyStats.map(s => `${s.value} ${s.label.toLowerCase()}`).join(" · ")
    : "";

  return (
    <TouchableOpacity
      style={[styles.card, isSelected && styles.selectedCard]}
      onPress={() => onOpenPreview(player.id)}
      activeOpacity={0.9}
    >
      {/* Left Col: Photo */}
      <View style={styles.photoContainer}>
        {getPlayerImageSrc ? (
          <Image source={getPlayerImageSrc(player.id)} style={styles.photo} />
        ) : (
          <View style={styles.photoPlaceholder}>
            <Text style={styles.photoPlaceholderText}>{player.displayName[0]}</Text>
          </View>
        )}
      </View>

      {/* Middle Col: Player Info */}
      <View style={styles.middleCol}>
        {recommendationReason ? (
          <View style={styles.recommendationBadge}>
            <Text style={styles.recommendationBadgeText}>{recommendationReason.toUpperCase()}</Text>
          </View>
        ) : null}
        <Text style={styles.name} numberOfLines={1}>{player.displayName}</Text>
        <Text style={styles.metaText}>
          {isStarter ? "STARTER" : "SUBSTITUTE"} · {player.position} · No. {matchdayStatus?.shirtNumber ?? "—"}
        </Text>

        {isNew ? (
          <View style={styles.detailRows}>
            <Text style={styles.infoText}>No completed World Cup appearance</Text>
            <Text style={styles.infoText}>Official substitute for this match</Text>
          </View>
        ) : !isStarter && isSub ? (
          <View style={styles.detailRows}>
            <Text style={styles.infoText}>
              Entered {tournament.appearances} of {tournament.appearances + 2} matches · Avg {Math.round(tournament.totalMinutes / Math.max(1, tournament.appearances))}'
            </Text>
            {statsLine ? <Text style={styles.infoText}>{statsLine}</Text> : null}
            {traits.length > 0 ? (
              <View style={styles.traitsRow}>
                {traits.slice(0, 1).map((t, idx) => (
                  <View key={idx} style={styles.traitChip}>
                    <Text style={styles.traitText}>{t.label.toUpperCase()}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.detailRows}>
            {tournament.recentRatings && tournament.recentRatings.length > 0 ? (
              <View style={styles.formStrip}>
                <Text style={styles.formLabel}>Form</Text>
                {tournament.recentRatings.slice(-3).map((r: number, i: number) => (
                  <View key={i} style={styles.formPill}>
                    <Text style={styles.formPillText}>{r.toFixed(1)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            <Text style={styles.infoText}>
              {tournament.appearances} apps · {statsLine}
            </Text>
            {traits.length > 0 ? (
              <View style={styles.traitsRow}>
                {traits.slice(0, 2).map((t, idx) => (
                  <View key={idx} style={styles.traitChip}>
                    <Text style={styles.traitText}>{t.label.toUpperCase()}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        )}
      </View>

      {/* Right Col: Rating and Selection */}
      <View style={styles.rightCol}>
        <View style={styles.ratingBox}>
          <Text style={[styles.ratingVal, isNew && styles.ratingValNew]}>{ratingText}</Text>
          {!isNew && ratingText !== "—" ? <Text style={styles.ratingLbl}>RATING</Text> : null}
        </View>

        <TouchableOpacity
          style={[styles.selectBtn, isSelected && styles.selectedBtn]}
          onPress={() => onSelect(item)}
          activeOpacity={0.7}
        >
          <Text style={[styles.selectBtnText, isSelected && styles.selectedBtnText]}>
            {isSelected ? "Selected ✓" : "Select"}
          </Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.paper || "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.line || "#e2e8f0",
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    flexDirection: "row",
    height: 122,
    alignItems: "center",
  },
  selectedCard: {
    borderColor: COLORS.green || "#2d653d",
    backgroundColor: "rgba(45, 101, 61, 0.02)",
    borderWidth: 1.5,
  },
  photoContainer: {
    width: 46,
    height: 46,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "rgba(0, 0, 0, 0.03)",
    alignSelf: "flex-start",
    marginTop: 2,
  },
  photo: {
    width: "100%",
    height: "100%",
  },
  photoPlaceholder: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  photoPlaceholderText: {
    fontSize: 16,
    fontWeight: "bold",
    color: COLORS.muted || "#64748b",
  },
  middleCol: {
    flex: 1,
    marginLeft: 12,
    height: "100%",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  name: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.ink || "#0f172a",
  },
  metaText: {
    fontSize: 10,
    fontWeight: "600",
    color: COLORS.muted || "#64748b",
    marginTop: 1,
  },
  detailRows: {
    flex: 1,
    justifyContent: "center",
    marginTop: 4,
    gap: 3,
  },
  infoText: {
    fontSize: 11,
    color: COLORS.muted || "#64748b",
  },
  formStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 2,
  },
  formLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.muted || "#64748b",
    marginRight: 2,
  },
  formPill: {
    backgroundColor: "rgba(0,0,0,0.04)",
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  formPillText: {
    fontSize: 9,
    fontWeight: "750",
    color: COLORS.ink || "#0f172a",
  },
  traitsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 2,
  },
  traitChip: {
    backgroundColor: "rgba(45, 101, 61, 0.05)",
    borderWidth: 0.5,
    borderColor: "rgba(45, 101, 61, 0.15)",
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  traitText: {
    fontSize: 8,
    fontWeight: "800",
    color: COLORS.green || "#2d653d",
  },
  rightCol: {
    width: 76,
    height: "100%",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingVertical: 2,
  },
  ratingBox: {
    alignItems: "flex-end",
  },
  ratingVal: {
    fontSize: 18,
    fontWeight: "850",
    color: COLORS.green || "#2d653d",
  },
  ratingValNew: {
    fontSize: 13,
    fontWeight: "800",
    color: "#f59e0b",
  },
  ratingLbl: {
    fontSize: 7,
    fontWeight: "750",
    color: COLORS.muted || "#64748b",
    letterSpacing: 0.2,
  },
  selectBtn: {
    backgroundColor: COLORS.green || "#2d653d",
    borderRadius: 6,
    width: "100%",
    paddingVertical: 6,
    alignItems: "center",
  },
  selectBtnText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#ffffff",
  },
  selectedBtn: {
    backgroundColor: "rgba(45, 101, 61, 0.08)",
    borderWidth: 1,
    borderColor: COLORS.green || "#2d653d",
  },
  selectedBtnText: {
    color: COLORS.green || "#2d653d",
  },
  recommendationBadge: {
    backgroundColor: "rgba(45, 101, 61, 0.08)",
    borderRadius: 4,
    paddingVertical: 1,
    paddingHorizontal: 5,
    alignSelf: "flex-start",
    marginBottom: 2,
  },
  recommendationBadgeText: {
    fontSize: 8,
    fontWeight: "850",
    color: COLORS.green || "#2d653d",
  },
});
