import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, SafeAreaView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LivePlayer, RootStackParamList } from "../types/match";
import { COLORS, getRatingColor } from "../theme/colors";
import { PlayerProfileModal } from "../components/PlayerProfileModal";
import { StackNavigationProp } from "@react-navigation/stack";

interface MyTeamScreenProps {
  navigation: StackNavigationProp<RootStackParamList, "MyTeam">;
}

export const MyTeamScreen: React.FC<MyTeamScreenProps> = ({ navigation }) => {
  const [activePlayer, setActivePlayer] = useState<LivePlayer | null>(null);

  const teamName = "Argentina";
  const isArg = true;

  // Static Seeded squad roster
  const squad: LivePlayer[] = [
    { id: "840811", name: "Messi, Lionel", position: "ATT", starter: true, teamId: "1489", participant: 1, impactRating: 8.8, goals: 2, assists: 1, yellowCards: 0, redCards: 0 },
    { id: "840800", name: "Fernandez, Enzo", position: "MID", starter: true, teamId: "1489", participant: 1, impactRating: 7.2, goals: 0, assists: 1, yellowCards: 1, redCards: 0 },
    { id: "840809", name: "Martinez, Lisandro", position: "DEF", starter: true, teamId: "1489", participant: 1, impactRating: 7.8, goals: 0, assists: 0, yellowCards: 0, redCards: 0 },
    { id: "840807", name: "Martinez, Damian Emiliano", position: "GK", starter: true, teamId: "1489", participant: 1, impactRating: 6.4, goals: 0, assists: 0, yellowCards: 0, redCards: 0 },
    { id: "840782", name: "Alvarez, Julian", position: "ATT", starter: true, teamId: "1489", participant: 1, impactRating: 7.9, goals: 1, assists: 0, yellowCards: 0, redCards: 0 },
    { id: "840806", name: "Mac Allister, Alexis", position: "MID", starter: true, teamId: "1489", participant: 1, impactRating: 7.4, goals: 0, assists: 1, yellowCards: 0, redCards: 0 }
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.flagAvatar}>
            <Text style={styles.flagText}>🇦🇷</Text>
          </View>
          <View>
            <Text style={styles.eyebrow}>MY TEAM JOURNEY</Text>
            <Text style={styles.teamTitle}>{teamName}</Text>
            <Text style={styles.statusSub}>Tournament status · <Text style={{ fontWeight: "700" }}>Finals</Text></Text>
          </View>
        </View>

        {/* Journey stats box */}
        <View style={styles.journeyCard}>
          <Text style={styles.cardTitle}>Your Supporter Stats</Text>
          <View style={styles.metricsContainer}>
            <View style={styles.metricBox}>
              <Text style={styles.metricValue}>#1,284</Text>
              <Text style={styles.metricLabel}>Rank</Text>
            </View>
            <View style={styles.metricBox}>
              <Text style={styles.metricValue}>518.2</Text>
              <Text style={styles.metricLabel}>Total Score</Text>
            </View>
            <View style={styles.metricBox}>
              <Text style={styles.metricValue}>5/6</Text>
              <Text style={styles.metricLabel}>Matches</Text>
            </View>
          </View>
          <View style={styles.cardFooter}>
            <Text style={styles.footerText}>Average Match Index: <Text style={styles.boldText}>103.6</Text></Text>
            <Text style={[styles.footerText, { marginTop: 4 }]}>Best Performance: <Text style={styles.boldText}>vs England (105.1)</Text></Text>
          </View>
        </View>

        {/* Match Log */}
        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>Journey Matches</Text>
          <Text style={styles.sectionMuted}>All entries</Text>
        </View>

        <View style={styles.list}>
          <TouchableOpacity style={styles.pastMatch} activeOpacity={0.7} onPress={() => navigation.navigate("CompletedMatch", { fixtureId: "18241006", selectedTeamId: "1489", selectedPlayerIds: ["840811", "840800", "840809"] })}>
            <View style={styles.matchLeft}>
              <Text style={styles.flagIcon}>🏴󠁧󠁢󠁥󠁮󠁧󠁿</Text>
              <View>
                <Text style={styles.matchOpponent}>vs England</Text>
                <Text style={styles.matchMeta}>16 Jul · Grand Final</Text>
              </View>
            </View>
            <Text style={styles.matchResult}>Won 2–3 · 105.1 Index</Text>
          </TouchableOpacity>

          <View style={[styles.pastMatch, { opacity: 0.85 }]}>
            <View style={styles.matchLeft}>
              <Text style={styles.flagIcon}>🇪🇸</Text>
              <View>
                <Text style={styles.matchOpponent}>vs Spain</Text>
                <Text style={styles.matchMeta}>12 Jul · Semi-Final</Text>
              </View>
            </View>
            <Text style={styles.matchResult}>Won 1–0 · 102.8 Index</Text>
          </View>

          <View style={[styles.pastMatch, { opacity: 0.85 }]}>
            <View style={styles.matchLeft}>
              <Text style={styles.flagIcon}>🇳🇬</Text>
              <View>
                <Text style={styles.matchOpponent}>vs Nigeria</Text>
                <Text style={styles.matchMeta}>08 Jul · Quarter-Final</Text>
              </View>
            </View>
            <Text style={[styles.matchResult, { color: COLORS.textSecondary }]}>Drew 1–1 · 97.4 Index</Text>
          </View>
        </View>

        {/* Squad roster list */}
        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>Squad Roster</Text>
          <Text style={styles.sectionMuted}>Tap to view match history</Text>
        </View>

        <View style={styles.squadGrid}>
          {squad.map(p => (
            <TouchableOpacity
              key={p.id}
              style={styles.squadButton}
              activeOpacity={0.7}
              onPress={() => setActivePlayer(p)}
            >
              <View style={styles.avatarMini}>
                <Text style={styles.shirtText}>{p.number ?? "—"}</Text>
              </View>
              <View style={styles.squadInfo}>
                <Text style={styles.squadName} numberOfLines={1}>{p.name.split(",")[0]}</Text>
                <Text style={styles.squadMeta}>{p.position} · Starter</Text>
              </View>
              <Text style={[styles.squadRating, { color: getRatingColor(p.impactRating) }]}>
                {p.impactRating !== null ? p.impactRating.toFixed(1) : "—"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Player Profile Modal */}
      <PlayerProfileModal
        player={activePlayer}
        visible={activePlayer !== null}
        onClose={() => setActivePlayer(null)}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  flagAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#EDEDE7",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  flagText: {
    fontSize: 24,
  },
  eyebrow: {
    fontSize: 8,
    fontWeight: "900",
    color: COLORS.textSecondary,
    letterSpacing: 0.8,
  },
  teamTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  statusSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  journeyCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 18,
    padding: 16,
    margin: 16,
  },
  cardTitle: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
    color: COLORS.textSecondary,
    marginBottom: 12,
    textTransform: "uppercase",
  },
  metricsContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  metricBox: {
    flex: 1,
  },
  metricValue: {
    fontSize: 18,
    fontWeight: "900",
    color: COLORS.primary,
  },
  metricLabel: {
    fontSize: 8,
    color: COLORS.textSecondary,
    marginTop: 2,
    textTransform: "uppercase",
  },
  cardFooter: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 12,
  },
  footerText: {
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  boldText: {
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  sectionHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingHorizontal: 18,
    marginTop: 12,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  sectionMuted: {
    fontSize: 10,
    color: COLORS.textSecondary,
  },
  list: {
    paddingHorizontal: 16,
    gap: 8,
  },
  pastMatch: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
  },
  matchLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  flagIcon: {
    fontSize: 22,
    marginRight: 10,
  },
  matchOpponent: {
    fontSize: 12,
    fontWeight: "750",
    color: COLORS.textPrimary,
  },
  matchMeta: {
    fontSize: 9,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  matchResult: {
    fontSize: 11,
    fontWeight: "750",
    color: COLORS.successGreen,
  },
  squadGrid: {
    paddingHorizontal: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 8,
  },
  squadButton: {
    width: "48%",
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  avatarMini: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.cardHover,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  shirtText: {
    fontSize: 10,
    fontWeight: "900",
    color: COLORS.textSecondary,
  },
  squadInfo: {
    flex: 1,
    minWidth: 0,
  },
  squadName: {
    fontSize: 11,
    fontWeight: "750",
    color: COLORS.textPrimary,
  },
  squadMeta: {
    fontSize: 8,
    color: COLORS.textSecondary,
    marginTop: 1,
  },
  squadRating: {
    fontSize: 11,
    fontWeight: "800",
    marginLeft: 4,
  },
});
