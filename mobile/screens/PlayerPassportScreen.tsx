import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { PlayerPassportResponse, PlayerMatchHistoryItem } from "../lib/player-repository/types";
import { SpiderChart } from "../components/SpiderChart";
import { PlayerTraitChip } from "../components/PlayerTraitChip";
import { COLORS } from "../theme/colors";

interface PlayerPassportScreenProps {
  playerId: string;
  wallet?: string;
  onBack: () => void;
}

export const PlayerPassportScreen: React.FC<PlayerPassportScreenProps> = ({
  playerId,
  wallet,
  onBack,
}) => {
  const [loading, setLoading] = useState(true);
  const [passport, setPassport] = useState<PlayerPassportResponse | null>(null);
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);
  const [matchDetails, setMatchDetails] = useState<Record<string, any>>({});

  useEffect(() => {
    fetchPassport();
  }, [playerId]);

  const fetchPassport = async () => {
    setLoading(true);
    try {
      const walletParam = wallet ? `&wallet=${wallet}` : "";
      const response = await fetch(`http://localhost:3000/api/data/players/${playerId}?competitionId=72${walletParam}`);
      const data = await response.json();
      setPassport(data);
    } catch (e) {
      console.error("[Passport Screen] Error loading player passport:", e);
    } finally {
      setLoading(false);
    }
  };

  const fetchMatchBreakdown = async (fixtureId: string) => {
    if (matchDetails[fixtureId]) {
      setExpandedMatchId(expandedMatchId === fixtureId ? null : fixtureId);
      return;
    }
    
    try {
      const response = await fetch(`http://localhost:3000/api/data/players/${playerId}/matches/${fixtureId}`);
      const data = await response.json();
      setMatchDetails((prev) => ({ ...prev, [fixtureId]: data }));
      setExpandedMatchId(fixtureId);
    } catch (e) {
      console.error("[Passport Screen] Error loading match details:", e);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.green || "#2d653d"} />
        <Text style={styles.loadingText}>Loading passport...</Text>
      </View>
    );
  }

  if (!passport) {
    return (
      <View style={styles.errorContainer}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Ionicons name="arrow-back" size={24} color="#000000" />
        </TouchableOpacity>
        <Text style={styles.errorText}>Could not load player passport details.</Text>
      </View>
    );
  }

  const { player, tournament, spider, traits, matchHistory, personalHistory } = passport;
  const rating = tournament?.minutesWeightedRating ?? tournament?.simpleAverageRating ?? null;

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Ionicons name="arrow-back" size={24} color={COLORS.ink || "#0f172a"} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>PLAYER PASSPORT</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Identity Hero */}
        <View style={styles.hero}>
          <View style={styles.shirtBadge}>
            <Text style={styles.shirtText}>{player.shirtNumber ?? "—"}</Text>
          </View>
          <View style={styles.identity}>
            <Text style={styles.name}>{player.displayName}</Text>
            <Text style={styles.subtext}>
              {player.position} · No. {player.shirtNumber ?? "—"}
            </Text>
          </View>
          <View style={styles.ratingCol}>
            <Text style={styles.ratingVal}>{rating ? rating.toFixed(2) : "—"}</Text>
            <Text style={styles.ratingLbl}>IMPACT RATING</Text>
          </View>
        </View>

        {/* Dynamic Journey Section */}
        {personalHistory && personalHistory.timesSelected > 0 ? (
          <View style={styles.journeyCard}>
            <Text style={styles.sectionLabel}>YOUR JOURNEY WITH {player.displayName.split(",")[0].toUpperCase()}</Text>
            
            <View style={styles.journeyStats}>
              <View style={styles.journeyBox}>
                <Text style={styles.journeyValue}>{personalHistory.timesSelected}</Text>
                <Text style={styles.journeyLabel}>Selected</Text>
              </View>
              <View style={styles.journeyBox}>
                <Text style={styles.journeyValue}>{personalHistory.consecutiveSelections ?? 1}</Text>
                <Text style={styles.journeyLabel}>Consecutive</Text>
              </View>
              <View style={styles.journeyBox}>
                <Text style={styles.journeyValue}>
                  {personalHistory.averageRatingWhenSelected
                    ? personalHistory.averageRatingWhenSelected.toFixed(2)
                    : "—"}
                </Text>
                <Text style={styles.journeyLabel}>Avg Rating</Text>
              </View>
              <View style={styles.journeyBox}>
                <Text style={styles.journeyValue}>
                  {personalHistory.supporterPointsGenerated.toFixed(1)}
                </Text>
                <Text style={styles.journeyLabel}>Points</Text>
              </View>
            </View>

            {personalHistory.bestFixtureOpponent && (
              <View style={styles.bestSelectionRow}>
                <Text style={styles.bestSelectionLabel}>Best selection:</Text>
                <Text style={styles.bestSelectionValue}>vs {personalHistory.bestFixtureOpponent}</Text>
              </View>
            )}
          </View>
        ) : null}

        {/* Tournament Stats summary */}
        <View style={styles.statsCard}>
          <Text style={styles.sectionLabel}>TOURNAMENT AGGREGATE SUMMARY</Text>
          <View style={styles.grid}>
            <View style={styles.gridBox}>
              <Text style={styles.gridVal}>{tournament?.appearances ?? 0}</Text>
              <Text style={styles.gridLbl}>Appearances</Text>
            </View>
            <View style={styles.gridBox}>
              <Text style={styles.gridVal}>{tournament?.starts ?? 0}</Text>
              <Text style={styles.gridLbl}>Starts</Text>
            </View>
            <View style={styles.gridBox}>
              <Text style={styles.gridVal}>{tournament?.totalMinutes ?? 0}</Text>
              <Text style={styles.gridLbl}>Minutes</Text>
            </View>
            <View style={styles.gridBox}>
              <Text style={styles.gridVal}>{tournament?.totalGoals ?? 0}</Text>
              <Text style={styles.gridLbl}>Goals</Text>
            </View>
          </View>
        </View>

        {/* Traits */}
        {traits.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>PLAYER TRAITS</Text>
            <View style={styles.traitsRow}>
              {traits.map((t, idx) => (
                <PlayerTraitChip
                  key={idx}
                  traitKey={t.traitKey}
                  label={t.label}
                  evidence={t.evidence}
                />
              ))}
            </View>
          </View>
        ) : null}

        {/* Spider Radar Chart */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>RADAR PERFORMANCE PROFILE</Text>
          <View style={styles.spiderContainer}>
            {spider ? (
              <SpiderChart
                form={spider.form}
                impact={spider.impact}
                threat={spider.threat}
                bigMoments={spider.bigMoments}
                reliability={spider.reliability}
                discipline={spider.discipline}
                size={240}
              />
            ) : (
              <Text style={styles.noData}>Radar requires at least 90 tournament minutes.</Text>
            )}
          </View>
        </View>

        {/* Match-by-match History with Collapsible breakdowns */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>MATCH HISTORY</Text>
          {matchHistory.length > 0 ? (
            matchHistory.map((m) => {
              const isExpanded = expandedMatchId === m.fixtureId;
              const details = matchDetails[m.fixtureId];
              
              return (
                <View key={m.fixtureId} style={styles.matchCard}>
                  <TouchableOpacity
                    style={styles.matchHeader}
                    onPress={() => fetchMatchBreakdown(m.fixtureId)}
                    activeOpacity={0.8}
                  >
                    <View>
                      <Text style={styles.matchOpponent}>vs {m.opponent}</Text>
                      <Text style={styles.matchStage}>
                        {m.competitionStage?.toUpperCase() ?? "MATCH"} · {m.minutesPlayed} mins
                      </Text>
                    </View>
                    <View style={styles.matchRatingCol}>
                      <Text style={styles.matchRating}>
                        {m.finalRating ? m.finalRating.toFixed(1) : "—"}
                      </Text>
                      <Ionicons
                        name={isExpanded ? "chevron-up" : "chevron-down"}
                        size={16}
                        color={COLORS.muted || "#64748b"}
                        style={{ marginLeft: 8 }}
                      />
                    </View>
                  </TouchableOpacity>

                  {/* Expanded Breakdown */}
                  {isExpanded && details ? (
                    <View style={styles.breakdown}>
                      <Text style={styles.breakdownTitle}>IMPACT BREAKDOWN</Text>
                      
                      {/* Rating contributions list */}
                      {details.ratingDetails?.contributions?.map((c: any, index: number) => {
                        const sign = c.ratingDelta >= 0 ? "+" : "";
                        return (
                          <View key={index} style={styles.contribRow}>
                            <Text style={styles.contribLabel}>
                              {c.key.replace(/_/g, " ").toUpperCase()} (x{c.rawValue})
                            </Text>
                            <Text style={[
                              styles.contribValue,
                              c.ratingDelta >= 0 ? styles.positiveDelta : styles.negativeDelta
                            ]}>
                              {sign}{c.ratingDelta.toFixed(2)}
                            </Text>
                          </View>
                        );
                      })}

                      {/* Event timeline */}
                      {details.events?.length > 0 ? (
                        <View style={styles.timelineSection}>
                          <Text style={styles.breakdownTitle}>MATCH EVENTS TIMELINE</Text>
                          {details.events.map((e: any, index: number) => (
                            <View key={index} style={styles.timelineItem}>
                              <Text style={styles.timelineMinute}>{e.matchMinute}'</Text>
                              <Text style={styles.timelineText}>
                                {e.eventType.replace(/_/g, " ").toUpperCase()}
                                {e.eventSubtype ? ` (${e.eventSubtype})` : ""}
                              </Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              );
            })
          ) : (
            <Text style={styles.noData}>No finalized matches in history.</Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background || "#fbfbfa",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.background || "#fbfbfa",
  },
  loadingText: {
    fontSize: 12,
    color: COLORS.muted || "#64748b",
    marginTop: 8,
    fontWeight: "600",
  },
  errorContainer: {
    flex: 1,
    paddingTop: 44,
    backgroundColor: COLORS.background || "#fbfbfa",
  },
  errorText: {
    fontSize: 12,
    color: "#b91c1c",
    alignSelf: "center",
    marginTop: 100,
    fontWeight: "600",
  },
  header: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line || "#e2e8f0",
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: COLORS.ink || "#0f172a",
    letterSpacing: 0.5,
  },
  headerSpacer: {
    width: 32,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
  },
  hero: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
    backgroundColor: COLORS.paper || "#ffffff",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.line || "#e2e8f0",
  },
  shirtBadge: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: "rgba(0, 0, 0, 0.05)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  shirtText: {
    fontSize: 16,
    fontWeight: "900",
    color: COLORS.primary || "#2d653d",
  },
  identity: {
    flex: 1,
  },
  name: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.ink || "#0f172a",
  },
  subtext: {
    fontSize: 11,
    color: COLORS.muted || "#64748b",
    marginTop: 2,
  },
  ratingCol: {
    alignItems: "flex-end",
  },
  ratingVal: {
    fontSize: 22,
    fontWeight: "900",
    color: COLORS.green || "#2d653d",
  },
  ratingLbl: {
    fontSize: 7,
    fontWeight: "700",
    color: COLORS.muted || "#64748b",
    letterSpacing: 0.5,
    marginTop: 1,
  },
  journeyCard: {
    backgroundColor: "rgba(45, 101, 61, 0.04)",
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(45, 101, 61, 0.15)",
  },
  sectionLabel: {
    fontSize: 8,
    fontWeight: "700",
    color: COLORS.muted || "#64748b",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  journeyStats: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  journeyBox: {
    alignItems: "center",
    flex: 1,
  },
  journeyValue: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.green || "#2d653d",
  },
  journeyLabel: {
    fontSize: 8,
    color: COLORS.muted || "#64748b",
    marginTop: 2,
    fontWeight: "600",
  },
  statsCard: {
    backgroundColor: COLORS.paper || "#ffffff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: COLORS.line || "#e2e8f0",
  },
  grid: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  gridBox: {
    alignItems: "center",
    flex: 1,
  },
  gridVal: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.ink || "#0f172a",
  },
  gridLbl: {
    fontSize: 8,
    color: COLORS.muted || "#64748b",
    marginTop: 2,
    fontWeight: "600",
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
    color: COLORS.muted || "#64748b",
    marginBottom: 10,
  },
  traitsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  spiderContainer: {
    alignItems: "center",
    backgroundColor: COLORS.paper || "#ffffff",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.line || "#e2e8f0",
  },
  noData: {
    fontSize: 10,
    color: COLORS.muted || "#64748b",
    fontStyle: "italic",
    paddingVertical: 20,
    textAlign: "center",
  },
  matchCard: {
    backgroundColor: COLORS.paper || "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.line || "#e2e8f0",
    marginBottom: 8,
    overflow: "hidden",
  },
  matchHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
  },
  matchOpponent: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.ink || "#0f172a",
  },
  matchStage: {
    fontSize: 9,
    color: COLORS.muted || "#64748b",
    marginTop: 2,
    fontWeight: "600",
  },
  matchRatingCol: {
    flexDirection: "row",
    alignItems: "center",
  },
  matchRating: {
    fontSize: 14,
    fontWeight: "900",
    color: COLORS.green || "#2d653d",
  },
  breakdown: {
    backgroundColor: "rgba(0, 0, 0, 0.02)",
    borderTopWidth: 1,
    borderTopColor: "rgba(0, 0, 0, 0.04)",
    padding: 12,
  },
  breakdownTitle: {
    fontSize: 8,
    fontWeight: "800",
    color: COLORS.muted || "#64748b",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  contribRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  contribLabel: {
    fontSize: 9,
    color: COLORS.muted || "#64748b",
    fontWeight: "600",
  },
  contribValue: {
    fontSize: 9,
    fontWeight: "800",
  },
  positiveDelta: {
    color: COLORS.green || "#2d653d",
  },
  negativeDelta: {
    color: "#b91c1c",
  },
  timelineSection: {
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(0, 0, 0, 0.04)",
  },
  timelineItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 3,
  },
  timelineMinute: {
    fontSize: 9,
    fontWeight: "800",
    color: COLORS.green || "#2d653d",
    width: 28,
  },
  timelineText: {
    fontSize: 9,
    fontWeight: "600",
    color: COLORS.ink || "#0f172a",
  },
  bestSelectionRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(45, 101, 61, 0.12)",
    paddingTop: 8,
  },
  bestSelectionLabel: {
    fontSize: 10,
    fontWeight: "750",
    color: COLORS.textSecondary,
    marginRight: 6,
  },
  bestSelectionValue: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.green || "#2d653d",
  },
});
