import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList, TeamJourneyCard } from "../types/match";
import { COLORS } from "../theme/colors";

interface MyTeamsScreenProps {
  navigation: StackNavigationProp<RootStackParamList, "MyTeams">;
  wallet?: string;
}

export const MyTeamsScreen: React.FC<MyTeamsScreenProps> = ({
  navigation,
  wallet = "devnet-demo-wallet",
}) => {
  const [journeys, setJourneys] = useState<(TeamJourneyCard & { currentStage: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchJourneys = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      try {
        const response = await fetch(
          `http://localhost:3000/api/journey/${wallet}`,
        );
        const data = await response.json();
        setJourneys(data.journeys ?? []);
      } catch (e) {
        console.error("[MyTeams] Error fetching journeys:", e);
        // Fallback seeded data for offline development
        setJourneys([
          {
            teamId: "1489",
            teamName: "Argentina",
            teamCode: "ARG",
            flag: "🇦🇷",
            status: "active",
            currentStage: "Final",
            matchesFollowed: 5,
            eligibleMatches: 6,
            totalJourneyScore: 518.7,
            averageMatchIndex: 103.7,
            currentTeamRank: 112,
            percentile: 98.6,
            topFanEligible: true,
          },
          {
            teamId: "1490",
            teamName: "Spain",
            teamCode: "ESP",
            flag: "🇪🇸",
            status: "eliminated",
            currentStage: "Quarter-final",
            matchesFollowed: 2,
            eligibleMatches: 5,
            totalJourneyScore: 197.3,
            averageMatchIndex: 98.7,
            currentTeamRank: 2841,
            percentile: 71.2,
            topFanEligible: false,
          },
        ]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [wallet],
  );

  useEffect(() => {
    fetchJourneys();
  }, [fetchJourneys]);

  const activeJourneys = journeys.filter((j) => j.status === "active");
  const completedJourneys = journeys.filter(
    (j) => j.status === "eliminated" || j.status === "completed",
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading your team journeys…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchJourneys(true)}
            tintColor={COLORS.primary}
          />
        }
      >
        {/* Page Title */}
        <View style={styles.titleRow}>
          <Text style={styles.pageTitle}>MY TEAMS</Text>
          <Text style={styles.pageSubtitle}>
            {journeys.length} journey{journeys.length !== 1 ? "s" : ""}
          </Text>
        </View>

        {/* Empty state */}
        {journeys.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>🏟️</Text>
            <Text style={styles.emptyTitle}>No journeys started</Text>
            <Text style={styles.emptySubtitle}>
              Choose a team in your next match to begin your supporter journey.
            </Text>
          </View>
        )}

        {/* Active Journeys */}
        {activeJourneys.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>ACTIVE JOURNEYS</Text>
            {activeJourneys.map((j) => (
              <TouchableOpacity
                key={j.teamId}
                style={styles.journeyCard}
                activeOpacity={0.7}
                onPress={() =>
                  navigation.navigate("TeamJourney", {
                    teamId: j.teamId,
                    wallet,
                  })
                }
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.flagEmoji}>{j.flag}</Text>
                  <View style={styles.cardHeaderInfo}>
                    <Text style={styles.teamName}>{j.teamName}</Text>
                    <Text style={styles.stagePill}>{j.currentStage}</Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </View>

                <View style={styles.metricsRow}>
                  <View style={styles.metricBox}>
                    <Text style={styles.metricValue}>
                      {j.matchesFollowed} of {j.eligibleMatches}
                    </Text>
                    <Text style={styles.metricLabel}>Matches followed</Text>
                  </View>
                  <View style={styles.metricBox}>
                    <Text style={styles.metricValue}>
                      #{j.currentTeamRank?.toLocaleString() ?? "—"}
                    </Text>
                    <Text style={styles.metricLabel}>Team rank</Text>
                  </View>
                  <View style={styles.metricBox}>
                    <Text style={styles.metricValue}>
                      {j.totalJourneyScore.toFixed(1)}
                    </Text>
                    <Text style={styles.metricLabel}>Journey score</Text>
                  </View>
                </View>

                <View style={styles.eligibilityRow}>
                  <Text style={styles.eligibilityLabel}>Top-fan eligibility:</Text>
                  <Text
                    style={[
                      styles.eligibilityValue,
                      j.topFanEligible
                        ? styles.eligibilityActive
                        : styles.eligibilityInactive,
                    ]}
                  >
                    {j.topFanEligible ? "Active ✓" : "Not yet eligible"}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}

        {/* Completed / Eliminated Journeys */}
        {completedJourneys.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 16 }]}>
              COMPLETED JOURNEYS
            </Text>
            {completedJourneys.map((j) => (
              <TouchableOpacity
                key={j.teamId}
                style={[styles.journeyCard, styles.completedCard]}
                activeOpacity={0.7}
                onPress={() =>
                  navigation.navigate("TeamJourney", {
                    teamId: j.teamId,
                    wallet,
                  })
                }
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.flagEmoji}>{j.flag}</Text>
                  <View style={styles.cardHeaderInfo}>
                    <Text style={styles.teamName}>{j.teamName}</Text>
                    <View style={styles.stageRowInline}>
                      <Text style={styles.stagePill}>{j.currentStage}</Text>
                      <Text style={styles.eliminatedBadge}>
                        {j.status === "eliminated" ? "Eliminated" : "Completed"}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </View>

                <View style={styles.metricsRow}>
                  <View style={styles.metricBox}>
                    <Text style={styles.metricValue}>
                      {j.matchesFollowed} of {j.eligibleMatches}
                    </Text>
                    <Text style={styles.metricLabel}>Matches followed</Text>
                  </View>
                  <View style={styles.metricBox}>
                    <Text style={styles.metricValue}>
                      #{j.currentTeamRank?.toLocaleString() ?? "—"}
                    </Text>
                    <Text style={styles.metricLabel}>Final rank</Text>
                  </View>
                  <View style={styles.metricBox}>
                    <Text style={styles.metricValue}>
                      {j.totalJourneyScore.toFixed(1)}
                    </Text>
                    <Text style={styles.metricLabel}>Journey score</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  centerBox: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  scrollContent: {
    paddingBottom: 40,
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 16,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: "900",
    color: COLORS.textPrimary,
    letterSpacing: -0.5,
  },
  pageSubtitle: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: "600",
  },
  sectionLabel: {
    fontSize: 9,
    fontWeight: "900",
    color: COLORS.textSecondary,
    letterSpacing: 0.8,
    paddingHorizontal: 18,
    marginBottom: 8,
  },
  emptyCard: {
    margin: 18,
    padding: 32,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 18,
    alignItems: "center",
  },
  emptyIcon: {
    fontSize: 36,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: 18,
  },
  journeyCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 18,
    padding: 16,
  },
  completedCard: {
    opacity: 0.75,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  flagEmoji: {
    fontSize: 28,
    marginRight: 12,
  },
  cardHeaderInfo: {
    flex: 1,
  },
  teamName: {
    fontSize: 18,
    fontWeight: "900",
    color: COLORS.textPrimary,
  },
  stageRowInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  stagePill: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  eliminatedBadge: {
    fontSize: 9,
    fontWeight: "800",
    color: "#b91c1c",
    backgroundColor: "rgba(185, 28, 28, 0.08)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: "hidden",
  },
  chevron: {
    fontSize: 24,
    color: COLORS.textMuted,
    fontWeight: "300",
  },
  metricsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  metricBox: {
    flex: 1,
  },
  metricValue: {
    fontSize: 14,
    fontWeight: "900",
    color: COLORS.primary,
  },
  metricLabel: {
    fontSize: 8,
    fontWeight: "600",
    color: COLORS.textSecondary,
    marginTop: 2,
    textTransform: "uppercase",
  },
  eligibilityRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 10,
  },
  eligibilityLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.textSecondary,
  },
  eligibilityValue: {
    fontSize: 10,
    fontWeight: "800",
  },
  eligibilityActive: {
    color: COLORS.successGreen,
  },
  eligibilityInactive: {
    color: COLORS.textMuted,
  },
});
