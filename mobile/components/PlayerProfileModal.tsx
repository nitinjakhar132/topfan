import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { PlayerPassportResponse } from "../lib/player-repository/types";
import { SpiderChart } from "./SpiderChart";
import { PlayerTraitChip } from "./PlayerTraitChip";
import { COLORS } from "../theme/colors";

interface PlayerProfileModalProps {
  playerId: string | null;
  visible: boolean;
  onClose: () => void;
  onSelectPlayer?: (playerId: string) => void;
  onViewPassport?: (playerId: string) => void;
  isDraftSelected?: boolean;
}

export const PlayerProfileModal: React.FC<PlayerProfileModalProps> = ({
  playerId,
  visible,
  onClose,
  onSelectPlayer,
  onViewPassport,
  isDraftSelected = false,
}) => {
  const [loading, setLoading] = useState(false);
  const [passport, setPassport] = useState<PlayerPassportResponse | null>(null);

  useEffect(() => {
    if (visible && playerId) {
      fetchPassport();
    } else {
      setPassport(null);
    }
  }, [visible, playerId]);

  const fetchPassport = async () => {
    setLoading(true);
    try {
      const response = await fetch(`http://localhost:3000/api/data/players/${playerId}?competitionId=72`);
      const data = await response.json();
      setPassport(data);
    } catch (e) {
      console.error("[Modal Passport Loader] Error loading player profile:", e);
    } finally {
      setLoading(false);
    }
  };

  if (!visible || !playerId) return null;

  const rating = passport?.tournament?.minutesWeightedRating ?? passport?.tournament?.simpleAverageRating ?? null;
  const showDnpWarning = passport?.tournament?.sampleQuality === "none";

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
      >
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          {/* Close button */}
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onClose}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={20} color="#000000" />
          </TouchableOpacity>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.green || "#2d653d"} />
            </View>
          ) : passport ? (
            <ScrollView contentContainerStyle={styles.scrollContent}>
              {/* Header Hero */}
              <View style={styles.hero}>
                <View style={styles.shirtNumberBadge}>
                  <Text style={styles.shirtNumberText}>
                    {passport.player.shirtNumber ?? "—"}
                  </Text>
                </View>
                <View style={styles.heroInfo}>
                  <Text style={styles.playerName}>{passport.player.displayName}</Text>
                  <Text style={styles.playerMeta}>
                    {passport.player.position} · {passport.tournament?.appearances ?? 0} Apps
                  </Text>
                </View>
                <View style={styles.ratingCol}>
                  <Text style={styles.ratingDigit}>
                    {rating ? rating.toFixed(2) : "—"}
                  </Text>
                  <Text style={styles.ratingLabel}>IMPACT RATING</Text>
                </View>
              </View>

              {/* Ranks Row */}
              <View style={styles.ranksRow}>
                {passport.tournament?.positionRank ? (
                  <View style={styles.rankBox}>
                    <Text style={styles.rankVal}>#{passport.tournament.positionRank}</Text>
                    <Text style={styles.rankLbl}>Pos Rank</Text>
                  </View>
                ) : null}
                {passport.tournament?.teamRank ? (
                  <View style={styles.rankBox}>
                    <Text style={styles.rankVal}>#{passport.tournament.teamRank}</Text>
                    <Text style={styles.rankLbl}>Team Rank</Text>
                  </View>
                ) : null}
              </View>

              {/* Summary Stats grid */}
              <View style={styles.statsGrid}>
                <View style={styles.statBox}>
                  <Text style={styles.statValue}>{passport.tournament?.appearances ?? 0}</Text>
                  <Text style={styles.statLabel}>Apps</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={styles.statValue}>{passport.tournament?.starts ?? 0}</Text>
                  <Text style={styles.statLabel}>Starts</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={styles.statValue}>{passport.tournament?.totalMinutes ?? 0}</Text>
                  <Text style={styles.statLabel}>Min</Text>
                </View>
              </View>

              {/* Traits List */}
              {passport.traits.length > 0 ? (
                <View style={styles.traitsSection}>
                  <Text style={styles.sectionTitle}>PLAYER TRAITS</Text>
                  <View style={styles.traitsRow}>
                    {passport.traits.map((t, idx) => (
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

              {/* Spider Chart Profile */}
              <View style={styles.spiderSection}>
                <Text style={styles.sectionTitle}>RADAR PERFORMANCE PROFILE</Text>
                {passport.spider ? (
                  <SpiderChart
                    form={passport.spider.form}
                    impact={passport.spider.impact}
                    threat={passport.spider.threat}
                    bigMoments={passport.spider.bigMoments}
                    reliability={passport.spider.reliability}
                    discipline={passport.spider.discipline}
                    size={220}
                  />
                ) : (
                  <Text style={styles.noData}>Early tournament sample - radar not available.</Text>
                )}
              </View>

              {/* Warning/Provisional badge */}
              {showDnpWarning ? (
                <View style={styles.warningBox}>
                  <Text style={styles.warningText}>
                    ⚠️ Early stats: Player has not completed enough match minutes.
                  </Text>
                </View>
              ) : null}

              {/* Actions Section */}
              <View style={styles.buttonRow}>
                {onViewPassport ? (
                  <TouchableOpacity
                    style={styles.journeyBtn}
                    onPress={() => {
                      onClose();
                      onViewPassport(passport.player.id);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.journeyBtnText}>View Full Journey</Text>
                  </TouchableOpacity>
                ) : null}

                {onSelectPlayer ? (
                  <TouchableOpacity
                    style={[styles.draftBtn, isDraftSelected && styles.draftSelectedBtn]}
                    onPress={() => {
                      onClose();
                      onSelectPlayer(passport.player.id);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.draftBtnText, isDraftSelected && styles.draftSelectedText]}>
                      {isDraftSelected ? "Selected ✓" : `Select ${passport.player.displayName.split(" ")[1] || ""}`}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </ScrollView>
          ) : (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>Could not load player profile passport details.</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(10, 20, 14, 0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: COLORS.background || "#fbfbfa",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "85%",
    paddingTop: 16,
    position: "relative",
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  closeBtn: {
    position: "absolute",
    right: 16,
    top: 16,
    backgroundColor: "rgba(0, 0, 0, 0.05)",
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
  loadingContainer: {
    paddingVertical: 80,
    alignItems: "center",
    justifyContent: "center",
  },
  errorContainer: {
    paddingVertical: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    fontSize: 12,
    color: "#b91c1c",
    fontWeight: "600",
  },
  hero: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    marginBottom: 16,
  },
  shirtNumberBadge: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: "rgba(0, 0, 0, 0.05)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  shirtNumberText: {
    fontSize: 16,
    fontWeight: "900",
    color: COLORS.primary || "#2d653d",
  },
  heroInfo: {
    flex: 1,
  },
  playerName: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.ink || "#0f172a",
  },
  playerMeta: {
    fontSize: 11,
    color: COLORS.muted || "#64748b",
    marginTop: 2,
  },
  ratingCol: {
    alignItems: "flex-end",
    marginRight: 32, // clear room for close button
  },
  ratingDigit: {
    fontSize: 20,
    fontWeight: "900",
    color: COLORS.green || "#2d653d",
  },
  ratingLabel: {
    fontSize: 7,
    fontWeight: "700",
    color: COLORS.muted || "#64748b",
    letterSpacing: 0.5,
    marginTop: 1,
  },
  ranksRow: {
    flexDirection: "row",
    marginBottom: 16,
  },
  rankBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(45, 101, 61, 0.05)",
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginRight: 8,
  },
  rankVal: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.green || "#2d653d",
  },
  rankLbl: {
    fontSize: 9,
    color: COLORS.muted || "#64748b",
    fontWeight: "600",
    marginLeft: 4,
  },
  statsGrid: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: COLORS.line || "#e2e8f0",
    borderRadius: 12,
    backgroundColor: COLORS.paper || "#ffffff",
    overflow: "hidden",
    marginBottom: 16,
  },
  statBox: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRightWidth: 1,
    borderRightColor: COLORS.line || "#e2e8f0",
  },
  statValue: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.ink || "#0f172a",
  },
  statLabel: {
    fontSize: 8,
    color: COLORS.muted || "#64748b",
    marginTop: 2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  traitsSection: {
    marginBottom: 16,
  },
  traitsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 6,
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.8,
    color: COLORS.muted || "#64748b",
    marginBottom: 6,
  },
  spiderSection: {
    alignItems: "center",
    marginBottom: 20,
    backgroundColor: COLORS.paper || "#ffffff",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.line || "#e2e8f0",
  },
  noData: {
    fontSize: 10,
    color: COLORS.muted || "#64748b",
    fontStyle: "italic",
    paddingVertical: 20,
  },
  warningBox: {
    backgroundColor: "rgba(245, 158, 11, 0.05)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.15)",
    borderRadius: 8,
    padding: 10,
    marginBottom: 20,
  },
  warningText: {
    fontSize: 10,
    color: "#d97706",
    fontWeight: "600",
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  journeyBtn: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.05)",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    marginRight: 8,
  },
  journeyBtnText: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.ink || "#0f172a",
  },
  draftBtn: {
    flex: 1.2,
    backgroundColor: COLORS.green || "#2d653d",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  draftBtnText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#ffffff",
  },
  draftSelectedBtn: {
    backgroundColor: "rgba(45, 101, 61, 0.08)",
    borderWidth: 1,
    borderColor: COLORS.green || "#2d653d",
  },
  draftSelectedText: {
    color: COLORS.green || "#2d653d",
  },
});
