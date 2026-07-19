import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
  Alert
} from "react-native";
import { LiveFixture } from "../types/match";
import { PlayerRepositoryListItem } from "../lib/player-repository/types";
import { COLORS } from "../theme/colors";
import { SelectablePlayerCard } from "../components/SelectablePlayerCard";
import { PlayerProfileModal } from "../components/PlayerProfileModal";
import { PlayerPassportScreen } from "./PlayerPassportScreen";
import { TrioSelectionSlots } from "../components/TrioSelectionSlots";

interface UpcomingMatchScreenProps {
  route: {
    params: {
      fixture: LiveFixture;
      wallet?: string;
      journeySummary?: {
        followedCount: number;
        rank: number;
        score: number;
      };
    };
  };
  navigation: any;
}

type Step = "ATT" | "MID" | "DEF" | "REVIEW" | "PASSPORT";

export const UpcomingMatchScreen: React.FC<UpcomingMatchScreenProps> = ({
  route,
  navigation
}) => {
  const { fixture, wallet = "devnet-demo-wallet", journeySummary } = route.params;

  // Selection state
  const [activeTeamId, setActiveTeamId] = useState<string>("");
  const [selectedATT, setSelectedATT] = useState<PlayerRepositoryListItem | null>(null);
  const [selectedMID, setSelectedMID] = useState<PlayerRepositoryListItem | null>(null);
  const [selectedDEF, setSelectedDEF] = useState<PlayerRepositoryListItem | null>(null);
  const [step, setStep] = useState<Step>("ATT");
  const [sortMode, setSortMode] = useState<"recommended" | "form" | "rating" | "minutes">("recommended");
  const [rosterFilter, setRosterFilter] = useState<"all" | "starters" | "substitutes">("all");
  
  // Data state
  const [loading, setLoading] = useState(false);
  const [roster, setRoster] = useState<PlayerRepositoryListItem[]>([]);
  const [previewPlayerId, setPreviewPlayerId] = useState<string | null>(null);
  const [passportPlayerId, setPassportPlayerId] = useState<string | null>(null);
  
  const [sessionNow, setSessionNow] = useState<number>(Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [journeyData, setJourneyData] = useState<any>(null);
  const [lastMatchInfo, setLastMatchInfo] = useState<{
    trioNames: string[];
    matchIndex: number;
    movement: string;
  } | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setSessionNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const checkActiveJourney = async () => {
      try {
        const response = await fetch(`http://localhost:3000/api/journey/${wallet}`);
        const data = await response.json();
        const activeJourneys = data.journeys ?? [];
        
        // Find if user has an active journey for either team in this fixture
        const activeJ = activeJourneys.find(
          (j: any) =>
            (j.teamId === fixture.homeTeamId || j.teamId === fixture.awayTeamId) &&
            j.status === "active"
        );

        if (activeJ) {
          setActiveTeamId(activeJ.teamId);
          
          // Fetch full journey details to get timeline and last match info
          const detailRes = await fetch(`http://localhost:3000/api/journey/${wallet}/${activeJ.teamId}`);
          const detailData = await detailRes.json();
          setJourneyData(detailData.journey);
          
          // Find last completed match with selections
          const completedMatches = (detailData.timeline ?? [])
            .filter((entry: any) => entry.status === "completed" && entry.trioNames);
          
          if (completedMatches.length > 0) {
            const lastM = completedMatches[completedMatches.length - 1];
            let movement = "";
            if (lastM.rankBefore !== null && lastM.rankAfter !== null) {
              const diff = lastM.rankBefore - lastM.rankAfter;
              if (diff > 0) {
                movement = `Moved up ${diff} place${diff !== 1 ? "s" : ""}`;
              } else if (diff < 0) {
                movement = `Dropped ${Math.abs(diff)} place${Math.abs(diff) !== 1 ? "s" : ""}`;
              } else {
                movement = "No rank movement";
              }
            }
            
            setLastMatchInfo({
              trioNames: lastM.trioNames,
              matchIndex: lastM.finalMatchIndex,
              movement,
            });
          }
        }
      } catch (e) {
        console.error("[UpcomingMatch] Error checking active journey:", e);
      }
    };
    
    checkActiveJourney();
  }, [fixture.id, wallet]);

  useEffect(() => {
    if (activeTeamId) {
      fetchRoster();
    }
  }, [activeTeamId, sortMode]);

  const fetchRoster = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `http://localhost:3000/api/data/players/repository?competitionId=72&fixtureId=${fixture.id}&teamId=${activeTeamId}&wallet=${wallet}&sort=${sortMode}`
      );
      const data = await response.json();
      setRoster(data);
    } catch (e) {
      console.error("[UpcomingMatch] Error fetching roster:", e);
    } finally {
      setLoading(false);
    }
  };

  const startsAtMs = Date.parse(fixture.startsAt);
  const remainingMs = Math.max(0, startsAtMs - sessionNow);

  const formatCountdown = (ms: number) => {
    if (ms <= 0) return "LOCKED";
    const totalSeconds = Math.floor(ms / 1000);
    const totalMinutes = Math.floor(totalSeconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    const secs = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  // Support Team mapping
  const selectTeamName =
    activeTeamId === fixture.homeTeamId
      ? fixture.homeTeam
      : activeTeamId === fixture.awayTeamId
      ? fixture.awayTeam
      : "";

  // Dynamic Step advancement
  const handleSelectPlayer = (item: PlayerRepositoryListItem) => {
    const pos = item.player.position;
    if (pos === "ATT") {
      setSelectedATT(item);
      setStep("MID");
    } else if (pos === "MID") {
      setSelectedMID(item);
      setStep("DEF");
    } else if (pos === "DEF") {
      setSelectedDEF(item);
      setStep("REVIEW");
    }
  };

  const handleStepClick = (targetStep: Step) => {
    if (targetStep === "MID" && !selectedATT) return;
    if (targetStep === "DEF" && (!selectedATT || !selectedMID)) return;
    if (targetStep === "REVIEW" && (!selectedATT || !selectedMID || !selectedDEF)) return;
    setStep(targetStep);
  };

  const lockSelection = async () => {
    if (!selectedATT || !selectedMID || !selectedDEF) return;
    setSubmitting(true);

    try {
      // 1. Ensure team journey is started/active
      await fetch(`http://localhost:3000/api/journey/${wallet}/${activeTeamId}/start`, {
        method: "POST",
      });

      // 2. Submit picks
      const response = await fetch("http://localhost:3000/api/txline/picks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fixtureId: fixture.id,
          teamId: activeTeamId,
          attackerId: selectedATT.player.id,
          midfielderId: selectedMID.player.id,
          defenderId: selectedDEF.player.id,
          wallet: wallet
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        Alert.alert("Failed to save picks", errorData.error || "Server validation error.");
        return;
      }

      const res = await response.json();
      if (res.success) {
        Alert.alert("Selections Locked", "Your matchday three is locked successfully!", [
          { text: "OK", onPress: () => navigation.navigate("TeamJourney" as any, { teamId: activeTeamId, wallet }) }
        ]);
      }
    } catch (e) {
      console.error(e);
      Alert.alert("Network Error", "Could not submit picks to the TxLINE network.");
    } finally {
      setSubmitting(false);
    }
  };

  // Render player list matching current position tab
  const currentPosFilter = step === "ATT" ? "ATT" : step === "MID" ? "MID" : "DEF";
  const positionRoster = roster.filter((p) => p.player.position === currentPosFilter);
  const starters = rosterFilter === "substitutes" ? [] : positionRoster.filter((p) => p.matchdayStatus?.starter);
  const subs = rosterFilter === "starters" ? [] : positionRoster.filter((p) => !p.matchdayStatus?.starter);

  const activeSelected =
    step === "ATT" ? selectedATT : step === "MID" ? selectedMID : selectedDEF;

  // Build legacy structure for TrioSelectionSlots compatibility
  const legacySelected = {
    ATT: selectedATT ? { id: selectedATT.player.id, name: selectedATT.player.displayName, position: "ATT", starter: selectedATT.matchdayStatus?.starter } : undefined,
    MID: selectedMID ? { id: selectedMID.player.id, name: selectedMID.player.displayName, position: "MID", starter: selectedMID.matchdayStatus?.starter } : undefined,
    DEF: selectedDEF ? { id: selectedDEF.player.id, name: selectedDEF.player.displayName, position: "DEF", starter: selectedDEF.matchdayStatus?.starter } : undefined,
  } as any;

  // Handle viewing full Player Passport screen
  if (step === "PASSPORT" && passportPlayerId) {
    return (
      <PlayerPassportScreen
        playerId={passportPlayerId}
        wallet={wallet}
        onBack={() => setStep("REVIEW")}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeContainer}>
      {/* Compact match header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.backBtnText}>← Matches</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {fixture.homeTeam.toUpperCase()} vs {fixture.awayTeam.toUpperCase()}
          </Text>
          <Text style={styles.headerMeta}>WORLD CUP · SEMI-FINAL</Text>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.countdown}>
            PREVIEW DATA · {formatCountdown(remainingMs)}
          </Text>
        </View>
      </View>

      {!activeTeamId ? (
        <View style={styles.emotionalChoiceContainer}>
          <Text style={styles.emotionalChoiceTitle}>Who are you supporting?</Text>
          <Text style={styles.emotionalChoiceSubtitle}>
            Your supporter score tracks your journey to becoming their #1 fan.
          </Text>

          <View style={styles.emotionalCardsRow}>
            {/* Home Team Card */}
            <TouchableOpacity
              style={styles.emotionalCard}
              onPress={() => {
                setActiveTeamId(fixture.homeTeamId);
                setStep("ATT");
              }}
            >
              <Text style={styles.emotionalFlag}>
                {fixture.homeTeam.toLowerCase().includes("spain") ? "🇪🇸" : fixture.homeTeam.toLowerCase().includes("argentina") ? "🇦🇷" : "⚽"}
              </Text>
              <Text style={styles.emotionalTeamName}>{fixture.homeTeam}</Text>
              <Text style={styles.emotionalSupporters}>
                {fixture.homeTeam.toLowerCase().includes("spain") ? "8,421 supporters" : "12,104 supporters"}
              </Text>
            </TouchableOpacity>

            {/* Away Team Card */}
            <TouchableOpacity
              style={styles.emotionalCard}
              onPress={() => {
                setActiveTeamId(fixture.awayTeamId);
                setStep("ATT");
              }}
            >
              <Text style={styles.emotionalFlag}>
                {fixture.awayTeam.toLowerCase().includes("spain") ? "🇪🇸" : fixture.awayTeam.toLowerCase().includes("argentina") ? "🇦🇷" : "⚽"}
              </Text>
              <Text style={styles.emotionalTeamName}>{fixture.awayTeam}</Text>
              <Text style={styles.emotionalSupporters}>
                {fixture.awayTeam.toLowerCase().includes("spain") ? "8,421 supporters" : "12,104 supporters"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scrollContent}>
            {/* Journey Strip / Continuity Banner */}
            {lastMatchInfo ? (
              <View style={styles.continuityCard}>
                <Text style={styles.continuityEyebrow}>THE JOURNEY CONTINUES</Text>
                <Text style={styles.continuityMatch}>
                  {fixture.homeTeam} vs {fixture.awayTeam}
                </Text>
                <Text style={styles.continuityStage}>World Cup Final</Text>
                
                <View style={styles.continuityDivider} />
                
                <Text style={styles.continuityLabel}>Last match:</Text>
                <Text style={styles.continuityDetail}>
                  You selected <Text style={styles.boldText}>{lastMatchInfo.trioNames.join(", ")}</Text>
                </Text>
                <Text style={styles.continuityDetail}>
                  Match Index <Text style={styles.boldText}>{lastMatchInfo.matchIndex.toFixed(1)}</Text> · <Text style={styles.successText}>{lastMatchInfo.movement}</Text>
                </Text>
                
                <Text style={styles.continuityCta}>
                  Choose the three players you trust for the final.
                </Text>
              </View>
            ) : (
              <View style={styles.journeyStrip}>
                <Text style={styles.journeyLabel}>YOUR {selectTeamName.toUpperCase()} JOURNEY</Text>
                <View style={styles.journeyRow}>
                  <View style={styles.journeyCell}>
                    <Text style={styles.boldText}>#{journeySummary?.rank || journeyData?.currentTeamRank || 112}</Text>
                    <Text style={styles.journeyCellLabel}>Team rank</Text>
                  </View>
                  <View style={styles.journeyCell}>
                    <Text style={styles.boldText}>{journeySummary?.score || journeyData?.totalJourneyScore || 312.6}</Text>
                    <Text style={styles.journeyCellLabel}>Total score</Text>
                  </View>
                  <View style={styles.journeyCell}>
                    <Text style={styles.boldText}>{journeySummary?.followedCount || journeyData?.matchesFollowed || 3}/{journeyData?.eligibleMatches || 6}</Text>
                    <Text style={styles.journeyCellLabel}>Matches</Text>
                  </View>
                </View>
                <Text style={styles.journeyInfoText}>
                  A strong match could move you into the top 100.
                </Text>
              </View>
            )}

            {/* Persistent Trio Selection Slots */}
            <TrioSelectionSlots
              selected={legacySelected}
              activePosition={currentPosFilter}
              onSelectSlot={(pos) => setStep(pos)}
            />

            {/* Position Selector tabs - Segmented Control */}
            <View style={styles.segmentContainer}>
              <TouchableOpacity
                style={[styles.segmentBtn, currentPosFilter === "ATT" && styles.segmentBtnActive]}
                onPress={() => setStep("ATT")}
              >
                <Text style={[styles.segmentBtnText, currentPosFilter === "ATT" && styles.segmentBtnActiveText]}>
                  Attacker
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.segmentBtn, currentPosFilter === "MID" && styles.segmentBtnActive]}
                onPress={() => setStep("MID")}
              >
                <Text style={[styles.segmentBtnText, currentPosFilter === "MID" && styles.segmentBtnActiveText]}>
                  Midfielder
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.segmentBtn, currentPosFilter === "DEF" && styles.segmentBtnActive]}
                onPress={() => setStep("DEF")}
              >
                <Text style={[styles.segmentBtnText, currentPosFilter === "DEF" && styles.segmentBtnActiveText]}>
                  Defender
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.stepIndicatorText}>
              STEP {currentPosFilter === "ATT" ? "1" : currentPosFilter === "MID" ? "2" : "3"} OF 3 · Choose {currentPosFilter === "ATT" ? "an attacker" : currentPosFilter === "MID" ? "a midfielder" : "a defender"}
            </Text>

            {/* List and Selector Details */}
            {loading ? (
              <View style={styles.loader}>
                <ActivityIndicator size="large" color={COLORS.green || "#2d653d"} />
              </View>
            ) : step === "REVIEW" ? (
              <View style={styles.reviewContainer}>
                <Text style={styles.reviewHeader}>Review & Lock Selection</Text>
                <Text style={styles.reviewSub}>Confirm your Spain matchday three selections.</Text>

                <View style={styles.reviewCard}>
                  <Text style={styles.reviewRole}>ATTACKER</Text>
                  <Text style={styles.reviewName}>{selectedATT?.player.displayName}</Text>
                  <Text style={styles.reviewRating}>
                    ★ {selectedATT?.tournament.tournamentRating?.toFixed(2) || "—"}
                  </Text>
                  <TouchableOpacity onPress={() => {
                    setPassportPlayerId(selectedATT!.player.id);
                    setStep("PASSPORT");
                  }}>
                    <Text style={styles.detailsLink}>Passport</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.reviewCard}>
                  <Text style={styles.reviewRole}>MIDFIELDER</Text>
                  <Text style={styles.reviewName}>{selectedMID?.player.displayName}</Text>
                  <Text style={styles.reviewRating}>
                    ★ {selectedMID?.tournament.tournamentRating?.toFixed(2) || "—"}
                  </Text>
                  <TouchableOpacity onPress={() => {
                    setPassportPlayerId(selectedMID!.player.id);
                    setStep("PASSPORT");
                  }}>
                    <Text style={styles.detailsLink}>Passport</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.reviewCard}>
                  <Text style={styles.reviewRole}>DEFENDER</Text>
                  <Text style={styles.reviewName}>{selectedDEF?.player.displayName}</Text>
                  <Text style={styles.reviewRating}>
                    ★ {selectedDEF?.tournament.tournamentRating?.toFixed(2) || "—"}
                  </Text>
                  <TouchableOpacity onPress={() => {
                    setPassportPlayerId(selectedDEF!.player.id);
                    setStep("PASSPORT");
                  }}>
                    <Text style={styles.detailsLink}>Passport</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={styles.lockBtn}
                  onPress={lockSelection}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.lockBtnText}>LOCK & COMMIT SELECTION</Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.listContainer}>
                {/* Sort Control */}
                <View style={styles.sortFilterSection}>
                  <Text style={styles.sectionLabel}>SORT BY</Text>
                  <View style={styles.pillsRow}>
                    <TouchableOpacity
                      style={[styles.pillBtn, sortMode === "recommended" && styles.pillBtnActive]}
                      onPress={() => setSortMode("recommended")}
                    >
                      <Text style={[styles.pillText, sortMode === "recommended" && styles.pillTextActive]}>Recommended</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.pillBtn, sortMode === "form" && styles.pillBtnActive]}
                      onPress={() => setSortMode("form")}
                    >
                      <Text style={[styles.pillText, sortMode === "form" && styles.pillTextActive]}>Form</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.pillBtn, sortMode === "rating" && styles.pillBtnActive]}
                      onPress={() => setSortMode("rating")}
                    >
                      <Text style={[styles.pillText, sortMode === "rating" && styles.pillTextActive]}>Rating</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.pillBtn, sortMode === "minutes" && styles.pillBtnActive]}
                      onPress={() => setSortMode("minutes")}
                    >
                      <Text style={[styles.pillText, sortMode === "minutes" && styles.pillTextActive]}>Minutes</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Roster Filter */}
                <View style={[styles.sortFilterSection, { marginTop: 8, marginBottom: 14 }]}>
                  <Text style={styles.sectionLabel}>SHOWING</Text>
                  <View style={styles.pillsRow}>
                    <TouchableOpacity
                      style={[styles.pillBtn, rosterFilter === "all" && styles.pillBtnActive]}
                      onPress={() => setRosterFilter("all")}
                    >
                      <Text style={[styles.pillText, rosterFilter === "all" && styles.pillTextActive]}>All</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.pillBtn, rosterFilter === "starters" && styles.pillBtnActive]}
                      onPress={() => setRosterFilter("starters")}
                    >
                      <Text style={[styles.pillText, rosterFilter === "starters" && styles.pillTextActive]}>Starters</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.pillBtn, rosterFilter === "substitutes" && styles.pillBtnActive]}
                      onPress={() => setRosterFilter("substitutes")}
                    >
                      <Text style={[styles.pillText, rosterFilter === "substitutes" && styles.pillTextActive]}>Substitutes</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {starters.length > 0 ? (
                  <>
                    <Text style={styles.rosterHeading}>STARTING XI</Text>
                    {starters.map((item, index) => {
                      const isTopStar = sortMode === "recommended" && index === 0;
                      const reason = isTopStar ? "Best recent form" : undefined;
                      return (
                        <SelectablePlayerCard
                          key={item.player.id}
                          item={item}
                          isSelected={activeSelected?.player.id === item.player.id}
                          onSelect={handleSelectPlayer}
                          onOpenPreview={setPreviewPlayerId}
                          recommendationReason={reason}
                        />
                      );
                    })}
                  </>
                ) : null}

                {subs.length > 0 ? (
                  <>
                    <View style={styles.subWarningBanner}>
                      <Text style={styles.subWarningText}>
                        Substitutes receive a rating only if they enter the match.
                      </Text>
                    </View>
                    <Text style={[styles.rosterHeading, { marginTop: 8 }]}>OFFICIAL SUBSTITUTES</Text>
                    {subs.map((item, index) => {
                      const isTopStar = sortMode === "recommended" && index === 0 && starters.length === 0;
                      const reason = isTopStar ? "Super sub quality" : undefined;
                      return (
                        <SelectablePlayerCard
                          key={item.player.id}
                          item={item}
                          isSelected={activeSelected?.player.id === item.player.id}
                          onSelect={handleSelectPlayer}
                          onOpenPreview={setPreviewPlayerId}
                          recommendationReason={reason}
                        />
                      );
                    })}
                  </>
                ) : null}
              </View>
            )}
          </ScrollView>

          {/* Sticky selection dock at bottom */}
          <View style={styles.stickyDock}>
            <View style={styles.dockSummary}>
              <Text style={styles.dockTitle}>YOUR THREE</Text>
              <View style={styles.dockNamesRow}>
                <Text style={styles.dockName}>{selectedATT ? selectedATT.player.displayName.split(" ")[1] || selectedATT.player.displayName : "—"} (ATT)</Text>
                <Text style={styles.dockName}>{selectedMID ? selectedMID.player.displayName.split(" ")[1] || selectedMID.player.displayName : "—"} (MID)</Text>
                <Text style={styles.dockName}>{selectedDEF ? selectedDEF.player.displayName.split(" ")[1] || selectedDEF.player.displayName : "—"} (DEF)</Text>
              </View>
            </View>
            {selectedATT && selectedMID && selectedDEF ? (
              <TouchableOpacity
                style={styles.dockCtaBtn}
                onPress={() => setStep("REVIEW")}
              >
                <Text style={styles.dockCtaText}>Review & Lock</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.dockCtaBtn, styles.dockCtaDisabled]} disabled>
                <Text style={styles.dockCtaText}>Choose {!selectedATT ? "ATT" : !selectedMID ? "MID" : "DEF"}</Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      )}

      {/* Quick Player Preview Bottom Sheet Modal */}
      <PlayerProfileModal
        playerId={previewPlayerId}
        visible={previewPlayerId !== null}
        onClose={() => setPreviewPlayerId(null)}
        onSelectPlayer={(id) => {
          const item = roster.find(p => p.player.id === id);
          if (item) handleSelectPlayer(item);
        }}
        onViewPassport={(id) => {
          setPassportPlayerId(id);
          setStep("PASSPORT");
        }}
        isDraftSelected={activeSelected?.player.id === previewPlayerId}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeContainer: {
    flex: 1,
    backgroundColor: COLORS.background || "#fbfbfa",
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line || "#e2e8f0",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#ffffff",
  },
  headerLeft: {
    flex: 1,
  },
  backBtnText: {
    fontSize: 12,
    color: COLORS.green || "#2d653d",
    fontWeight: "800",
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: COLORS.ink || "#0f172a",
  },
  headerMeta: {
    fontSize: 10,
    color: COLORS.muted || "#64748b",
    marginTop: 2,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  headerRight: {
    alignItems: "flex-end",
  },
  countdown: {
    fontSize: 10,
    fontWeight: "800",
    color: "#b91c1c",
    letterSpacing: 0.5,
  },
  scrollContent: {
    paddingBottom: 110,
  },
  emotionalChoiceContainer: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  emotionalChoiceTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: COLORS.ink || "#0f172a",
    textAlign: "center",
    marginBottom: 8,
  },
  emotionalChoiceSubtitle: {
    fontSize: 14,
    color: COLORS.muted || "#64748b",
    textAlign: "center",
    marginBottom: 32,
    lineHeight: 20,
    paddingHorizontal: 20,
  },
  emotionalCardsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    gap: 16,
  },
  emotionalCard: {
    flex: 1,
    backgroundColor: COLORS.paper || "#ffffff",
    borderWidth: 1.5,
    borderColor: COLORS.line || "#e2e8f0",
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  emotionalFlag: {
    fontSize: 48,
    marginBottom: 12,
  },
  emotionalTeamName: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.ink || "#0f172a",
    marginBottom: 4,
  },
  emotionalSupporters: {
    fontSize: 11,
    color: COLORS.muted || "#64748b",
    fontWeight: "600",
  },
  journeyStrip: {
    backgroundColor: "rgba(45, 101, 61, 0.04)",
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: "rgba(45, 101, 61, 0.15)",
  },
  journeyLabel: {
    fontSize: 8,
    fontWeight: "800",
    color: COLORS.green || "#2d653d",
    letterSpacing: 0.5,
  },
  journeyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  journeyCell: {
    flex: 1,
  },
  journeyCellLabel: {
    fontSize: 8,
    color: COLORS.muted || "#64748b",
    fontWeight: "600",
    marginTop: 2,
  },
  journeyInfoText: {
    fontSize: 10,
    color: COLORS.muted || "#64748b",
    marginTop: 8,
    fontStyle: "italic",
  },
  segmentContainer: {
    flexDirection: "row",
    backgroundColor: "rgba(0,0,0,0.03)",
    borderRadius: 8,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 3,
  },
  segmentBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: 6,
  },
  segmentBtnActive: {
    backgroundColor: COLORS.green || "#2d653d",
  },
  segmentBtnText: {
    fontSize: 12,
    fontWeight: "750",
    color: COLORS.muted || "#64748b",
  },
  segmentBtnActiveText: {
    color: "#ffffff",
    fontWeight: "800",
  },
  stepIndicatorText: {
    fontSize: 10,
    fontWeight: "800",
    color: COLORS.green || "#2d653d",
    marginHorizontal: 16,
    marginTop: 10,
    textAlign: "center",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  loader: {
    paddingVertical: 80,
    alignItems: "center",
  },
  listContainer: {
    paddingHorizontal: 16,
    marginTop: 16,
  },
  rosterHeading: {
    fontSize: 10,
    fontWeight: "850",
    color: COLORS.ink || "#0f172a",
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  subWarningBanner: {
    backgroundColor: "rgba(245, 158, 11, 0.05)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.15)",
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  subWarningText: {
    fontSize: 10,
    color: "#d97706",
    fontWeight: "700",
    textAlign: "center",
  },
  reviewContainer: {
    paddingHorizontal: 16,
    marginTop: 20,
  },
  reviewHeader: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.ink || "#0f172a",
    textAlign: "center",
  },
  reviewSub: {
    fontSize: 12,
    color: COLORS.muted || "#64748b",
    textAlign: "center",
    marginTop: 4,
    marginBottom: 20,
  },
  reviewCard: {
    backgroundColor: COLORS.paper || "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.line || "#e2e8f0",
    padding: 16,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  reviewRole: {
    fontSize: 9,
    fontWeight: "800",
    color: COLORS.muted || "#64748b",
    width: 80,
  },
  reviewName: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.ink || "#0f172a",
    flex: 1,
  },
  reviewRating: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.green || "#2d653d",
    marginRight: 12,
  },
  detailsLink: {
    fontSize: 10,
    fontWeight: "800",
    color: COLORS.green || "#2d653d",
  },
  lockBtn: {
    backgroundColor: COLORS.green || "#2d653d",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 12,
  },
  lockBtnText: {
    fontSize: 13,
    fontWeight: "900",
    color: "#ffffff",
    letterSpacing: 0.5,
  },
  stickyDock: {
    position: "absolute",
    bottom: -40,
    left: 0,
    right: 0,
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: COLORS.line || "#e2e8f0",
    paddingTop: 14,
    paddingHorizontal: 14,
    paddingBottom: 54,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 999,
  },
  dockSummary: {
    flex: 1,
  },
  dockTitle: {
    fontSize: 8,
    fontWeight: "800",
    color: COLORS.muted || "#64748b",
    letterSpacing: 0.5,
  },
  dockNamesRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  dockName: {
    fontSize: 11,
    fontWeight: "750",
    color: COLORS.ink || "#0f172a",
  },
  dockCtaBtn: {
    backgroundColor: COLORS.green || "#2d653d",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  dockCtaDisabled: {
    backgroundColor: "rgba(0,0,0,0.06)",
  },
  dockCtaText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#ffffff",
  },
  boldText: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.ink || "#0f172a",
  },
  supportCollapsed: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: COLORS.paper || "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.line || "#e2e8f0",
    borderRadius: 12,
    padding: 12,
  },
  supportCollapsedText: {
    fontSize: 13,
    color: COLORS.ink || "#0f172a",
  },
  changeLink: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.green || "#2d653d",
  },
  sortFilterSection: {
    marginHorizontal: 16,
    marginTop: 10,
  },
  sectionLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: COLORS.muted || "#64748b",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  pillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pillBtn: {
    backgroundColor: "rgba(0,0,0,0.03)",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pillBtnActive: {
    backgroundColor: COLORS.green || "#2d653d",
  },
  pillText: {
    fontSize: 11,
    fontWeight: "750",
    color: COLORS.muted || "#64748b",
  },
  pillTextActive: {
    color: "#ffffff",
    fontWeight: "800",
  },
  continuityCard: {
    backgroundColor: "rgba(21, 61, 46, 0.04)",
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: "rgba(21, 61, 46, 0.15)",
  },
  continuityEyebrow: {
    fontSize: 9,
    fontWeight: "900",
    color: COLORS.green || "#2d653d",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  continuityMatch: {
    fontSize: 16,
    fontWeight: "900",
    color: COLORS.ink || "#0f172a",
  },
  continuityStage: {
    fontSize: 11,
    color: COLORS.muted || "#64748b",
    fontWeight: "600",
    marginTop: 2,
  },
  continuityDivider: {
    height: 1,
    backgroundColor: COLORS.line || "#e2e8f0",
    marginVertical: 12,
  },
  continuityLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: COLORS.muted || "#64748b",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  continuityDetail: {
    fontSize: 12,
    color: COLORS.ink || "#0f172a",
    fontWeight: "600",
    marginTop: 2,
  },
  continuityCta: {
    fontSize: 11,
    fontWeight: "750",
    color: COLORS.green || "#2d653d",
    marginTop: 14,
    fontStyle: "italic",
  },
  successText: {
    color: COLORS.successGreen || "#2D653D",
    fontWeight: "800",
  },
});
