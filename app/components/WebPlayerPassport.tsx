"use client";

import { useEffect, useState } from "react";
import { PlayerPassportResponse } from "@/lib/player-repository/types";
import { COLORS } from "@/mobile/theme/colors";

interface WebPlayerPassportProps {
  playerId: string;
  wallet?: string;
  onClose: () => void;
}

export function WebPlayerPassport({ playerId, wallet, onClose }: WebPlayerPassportProps) {
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
      const response = await fetch(`/api/data/players/${playerId}?competitionId=72${walletParam}`);
      const data = await response.json();
      setPassport(data);
    } catch (e) {
      console.error("[Web Passport] Error loading player passport:", e);
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
      const response = await fetch(`/api/data/players/${playerId}/matches/${fixtureId}`);
      const data = await response.json();
      setMatchDetails((prev) => ({ ...prev, [fixtureId]: data }));
      setExpandedMatchId(fixtureId);
    } catch (e) {
      console.error("[Web Passport] Error loading match details:", e);
    }
  };

  if (loading) {
    return (
      <div style={styles.loaderContainer}>
        <div className="spinner"></div>
        <p style={{ marginTop: "12px", color: "var(--muted)" }}>Loading passport...</p>
      </div>
    );
  }

  if (!passport) {
    return (
      <div style={styles.errorContainer}>
        <p style={{ color: "#b91c1c" }}>Could not load player passport details.</p>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    );
  }

  const { player, tournament, spider, traits, matchHistory, personalHistory } = passport;
  const rating = tournament?.minutesWeightedRating ?? tournament?.simpleAverageRating ?? null;

  return (
    <div style={styles.overlay}>
      <div style={styles.container}>
        <div style={styles.header}>
          <h2>Player Passport</h2>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div style={styles.scrollContent}>
          {/* Identity Card */}
          <div style={styles.hero}>
            <div style={styles.shirtBadge}>{player.shirtNumber ?? "—"}</div>
            <div style={styles.identity}>
              <h3 style={{ margin: 0, fontSize: "18px" }}>{player.displayName}</h3>
              <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: "13px" }}>
                {player.position} · Team {player.teamId}
              </p>
            </div>
            <div style={styles.ratingCol}>
              <div style={styles.ratingDigit}>{rating ? rating.toFixed(2) : "—"}</div>
              <div style={styles.ratingLabel}>IMPACT RATING</div>
            </div>
          </div>

          {/* User Selection History */}
          {personalHistory && personalHistory.timesSelected > 0 ? (
            <div style={styles.journeyCard}>
              <div style={styles.sectionLabel}>YOUR JOURNEY WITH THIS PLAYER</div>
              <div style={styles.journeyGrid}>
                <div>
                  <div style={styles.journeyVal}>{personalHistory.timesSelected}</div>
                  <div style={styles.journeyLbl}>Selected</div>
                </div>
                <div>
                  <div style={styles.journeyVal}>
                    {personalHistory.averageRatingWhenSelected
                      ? personalHistory.averageRatingWhenSelected.toFixed(1)
                      : "—"}
                  </div>
                  <div style={styles.journeyLbl}>Avg Rating</div>
                </div>
                <div>
                  <div style={styles.journeyVal}>
                    {personalHistory.supporterPointsGenerated.toFixed(0)}
                  </div>
                  <div style={styles.journeyLbl}>Points Contrib</div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Traits Section */}
          {traits.length > 0 ? (
            <div style={styles.section}>
              <div style={styles.sectionTitle}>PLAYER TRAITS</div>
              <div style={styles.traitsRow}>
                {traits.map((t, idx) => (
                  <div
                    key={idx}
                    title={JSON.stringify(t.evidence)}
                    style={styles.traitChip}
                  >
                    {t.label.toUpperCase()}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Tournament stats summaries */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>TOURNAMENT SUMMARIES</div>
            <div style={styles.statsGrid}>
              <div style={styles.statBox}>
                <div style={styles.statVal}>{tournament?.appearances ?? 0}</div>
                <div style={styles.statLbl}>Apps</div>
              </div>
              <div style={styles.statBox}>
                <div style={styles.statVal}>{tournament?.starts ?? 0}</div>
                <div style={styles.statLbl}>Starts</div>
              </div>
              <div style={styles.statBox}>
                <div style={styles.statVal}>{tournament?.totalGoals ?? 0}</div>
                <div style={styles.statLbl}>Goals</div>
              </div>
              <div style={styles.statBox}>
                <div style={styles.statVal}>{tournament?.totalAssists ?? 0}</div>
                <div style={styles.statLbl}>Assists</div>
              </div>
              <div style={styles.statBox}>
                <div style={styles.statVal}>{(tournament?.totalYellowCards ?? 0) + (tournament?.totalRedCards ?? 0)}</div>
                <div style={styles.statLbl}>Cards</div>
              </div>
              <div style={{ ...styles.statBox, borderRight: "none" }}>
                <div style={styles.statVal}>{tournament?.totalMinutes ?? 0}</div>
                <div style={styles.statLbl}>Minutes</div>
              </div>
            </div>
          </div>

          {/* Match history list */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>MATCH HISTORY</div>
            {matchHistory.length > 0 ? (
              matchHistory.map((m) => {
                const isExpanded = expandedMatchId === m.fixtureId;
                const details = matchDetails[m.fixtureId];

                return (
                  <div key={m.fixtureId} style={styles.matchCard}>
                    <div style={styles.matchHeader} onClick={() => fetchMatchBreakdown(m.fixtureId)}>
                      <div>
                        <div style={styles.matchOpponent}>vs {m.opponent}</div>
                        <div style={styles.matchStage}>
                          {m.competitionStage?.toUpperCase() ?? "MATCH"} · {m.minutesPlayed} min
                        </div>
                      </div>
                      <div style={styles.matchRatingCol}>
                        <span style={styles.matchRating}>
                          {m.finalRating ? m.finalRating.toFixed(1) : "—"}
                        </span>
                        <span style={{ marginLeft: "8px" }}>{isExpanded ? "▲" : "▼"}</span>
                      </div>
                    </div>

                    {isExpanded && details ? (
                      <div style={styles.breakdown}>
                        <div style={styles.breakdownTitle}>IMPACT CONTRIBUTIONS</div>
                        {details.ratingDetails?.contributions?.map((c: any, index: number) => {
                          const sign = c.ratingDelta >= 0 ? "+" : "";
                          return (
                            <div key={index} style={styles.contribRow}>
                              <span>{c.key.toUpperCase()} (x{c.rawValue})</span>
                              <span style={{
                                color: c.ratingDelta >= 0 ? "var(--green)" : "#b91c1c",
                                fontWeight: "bold"
                              }}>
                                {sign}{c.ratingDelta.toFixed(2)}
                              </span>
                            </div>
                          );
                        })}

                        {/* Events list */}
                        {details.events?.length > 0 ? (
                          <div style={styles.timeline}>
                            <div style={styles.breakdownTitle}>MATCH TIMELINE</div>
                            {details.events.map((e: any, index: number) => (
                              <div key={index} style={styles.timelineItem}>
                                <span style={styles.timelineMin}>{e.matchMinute}'</span>
                                <span>
                                  {e.eventType.replace(/_/g, " ").toUpperCase()}
                                  {e.eventSubtype ? ` (${e.eventSubtype})` : ""}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <p style={{ color: "var(--muted)", fontStyle: "italic" }}>No finalized matches found.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  },
  container: {
    backgroundColor: "#fbfbfa",
    width: "480px",
    maxWidth: "95%",
    maxHeight: "85vh",
    borderRadius: "16px",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    boxShadow: "0 10px 25px rgba(0, 0, 0, 0.1)",
  },
  header: {
    padding: "16px 20px",
    borderBottom: "1px solid var(--border)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  closeBtn: {
    border: "none",
    background: "none",
    fontSize: "24px",
    cursor: "pointer",
    padding: "0",
    color: "var(--muted)",
  },
  scrollContent: {
    padding: "20px",
    overflowY: "auto",
    flex: 1,
  },
  loaderContainer: {
    padding: "100px 0",
    textAlign: "center",
  },
  errorContainer: {
    padding: "80px 20px",
    textAlign: "center",
  },
  hero: {
    display: "flex",
    alignItems: "center",
    backgroundColor: "var(--paper)",
    border: "1px solid var(--border)",
    borderRadius: "12px",
    padding: "16px",
    marginBottom: "20px",
  },
  shirtBadge: {
    width: "44px",
    height: "44px",
    borderRadius: "8px",
    backgroundColor: "rgba(0, 0, 0, 0.05)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginRight: "12px",
    fontWeight: "bold",
    color: "var(--primary)",
  },
  identity: {
    flex: 1,
  },
  ratingCol: {
    textAlign: "right",
  },
  ratingDigit: {
    fontSize: "22px",
    fontWeight: "bold",
    color: "var(--green)",
  },
  ratingLabel: {
    fontSize: "8px",
    fontWeight: "bold",
    color: "var(--muted)",
    marginTop: "2px",
  },
  journeyCard: {
    backgroundColor: "rgba(45, 101, 61, 0.04)",
    border: "1px solid rgba(45, 101, 61, 0.15)",
    borderRadius: "12px",
    padding: "16px",
    marginBottom: "20px",
  },
  sectionLabel: {
    fontSize: "8px",
    fontWeight: "bold",
    color: "var(--muted)",
    letterSpacing: "0.5px",
    marginBottom: "8px",
  },
  journeyGrid: {
    display: "flex",
    justifyContent: "space-between",
  },
  journeyVal: {
    fontSize: "14px",
    fontWeight: "bold",
    color: "var(--green)",
  },
  journeyLbl: {
    fontSize: "8px",
    color: "var(--muted)",
    marginTop: "2px",
  },
  section: {
    marginBottom: "20px",
  },
  sectionTitle: {
    fontSize: "9px",
    fontWeight: "bold",
    letterSpacing: "0.5px",
    color: "var(--muted)",
    marginBottom: "8px",
  },
  traitsRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
  },
  traitChip: {
    backgroundColor: "rgba(45, 101, 61, 0.06)",
    border: "1px solid rgba(45, 101, 61, 0.15)",
    borderRadius: "4px",
    padding: "2px 6px",
    fontSize: "9px",
    fontWeight: "bold",
    color: "var(--green)",
    cursor: "help",
  },
  statsGrid: {
    display: "flex",
    border: "1px solid var(--border)",
    borderRadius: "12px",
    backgroundColor: "var(--paper)",
    overflow: "hidden",
  },
  statBox: {
    flex: 1,
    padding: "10px 0",
    textAlign: "center",
    borderRight: "1px solid var(--border)",
  },
  statVal: {
    fontSize: "13px",
    fontWeight: "bold",
  },
  statLbl: {
    fontSize: "8px",
    color: "var(--muted)",
    textTransform: "uppercase",
    marginTop: "2px",
  },
  matchCard: {
    backgroundColor: "var(--paper)",
    border: "1px solid var(--border)",
    borderRadius: "10px",
    marginBottom: "8px",
    overflow: "hidden",
  },
  matchHeader: {
    padding: "12px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    cursor: "pointer",
  },
  matchOpponent: {
    fontSize: "12px",
    fontWeight: "bold",
  },
  matchStage: {
    fontSize: "9px",
    color: "var(--muted)",
    marginTop: "2px",
  },
  matchRatingCol: {
    display: "flex",
    alignItems: "center",
    fontSize: "12px",
  },
  matchRating: {
    fontWeight: "bold",
    color: "var(--green)",
  },
  breakdown: {
    padding: "12px",
    backgroundColor: "rgba(0, 0, 0, 0.01)",
    borderTop: "1px solid rgba(0, 0, 0, 0.04)",
  },
  breakdownTitle: {
    fontSize: "8px",
    fontWeight: "bold",
    color: "var(--muted)",
    marginBottom: "6px",
  },
  contribRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "3px 0",
    fontSize: "9px",
  },
  timeline: {
    marginTop: "10px",
    borderTop: "1px solid rgba(0, 0, 0, 0.04)",
    paddingTop: "6px",
  },
  timelineItem: {
    display: "flex",
    alignItems: "center",
    fontSize: "9px",
    padding: "2px 0",
  },
  timelineMin: {
    fontWeight: "bold",
    color: "var(--green)",
    width: "24px",
  },
};
