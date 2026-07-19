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
import { Ionicons } from "@expo/vector-icons";
import { StackNavigationProp } from "@react-navigation/stack";
import { RouteProp } from "@react-navigation/native";
import { RootStackParamList, TeamJourneyPageData } from "../types/match";
import { COLORS } from "../theme/colors";
import { JourneyTimeline } from "../components/JourneyTimeline";
import { TrustedPlayers } from "../components/TrustedPlayers";
import { JourneyLeaderboardPreview } from "../components/JourneyLeaderboardPreview";

interface TeamJourneyScreenProps {
  navigation: StackNavigationProp<RootStackParamList, "TeamJourney">;
  route: RouteProp<RootStackParamList, "TeamJourney">;
}

export const TeamJourneyScreen: React.FC<TeamJourneyScreenProps> = ({
  navigation,
  route,
}) => {
  const { teamId, wallet } = route.params;

  const [data, setData] = useState<TeamJourneyPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      try {
        const response = await fetch(
          `http://localhost:3000/api/journey/${wallet}/${teamId}`,
        );
        const result = await response.json();
        setData(result);
      } catch (e) {
        console.error("[TeamJourney] Error fetching data:", e);
        // Fallback seeded data for offline dev
        setData({
          journey: {
            teamId,
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
          timeline: [
            {
              fixtureId: "f1",
              stage: "Group Stage",
              opponent: "Uruguay",
              opponentFlag: "🇺🇾",
              matchResult: "Argentina 2–0 Uruguay",
              trioNames: ["Yamal", "Pedri", "Laporte"],
              finalMatchIndex: 103.4,
              rankBefore: 4921,
              rankAfter: 3108,
              status: "completed",
              startsAt: "2026-06-15T18:00:00Z",
            },
            {
              fixtureId: "f2",
              stage: "Round of 32",
              opponent: "Austria",
              opponentFlag: "🇦🇹",
              matchResult: "Argentina 3–0 Austria",
              trioNames: ["Yamal", "Rodri", "Cubarsí"],
              finalMatchIndex: 109.7,
              rankBefore: 3108,
              rankAfter: 1420,
              status: "completed",
              startsAt: "2026-06-20T20:00:00Z",
            },
            {
              fixtureId: "f3",
              stage: "Round of 16",
              opponent: "Portugal",
              opponentFlag: "🇵🇹",
              matchResult: "Argentina 1–0 Portugal",
              trioNames: ["Morata", "Pedri", "Laporte"],
              finalMatchIndex: 97.8,
              rankBefore: 1420,
              rankAfter: 1086,
              status: "completed",
              startsAt: "2026-06-28T18:00:00Z",
            },
            {
              fixtureId: "f4",
              stage: "Quarter-final",
              opponent: "Belgium",
              opponentFlag: "🇧🇪",
              matchResult: "Argentina 2–1 Belgium",
              trioNames: ["Yamal", "Olmo", "Cucurella"],
              finalMatchIndex: 106.2,
              rankBefore: 1086,
              rankAfter: 384,
              status: "completed",
              startsAt: "2026-07-04T18:00:00Z",
            },
            {
              fixtureId: "f5",
              stage: "Semi-final",
              opponent: "France",
              opponentFlag: "🇫🇷",
              matchResult: "Argentina 2–0 France",
              trioNames: ["Yamal", "Pedri", "Laporte"],
              finalMatchIndex: 105.1,
              rankBefore: 384,
              rankAfter: 112,
              status: "completed",
              startsAt: "2026-07-12T20:00:00Z",
            },
            {
              fixtureId: "f6",
              stage: "Final",
              opponent: "England",
              opponentFlag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
              matchResult: null,
              trioNames: null,
              finalMatchIndex: null,
              rankBefore: null,
              rankAfter: null,
              status: "upcoming",
              startsAt: "2026-07-19T18:00:00Z",
            },
          ],
          trustedPlayers: [
            {
              playerId: "p1",
              playerName: "Lamine Yamal",
              position: "ATT",
              timesSelected: 5,
              averageRatingWhenSelected: 7.82,
              supporterPointsGenerated: 231.4,
              bestFixtureId: "f4",
              bestFixtureOpponent: "Belgium",
            },
            {
              playerId: "p2",
              playerName: "Pedri",
              position: "MID",
              timesSelected: 4,
              averageRatingWhenSelected: 7.51,
              supporterPointsGenerated: 184.7,
              bestFixtureId: null,
              bestFixtureOpponent: null,
            },
            {
              playerId: "p3",
              playerName: "Laporte",
              position: "DEF",
              timesSelected: 3,
              averageRatingWhenSelected: 7.34,
              supporterPointsGenerated: 102.6,
              bestFixtureId: null,
              bestFixtureOpponent: null,
            },
          ],
          leaderboard: {
            top: [
              { rank: 1, wallet: "maria.sol", displayName: "maria.sol", totalScore: 742.8, isCurrentUser: false },
              { rank: 2, wallet: "elrojo.sol", displayName: "elrojo.sol", totalScore: 731.4, isCurrentUser: false },
              { rank: 3, wallet: "tiki-taka.sol", displayName: "tiki-taka.sol", totalScore: 729.1, isCurrentUser: false },
            ],
            user: { rank: 112, wallet, displayName: "You", totalScore: 518.7, isCurrentUser: true },
            totalParticipants: 8421,
            top1PercentCutoff: 641.2,
          },
          rankHistory: [4921, 3108, 1420, 1086, 384, 112],
        });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [wallet, teamId],
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading || !data) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading team journey…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const { journey, timeline, trustedPlayers, leaderboard, rankHistory } = data;

  const percentileText = journey.percentile
    ? `Top ${(100 - journey.percentile).toFixed(1)}%`
    : null;

  const eligibilityProgress =
    journey.eligibleMatches > 0
      ? (journey.matchesFollowed / journey.eligibleMatches) * 100
      : 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>SUPPORTER JOURNEY</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchData(true)}
            tintColor={COLORS.primary}
          />
        }
      >
        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <View style={styles.heroCard}>
          <View style={styles.heroTop}>
            <Text style={styles.heroFlag}>{journey.flag}</Text>
            <View style={styles.heroInfo}>
              <Text style={styles.heroTeamName}>{journey.teamName.toUpperCase()}</Text>
              <Text style={styles.heroEyebrow}>YOUR SUPPORTER JOURNEY</Text>
            </View>
          </View>

          <View style={styles.heroMetrics}>
            <View style={styles.heroMetricBox}>
              <Text style={styles.heroMetricValue}>
                #{journey.currentTeamRank?.toLocaleString() ?? "—"}
              </Text>
              <Text style={styles.heroMetricLabel}>
                {journey.teamName} supporter rank
              </Text>
            </View>
          </View>

          <View style={styles.heroSubMetrics}>
            <Text style={styles.heroSubValue}>
              {journey.totalJourneyScore.toFixed(1)} journey score
            </Text>
            <Text style={styles.heroSubValue}>
              {journey.matchesFollowed} of {journey.eligibleMatches} matches followed
            </Text>
            {percentileText && (
              <Text style={styles.heroSubValue}>{percentileText} of {journey.teamName} supporters</Text>
            )}
          </View>

          {/* Top-fan eligibility */}
          <View style={styles.eligibilitySection}>
            <View style={styles.eligibilityHeader}>
              <Text style={styles.eligibilityTitle}>TOP-FAN ELIGIBILITY</Text>
              <Text style={styles.eligibilityStatus}>
                {journey.topFanEligible ? "Eligible ✓" : "Not yet eligible"}
              </Text>
            </View>
            <Text style={styles.eligibilityDetail}>
              Follow at least 75% of {journey.teamName}'s matches
            </Text>
            <Text style={styles.eligibilityProgress}>
              {journey.matchesFollowed} of {journey.eligibleMatches} completed
            </Text>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.min(100, eligibilityProgress)}%`,
                    backgroundColor: journey.topFanEligible
                      ? COLORS.successGreen
                      : COLORS.accentGold,
                  },
                ]}
              />
            </View>
          </View>
        </View>

        {/* ── Journey Timeline ─────────────────────────────────────────── */}
        <JourneyTimeline
          entries={timeline}
          teamName={journey.teamName}
          onMatchPress={(fixtureId) => {
            navigation.navigate("CompletedMatch", {
              fixtureId,
              selectedTeamId: teamId,
              selectedPlayerIds: [],
            });
          }}
        />

        {/* ── Trusted Players ──────────────────────────────────────────── */}
        <View style={styles.sectionSpacer} />
        <TrustedPlayers players={trustedPlayers} />

        {/* ── Leaderboard Preview ──────────────────────────────────────── */}
        <View style={styles.sectionSpacer} />
        <JourneyLeaderboardPreview
          top={leaderboard.top}
          user={leaderboard.user}
          totalParticipants={leaderboard.totalParticipants}
          top1PercentCutoff={leaderboard.top1PercentCutoff}
          rankHistory={rankHistory}
          teamName={journey.teamName}
          userScore={journey.totalJourneyScore}
        />
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
  header: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 12,
    fontWeight: "900",
    color: COLORS.textPrimary,
    letterSpacing: 0.8,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  heroCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    margin: 16,
    marginBottom: 12,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  heroFlag: {
    fontSize: 36,
    marginRight: 14,
  },
  heroInfo: {
    flex: 1,
  },
  heroTeamName: {
    fontSize: 22,
    fontWeight: "900",
    color: COLORS.textPrimary,
    letterSpacing: -0.5,
  },
  heroEyebrow: {
    fontSize: 8,
    fontWeight: "800",
    color: COLORS.textSecondary,
    letterSpacing: 0.8,
    marginTop: 2,
  },
  heroMetrics: {
    marginBottom: 8,
  },
  heroMetricBox: {
    alignItems: "center",
    backgroundColor: COLORS.primaryMuted,
    borderRadius: 12,
    padding: 12,
  },
  heroMetricValue: {
    fontSize: 28,
    fontWeight: "900",
    color: COLORS.primary,
  },
  heroMetricLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  heroSubMetrics: {
    marginTop: 8,
    gap: 2,
  },
  heroSubValue: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textSecondary,
  },
  eligibilitySection: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 12,
  },
  eligibilityHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  eligibilityTitle: {
    fontSize: 8,
    fontWeight: "900",
    color: COLORS.textPrimary,
    letterSpacing: 0.8,
  },
  eligibilityStatus: {
    fontSize: 10,
    fontWeight: "800",
    color: COLORS.successGreen,
  },
  eligibilityDetail: {
    fontSize: 9,
    color: COLORS.textSecondary,
    fontWeight: "600",
  },
  eligibilityProgress: {
    fontSize: 9,
    color: COLORS.textSecondary,
    marginTop: 4,
    marginBottom: 6,
    fontWeight: "600",
  },
  progressBar: {
    height: 6,
    backgroundColor: COLORS.cardHover,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },
  sectionSpacer: {
    height: 12,
  },
});
