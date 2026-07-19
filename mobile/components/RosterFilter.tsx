import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Position } from "../types/match";
import { COLORS } from "../theme/colors";

interface RosterFilterProps {
  activePosition: Position;
  onChangePosition: (pos: Position) => void;
  playerFilter: "all" | "starters" | "substitutes";
  onChangeFilter: (filter: "all" | "starters" | "substitutes") => void;
  onViewLineupPress?: () => void;
}

export const RosterFilter: React.FC<RosterFilterProps> = ({
  activePosition,
  onChangePosition,
  playerFilter,
  onChangeFilter,
  onViewLineupPress
}) => {
  return (
    <View style={styles.container}>
      <View style={styles.positionNav}>
        <TouchableOpacity
          style={[styles.navBtn, activePosition === "ATT" && styles.activeNavBtn]}
          onPress={() => onChangePosition("ATT")}
          activeOpacity={0.7}
        >
          <Text style={[styles.navBtnText, activePosition === "ATT" && styles.activeNavBtnText]}>
            Attacker
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.navBtn, activePosition === "MID" && styles.activeNavBtn]}
          onPress={() => onChangePosition("MID")}
          activeOpacity={0.7}
        >
          <Text style={[styles.navBtnText, activePosition === "MID" && styles.activeNavBtnText]}>
            Midfielder
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.navBtn, activePosition === "DEF" && styles.activeNavBtn]}
          onPress={() => onChangePosition("DEF")}
          activeOpacity={0.7}
        >
          <Text style={[styles.navBtnText, activePosition === "DEF" && styles.activeNavBtnText]}>
            Defender
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.secondaryFilterRow}>
        <View style={styles.filtersLeft}>
          <TouchableOpacity
            style={[styles.secFilterBtn, playerFilter === "all" && styles.activeSecFilterBtn]}
            onPress={() => onChangeFilter("all")}
          >
            <Text style={[styles.secFilterText, playerFilter === "all" && styles.activeSecFilterText]}>
              All players
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.secFilterBtn, playerFilter === "starters" && styles.activeSecFilterBtn]}
            onPress={() => onChangeFilter("starters")}
          >
            <Text style={[styles.secFilterText, playerFilter === "starters" && styles.activeSecFilterText]}>
              Starters
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.secFilterBtn, playerFilter === "substitutes" && styles.activeSecFilterBtn]}
            onPress={() => onChangeFilter("substitutes")}
          >
            <Text style={[styles.secFilterText, playerFilter === "substitutes" && styles.activeSecFilterText]}>
              Substitutes
            </Text>
          </TouchableOpacity>
        </View>

        {onViewLineupPress && (
          <TouchableOpacity onPress={onViewLineupPress}>
            <Text style={styles.viewLineupLink}>Lineup view →</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    background: COLORS.paper || "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line || "#e2e8f0",
    padding: 12
  },
  positionNav: {
    flexDirection: "row",
    backgroundColor: COLORS.cardHover || "#f1f5f9",
    borderRadius: 8,
    padding: 3
  },
  navBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 6
  },
  activeNavBtn: {
    backgroundColor: COLORS.green || "#2d653d"
  },
  navBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.muted || "#64748b"
  },
  activeNavBtnText: {
    color: "#ffffff"
  },
  secondaryFilterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 10
  },
  filtersLeft: {
    flexDirection: "row",
    gap: 12
  },
  secFilterBtn: {
    paddingVertical: 2,
    paddingHorizontal: 4
  },
  activeSecFilterBtn: {
    borderBottomWidth: 2,
    borderBottomColor: COLORS.green || "#2d653d"
  },
  secFilterText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.muted || "#64748b"
  },
  activeSecFilterText: {
    color: COLORS.green || "#2d653d"
  },
  viewLineupLink: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.green || "#2d653d",
    textDecorationLine: "underline"
  }
});
