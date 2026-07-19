import React from "react";
import { TouchableOpacity, Text, StyleSheet, Alert } from "react-native";
import { COLORS } from "../theme/colors";

interface PlayerTraitChipProps {
  traitKey: string;
  label: string;
  evidence?: Record<string, any>;
}

export const PlayerTraitChip: React.FC<PlayerTraitChipProps> = ({
  traitKey,
  label,
  evidence,
}) => {
  const showEvidence = () => {
    if (!evidence) return;
    let message = "";
    if (traitKey === "IN_FORM") {
      message = `Recent average rating: ${evidence.recentFormRating} over ${evidence.appearances} matches.`;
    } else if (traitKey === "NAILED_STARTER") {
      message = `Started ${evidence.starts} out of ${evidence.appearances} matches (${Math.round(evidence.startRate * 100)}%).`;
    } else if (traitKey === "SUPER_SUB") {
      message = `Scored ${evidence.substituteGoals} goals coming off the bench in ${evidence.substituteAppearances} appearances.`;
    } else if (traitKey === "GOAL_THREAT") {
      message = `Total goals: ${evidence.totalGoals} (${evidence.goalsPer90 ? `${evidence.goalsPer90} goals per 90` : "active goalscorer"}).`;
    } else {
      message = `Evidence details: ${JSON.stringify(evidence)}`;
    }

    Alert.alert(label, message, [{ text: "Got it" }]);
  };

  return (
    <TouchableOpacity
      style={styles.chip}
      onPress={showEvidence}
      activeOpacity={0.7}
    >
      <Text style={styles.text}>{label.toUpperCase()}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  chip: {
    backgroundColor: "rgba(45, 101, 61, 0.06)",
    borderColor: "rgba(45, 101, 61, 0.15)",
    borderWidth: 1,
    borderRadius: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
    marginRight: 4,
    marginBottom: 4,
  },
  text: {
    fontSize: 9,
    fontWeight: "700",
    color: COLORS.green || "#2d653d",
    letterSpacing: 0.5,
  },
});
