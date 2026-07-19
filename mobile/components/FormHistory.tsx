import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { COLORS } from "../theme/colors";

interface FormHistoryProps {
  ratings: number[];
  formTrend?: "rising" | "stable" | "declining" | "insufficient_data";
}

export const FormHistory: React.FC<FormHistoryProps> = ({
  ratings,
  formTrend = "insufficient_data",
}) => {
  if (!ratings || ratings.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.fallback}>No form history</Text>
      </View>
    );
  }

  // Get up to 4 ratings
  const displayed = [...ratings].reverse().slice(0, 4).reverse();

  const trendText = {
    rising: "🔥 RISING",
    stable: "→ STABLE",
    declining: "↘ DECLINING",
    insufficient_data: "",
  }[formTrend];

  const trendStyle = {
    rising: styles.rising,
    stable: styles.stable,
    declining: styles.declining,
    insufficient_data: {},
  }[formTrend];

  return (
    <View style={styles.container}>
      <View style={styles.strip}>
        {displayed.map((rating, idx) => (
          <React.Fragment key={idx}>
            {idx > 0 && <Text style={styles.divider}>—</Text>}
            <View style={styles.pill}>
              <Text style={styles.ratingText}>{rating.toFixed(1)}</Text>
            </View>
          </React.Fragment>
        ))}
      </View>
      {trendText ? (
        <Text style={[styles.trend, trendStyle]}>{trendText}</Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  strip: {
    flexDirection: "row",
    alignItems: "center",
  },
  pill: {
    backgroundColor: "rgba(0, 0, 0, 0.04)",
    borderRadius: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  ratingText: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.ink || "#0f172a",
  },
  divider: {
    fontSize: 9,
    color: COLORS.muted || "#64748b",
    marginHorizontal: 4,
  },
  trend: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  rising: {
    color: "#b91c1c", // red
  },
  stable: {
    color: COLORS.muted || "#64748b",
  },
  declining: {
    color: "#475569",
  },
  fallback: {
    fontSize: 9,
    color: COLORS.muted || "#64748b",
    fontStyle: "italic",
  },
});
