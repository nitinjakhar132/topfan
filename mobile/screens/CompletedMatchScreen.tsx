import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  CompletedMatchScreenRouteProp,
  CompletedMatchScreenNavigationProp,
  LiveFixture,
  LivePlayer,
  TrioComparisonSummary,
  PositionMatchup,
} from "../types/match";
import { COLORS } from "../theme/colors";
import { MatchHeader } from "../components/MatchHeader";
import { TrioMatchupHero } from "../components/TrioMatchupHero";
import { MatchPitchView } from "../components/MatchPitchView";
import { SubstitutesList } from "../components/SubstitutesList";
import { PlayerProfileModal } from "../components/PlayerProfileModal";

interface CompletedMatchScreenProps {
  route: CompletedMatchScreenRouteProp;
  navigation: CompletedMatchScreenNavigationProp;
}

type TabKey = "battle" | "pitch" | "bench";

export const CompletedMatchScreen: React.FC<CompletedMatchScreenProps> = ({
  route,
  navigation,
}) => {
  const { fixtureId, selectedTeamId, selectedPlayerIds = [] } = route.params;

  const [fixture, setFixture] = useState<LiveFixture | null>(route.params.fixture || null);
  const [players, setPlayers] = useState<LivePlayer[]>([]);
  const [loading, setLoading] = useState<boolean>(!route.params.fixture);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("battle");
  const [activeDetailPlayer, setActiveDetailPlayer] = useState<LivePlayer | null>(null);

  // Fetch real fixture details and player list from backend
  const fetchMatchData = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else if (!fixture) setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/data/fixtures/${fixtureId}`);
        if (!response.ok) {
          throw new Error(`Failed to load match feed (Status: ${response.status})`);
        }
        const data = await response.json();

        if (data.fixture) {
          setFixture(data.fixture);
        }
        if (Array.isArray(data.players)) {
          setPlayers(data.players);
        }
      } catch (err) {
        console.error("Error loading completed match:", err);
        // Fallback: If network is offline/dev server unavailable, we mock players for demonstration
        if (players.length === 0) {
          setPlayers([
            { id: "840811", name: "Messi, Lionel", position: "ATT", starter: true, teamId: "1489", participant: 1, impactRating: 8.8, goals: 2, assists: 1, yellowCards: 0, redCards: 0 },
            { id: "840800", name: "Fernandez, Enzo", position: "MID", starter: true, teamId: "1489", participant: 1, impactRating: 7.2, goals: 0, assists: 1, yellowCards: 1, redCards: 0 },
            { id: "840809", name: "Martinez, Lisandro", position: "DEF", starter: true, teamId: "1489", participant: 1, impactRating: 7.8, goals: 0, assists: 0, yellowCards: 0, redCards: 0 },
            { id: "840756", name: "Kane, Harry", position: "ATT", starter: true, teamId: "1490", participant: 2, impactRating: 7.6, goals: 1, assists: 0, yellowCards: 0, redCards: 0 },
            { id: "840743", name: "Bellingham, Jude", position: "MID", starter: true, teamId: "1490", participant: 2, impactRating: 7.4, goals: 0, assists: 1, yellowCards: 0, redCards: 0 },
            { id: "840751", name: "Guehi, Marc", position: "DEF", starter: true, teamId: "1490", participant: 2, impactRating: 6.8, goals: 0, assists: 0, yellowCards: 0, redCards: 0 }
          ]);
        }
        if (!fixture) {
          setFixture({
            id: fixtureId,
            tournamentName: "World Cup Finals",
            startsAt: "2026-07-16T18:00:00Z",
            status: "COMPLETED",
            homeTeamId: "1489",
            awayTeamId: "1490",
            homeTeam: "Argentina",
            awayTeam: "England",
            participant1Id: "1489",
            participant2Id: "1490",
            homeScore: 3,
            awayScore: 2,
          });
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [fixtureId, fixture]
  );

  useEffect(() => {
    fetchMatchData();
  }, [fetchMatchData]);

  // Determine user participant side vs opposition participant side
  const { userParticipant, oppositionParticipant, homePlayers, awayPlayers } = useMemo(() => {
    if (!fixture) {
      return { userParticipant: 1 as const, oppositionParticipant: 2 as const, homePlayers: [], awayPlayers: [] };
    }
    const isHome = selectedTeamId === fixture.homeTeamId || selectedTeamId === fixture.participant1Id;
    const uPart = (isHome ? 1 : 2) as 1 | 2;
    const oPart = (isHome ? 2 : 1) as 1 | 2;

    const h = players.filter((p) => p.participant === (fixture.participant1Id === fixture.homeTeamId ? 1 : 2));
    const a = players.filter((p) => p.participant === (fixture.participant1Id === fixture.homeTeamId ? 2 : 1));

    return {
      userParticipant: uPart,
      oppositionParticipant: oPart,
      homePlayers: h,
      awayPlayers: a,
    };
  }, [fixture, selectedTeamId, players]);

  // Compute the Trio Comparison: user trio vs opposition highest-rated trio
  const trioSummary: TrioComparisonSummary = useMemo(() => {
    const userPlayersList = players.filter((p) => p.participant === userParticipant);
    const oppPlayersList = players.filter((p) => p.participant === oppositionParticipant);

    const positions: ("ATT" | "MID" | "DEF")[] = ["ATT", "MID", "DEF"];

    // Find user selected 3 players
    const userSelectedMap = new Map<string, LivePlayer>();
    selectedPlayerIds.forEach((id) => {
      const found = userPlayersList.find((p) => p.id === id);
      if (found && (found.position === "ATT" || found.position === "MID" || found.position === "DEF")) {
        userSelectedMap.set(found.position, found);
      }
    });

    // Build matchups against best opposition player
    const matchups: PositionMatchup[] = positions.map((pos) => {
      let uPlayer = userSelectedMap.get(pos) || null;
      if (!uPlayer) {
        const candidates = userPlayersList.filter((p) => p.position === pos);
        candidates.sort((a, b) => (b.impactRating ?? 0) - (a.impactRating ?? 0));
        uPlayer = candidates[0] || null;
      }

      const oppCandidates = oppPlayersList.filter(
        (p) => p.position === pos && p.impactRating !== null
      );
      oppCandidates.sort((a, b) => (b.impactRating ?? 0) - (a.impactRating ?? 0));
      const oPlayer = oppCandidates[0] || null;

      const uRating = uPlayer?.impactRating ?? 0;
      const oRating = oPlayer?.impactRating ?? 0;

      let winner: "USER" | "OPPOSITION" | "TIE" = "TIE";
      if (uRating > oRating) winner = "USER";
      else if (oRating > uRating) winner = "OPPOSITION";

      return {
        position: pos,
        userPlayer: uPlayer,
        oppositionPlayer: oPlayer,
        userRating: uRating,
        oppositionRating: oRating,
        winner,
      };
    });

    const userTotal = matchups.reduce((acc, m) => acc + (m.userPlayer?.impactRating ?? 0), 0);
    const oppTotal = matchups.reduce((acc, m) => acc + (m.oppositionPlayer?.impactRating ?? 0), 0);

    const hasCompleteData =
      matchups.every((m) => m.userPlayer && m.userPlayer.impactRating !== null) &&
      matchups.every((m) => m.oppositionPlayer && m.oppositionPlayer.impactRating !== null);

    const matchIndex = hasCompleteData && oppTotal > 0 ? (userTotal / oppTotal) * 100 : null;

    return {
      matchups,
      userTotalRating: userTotal,
      oppositionTotalRating: oppTotal,
      matchIndex,
      userPositionsWon: matchups.filter((m) => m.winner === "USER").length,
      oppositionPositionsWon: matchups.filter((m) => m.winner === "OPPOSITION").length,
    };
  }, [players, userParticipant, oppositionParticipant, selectedPlayerIds]);

  const selectedPlayerIdsSet = useMemo(
    () => new Set(trioSummary.matchups.map((m) => m.userPlayer?.id).filter(Boolean) as string[]),
    [trioSummary]
  );
  const oppositionBestIdsSet = useMemo(
    () => new Set(trioSummary.matchups.map((m) => m.oppositionPlayer?.id).filter(Boolean) as string[]),
    [trioSummary]
  );

  const homeSubs = useMemo(() => homePlayers.filter((p) => !p.starter), [homePlayers]);
  const awaySubs = useMemo(() => awayPlayers.filter((p) => !p.starter), [awayPlayers]);

  const userSupportedTeamName = selectedTeamId === fixture?.homeTeamId ? fixture?.homeTeam : fixture?.awayTeam;
  const oppTeamName = selectedTeamId === fixture?.homeTeamId ? fixture?.awayTeam : fixture?.homeTeam;
  const isArgentina = userSupportedTeamName?.toLowerCase().includes("argentina");

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading official match analysis…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !fixture) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.centerBox}>
          <Ionicons name="alert-circle" size={48} color={COLORS.ratingLow} />
          <Text style={styles.errorTitle}>Match Feed Unavailable</Text>
          <Text style={styles.errorText}>{error || "Unable to locate fixture details."}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchMatchData()} activeOpacity={0.8}>
            <Text style={styles.retryText}>Retry Loading</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <MatchHeader
        fixture={fixture}
        selectedTeamId={selectedTeamId}
        onBackPressed={() => navigation.goBack()}
      />

      <ScrollView
        style={styles.scrollBody}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchMatchData(true)}
            tintColor={COLORS.primary}
            colors={[COLORS.primary]}
          />
        }
      >
        {/* Supporter Journey Card */}
        {activeTab === "battle" && trioSummary.userTotalRating > 0 && (
          <View style={styles.journeyCard}>
            <Text style={styles.journeyCardTitle}>{userSupportedTeamName} Supporter Journey</Text>
            <View style={styles.journeyMetrics}>
              <View style={styles.journeyMetricBox}>
                <Text style={styles.journeyMetricValue}>{isArgentina ? "#1,109" : "#2,480"}</Text>
                <Text style={styles.journeyMetricLabel}>Team Rank</Text>
              </View>
              <View style={styles.journeyMetricBox}>
                <Text style={styles.journeyMetricValue}>{isArgentina ? "418.7" : "324.5"}</Text>
                <Text style={styles.journeyMetricLabel}>Total Score</Text>
              </View>
              <View style={styles.journeyMetricBox}>
                <Text style={styles.journeyMetricValue}>{isArgentina ? "4/5" : "3/5"}</Text>
                <Text style={styles.journeyMetricLabel}>Matches</Text>
              </View>
            </View>
            <Text style={styles.journeyMovementBanner}>
              ↑ {isArgentina ? "84" : "12"} places after this match
            </Text>
            <View style={styles.progressContainer}>
              <View style={styles.progressHeader}>
                <Text style={styles.progressTitle}>TOP-FAN ELIGIBILITY</Text>
                <Text style={styles.progressSubtext}>Follow 75% of matches</Text>
              </View>
              <Text style={styles.progressStats}>{isArgentina ? "4 of 5" : "3 of 5"} completed</Text>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: isArgentina ? "80%" : "60%" }]} />
              </View>
            </View>
          </View>
        )}

        {/* Tab Selector bar */}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === "battle" && styles.tabButtonActive]}
            onPress={() => setActiveTab("battle")}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, activeTab === "battle" && styles.tabTextActive]}>
              Your Three
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabButton, activeTab === "pitch" && styles.tabButtonActive]}
            onPress={() => setActiveTab("pitch")}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, activeTab === "pitch" && styles.tabTextActive]}>
              Lineup
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabButton, activeTab === "bench" && styles.tabButtonActive]}
            onPress={() => setActiveTab("bench")}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, activeTab === "bench" && styles.tabTextActive]}>
              Substitutes
            </Text>
          </TouchableOpacity>
        </View>

        {activeTab === "battle" && (
          <>
            <TrioMatchupHero
              summary={trioSummary}
              userTeamName={userSupportedTeamName || ""}
              oppTeamName={oppTeamName || ""}
              onPlayerPress={setActiveDetailPlayer}
            />

            {/* Argentina Leaderboard Preview */}
            <View style={styles.leaderboardCard}>
              <View style={styles.leaderboardHeader}>
                <Text style={styles.leaderboardTitle}>🏴󠁧󠁢󠁳🇦 {userSupportedTeamName?.toUpperCase()} TOP FANS</Text>
                <Text style={styles.leaderboardTitle}>Score</Text>
              </View>

              <View style={styles.leaderboardRows}>
                <View style={styles.leaderboardRow}>
                  <Text style={styles.leaderboardRank}>1</Text>
                  <Text style={styles.leaderboardName}>maria.sol</Text>
                  <Text style={styles.leaderboardScore}>531.8</Text>
                </View>
                <View style={styles.leaderboardRow}>
                  <Text style={styles.leaderboardRank}>2</Text>
                  <Text style={styles.leaderboardName}>julio.sol</Text>
                  <Text style={styles.leaderboardScore}>526.4</Text>
                </View>
                <View style={styles.leaderboardRow}>
                  <Text style={styles.leaderboardRank}>3</Text>
                  <Text style={styles.leaderboardName}>campeon.sol</Text>
                  <Text style={styles.leaderboardScore}>518.9</Text>
                </View>

                <Text style={styles.leaderboardDots}>···</Text>

                <View style={[styles.leaderboardRow, styles.currentUserRow]}>
                  <Text style={styles.leaderboardRank}>{isArgentina ? "1,109" : "2,410"}</Text>
                  <Text style={styles.leaderboardName}>You</Text>
                  <Text style={styles.leaderboardScore}>
                    {isArgentina ? "418.7" : "324.5"} <Text style={styles.leaderboardChange}>↑{isArgentina ? "84" : "12"}</Text>
                  </Text>
                </View>
              </View>

              <Text style={styles.cutoffText}>
                Top 0.1% cutoff: 502.4 · {isArgentina ? "83.7" : "177.9"} points to top 0.1%
              </Text>

              <TouchableOpacity
                style={styles.fullLeaderboardBtn}
                activeOpacity={0.7}
                onPress={() => navigation.navigate("TeamJourney" as any, { teamId: selectedTeamId, wallet: "devnet-demo-wallet" })}
              >
                <Text style={styles.fullLeaderboardText}>View full leaderboard →</Text>
              </TouchableOpacity>
            </View>

            {/* Journey Continuation CTA */}
            <TouchableOpacity
              style={styles.journeyContinueBtn}
              activeOpacity={0.7}
              onPress={() => navigation.navigate("TeamJourney" as any, { teamId: selectedTeamId, wallet: "devnet-demo-wallet" })}
            >
              <Text style={styles.journeyContinueBtnText}>
                Continue {userSupportedTeamName}'s journey →
              </Text>
            </TouchableOpacity>
          </>
        )}

        {activeTab === "pitch" && (
          <MatchPitchView
            homePlayers={homePlayers}
            awayPlayers={awayPlayers}
            homeTeamName={fixture.homeTeam}
            awayTeamName={fixture.awayTeam}
            selectedPlayerIds={selectedPlayerIdsSet}
            oppositionBestIds={oppositionBestIdsSet}
            homeTeamId={fixture.homeTeamId}
            awayTeamId={fixture.awayTeamId}
            initialTeamId={selectedTeamId}
            onPlayerPress={setActiveDetailPlayer}
          />
        )}

        {activeTab === "bench" && (
          <SubstitutesList
            homeSubs={homeSubs}
            awaySubs={awaySubs}
            homeTeamName={fixture.homeTeam}
            awayTeamName={fixture.awayTeam}
            homeTeamId={fixture.homeTeamId}
            awayTeamId={fixture.awayTeamId}
            initialTeamId={selectedTeamId}
            onPlayerPress={setActiveDetailPlayer}
          />
        )}
      </ScrollView>

      {/* Player profile overlay bottom sheet modal */}
      <PlayerProfileModal
        player={activeDetailPlayer}
        visible={activeDetailPlayer !== null}
        onClose={() => setActiveDetailPlayer(null)}
      />
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
    paddingHorizontal: 28,
  },
  loadingText: {
    marginTop: 14,
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: "600",
  },
  errorTitle: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: "800",
    marginTop: 14,
  },
  errorText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    textAlign: "center",
    marginTop: 6,
    lineHeight: 18,
  },
  retryBtn: {
    marginTop: 20,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
  },
  retryText: {
    color: COLORS.surface,
    fontSize: 14,
    fontWeight: "800",
  },
  tabBar: {
    flexDirection: "row",
    backgroundColor: COLORS.surface,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    justifyContent: "space-around",
  },
  tabButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  tabButtonActive: {
    backgroundColor: COLORS.primaryMuted,
  },
  tabText: {
    fontSize: 12,
    fontWeight: "750",
    color: COLORS.textSecondary,
  },
  tabTextActive: {
    color: COLORS.primary,
  },
  scrollBody: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  journeyCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    margin: 16,
    marginBottom: 8,
  },
  journeyCardTitle: {
    fontSize: 11,
    fontWeight: "900",
    color: COLORS.textPrimary,
    marginBottom: 12,
  },
  journeyMetrics: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  journeyMetricBox: {
    flex: 1,
  },
  journeyMetricValue: {
    fontSize: 18,
    fontWeight: "900",
    color: COLORS.primary,
  },
  journeyMetricLabel: {
    fontSize: 8,
    color: COLORS.textSecondary,
    marginTop: 2,
    textTransform: "uppercase",
  },
  journeyMovementBanner: {
    backgroundColor: COLORS.primaryMuted,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    fontSize: 10,
    fontWeight: "850",
    color: COLORS.successGreen,
    alignSelf: "flex-start",
    marginBottom: 14,
  },
  progressContainer: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 12,
  },
  progressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressTitle: {
    fontSize: 8,
    fontWeight: "900",
    color: COLORS.textPrimary,
    letterSpacing: 0.8,
  },
  progressSubtext: {
    fontSize: 8,
    color: COLORS.textSecondary,
  },
  progressStats: {
    fontSize: 10,
    color: COLORS.textSecondary,
    marginTop: 4,
    marginBottom: 6,
  },
  progressBar: {
    height: 6,
    backgroundColor: COLORS.cardHover,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: COLORS.successGreen,
    borderRadius: 3,
  },
  leaderboardCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 18,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 8,
  },
  leaderboardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingBottom: 8,
    marginBottom: 10,
  },
  leaderboardTitle: {
    fontSize: 9,
    fontWeight: "900",
    color: COLORS.textSecondary,
    letterSpacing: 0.5,
  },
  leaderboardRows: {
    flexDirection: "column",
    gap: 8,
  },
  leaderboardRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  currentUserRow: {
    backgroundColor: COLORS.primaryMuted,
    padding: 8,
    borderRadius: 8,
  },
  leaderboardRank: {
    width: 28,
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.textSecondary,
  },
  leaderboardName: {
    flex: 1,
    fontSize: 11,
    fontWeight: "750",
    color: COLORS.textPrimary,
  },
  leaderboardScore: {
    fontSize: 11,
    fontWeight: "900",
    color: COLORS.textPrimary,
  },
  leaderboardDots: {
    textAlign: "center",
    color: COLORS.textMuted,
    fontSize: 12,
    marginVertical: 2,
  },
  leaderboardChange: {
    fontSize: 9,
    fontWeight: "800",
    color: COLORS.successGreen,
    marginLeft: 4,
  },
  cutoffText: {
    fontSize: 9,
    color: COLORS.textMuted,
    marginTop: 12,
    textAlign: "center",
  },
  fullLeaderboardBtn: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingVertical: 8,
    alignItems: "center",
    backgroundColor: COLORS.cardHover,
  },
  fullLeaderboardText: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.primary,
  },
  journeyContinueBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
  },
  journeyContinueBtnText: {
    fontSize: 13,
    fontWeight: "900",
    color: "#ffffff",
    letterSpacing: 0.3,
  },
});
