/**
 * ONE NATION — Live Match Screen Component (Phase 2)
 *
 * The hero screen of the product. Shows real-time TxLINE events processing
 * through the rating engine, with personalised narrator cards, opposition
 * benchmarks, Match Pulse, live leaderboard, phase badge, live clock,
 * replay speed controls, and final result card.
 *
 * Phase 2 additions:
 *   - Match Pulse bar (odds-derived momentum indicator)
 *   - Live clock ticker (1 min interval, live mode only)
 *   - Phase badge (1ST HALF / HT / 2ND HALF / ET / FT)
 *   - Leaderboard widget with rank movement
 *   - Working replay speed controls (reconnects SSE)
 *   - Final Result full-screen overlay card
 */

import { useEffect, useRef, useState, useCallback, useMemo, useReducer } from "react";
import type {
  ClientLiveEvent,
  NarratorCard,
  NormalizedMatchEvent,
  PlayerRatingUpdate,
  OppositionBenchmark,
  SerializableLiveFixtureState,
  MatchPhaseChange,
  FinalMatchState,
  ReplaySpeed,
  LivePlayerState,
  MatchPulseUpdate,
  MatchMapPlayer,
  MatchMapTeam,
  MatchMapMoment,
  MatchMapSnapshot,
  MatchMapRole,
} from "@/lib/live/types";
import { GAME_PHASE_NAMES, GAME_PHASE_CODES, isFinishedPhase, isLivePhase } from "@/lib/live/types";
import type { GamePhaseId } from "@/lib/live/types";

// ─── Props ──────────────────────────────────────────────────────────────────

type LiveMatchScreenProps = {
  fixtureId: string;
  wallet: string;
  onBack: () => void;
  getPlayerImageSrc: (player: { name?: string; displayName?: string }) => string;
};

// ─── Leaderboard State ───────────────────────────────────────────────────────

type LeaderboardState = {
  rank: number;
  prevRank: number;
  totalParticipants: number;
  trioTotal: number;
  movementLabel: string;
};

// ─── Client-side State ──────────────────────────────────────────────────────

type UserTrio = {
  attackerId: string;
  midfielderId: string;
  defenderId: string;
  teamId: string;
};

type LiveMatchState = {
  isConnected: boolean;
  mode: "live" | "replay" | "connecting";
  fixtureState: SerializableLiveFixtureState | null;
  playerRatings: Record<string, LivePlayerState>;
  benchmark: OppositionBenchmark | null;
  narratorCards: NarratorCard[];
  events: NormalizedMatchEvent[];
  ratingUpdates: PlayerRatingUpdate[];
  participant1Score: number;
  participant2Score: number;
  gamePhase: GamePhaseId;
  currentMinute: number;
  finalState: FinalMatchState | null;
  replaySpeed: ReplaySpeed;
  matchPulse: MatchPulseUpdate | null;
  leaderboard: LeaderboardState | null;
  showFinalCard: boolean;
  userTrio: UserTrio | null;
  keyMoments: MatchMapMoment[];
  keyMomentSnapshots: Record<string, MatchMapSnapshot>;
  playerStats: Record<string, any>;
};

const initialState: LiveMatchState = {
  isConnected: false,
  mode: "connecting",
  fixtureState: null,
  playerRatings: {},
  benchmark: null,
  narratorCards: [],
  events: [],
  ratingUpdates: [],
  participant1Score: 0,
  participant2Score: 0,
  gamePhase: 1 as GamePhaseId,
  currentMinute: 0,
  finalState: null,
  replaySpeed: 5,
  matchPulse: null,
  leaderboard: null,
  showFinalCard: false,
  userTrio: null,
  keyMoments: [],
  keyMomentSnapshots: {},
  playerStats: {},
};

// ─── Match Map Navigation State ──────────────────────────────────────────────

export type MatchTab = "Trio" | "Match Map" | "Moments" | "Feed";

export interface MatchMapState {
  activeTab: MatchTab;
  followLive: boolean;
  selectedMomentId: string | null;
  selectedPlayerId: string | null;
  benchOpen: boolean;
  activeTeamFilter: "both" | "supported" | "opposition";
}

export type MatchMapAction =
  | { type: "SET_TAB"; payload: MatchTab }
  | { type: "SELECT_MOMENT"; payload: string | null }
  | { type: "RETURN_TO_LIVE" }
  | { type: "SELECT_PLAYER"; payload: string | null }
  | { type: "TOGGLE_BENCH" }
  | { type: "SET_TEAM_FILTER"; payload: "both" | "supported" | "opposition" };

export const matchMapReducer = (state: MatchMapState, action: MatchMapAction): MatchMapState => {
  switch (action.type) {
    case "SET_TAB":
      return { ...state, activeTab: action.payload };
    case "SELECT_MOMENT":
      return {
        ...state,
        selectedMomentId: action.payload,
        followLive: action.payload === null,
      };
    case "RETURN_TO_LIVE":
      return {
        ...state,
        selectedMomentId: null,
        followLive: true,
      };
    case "SELECT_PLAYER":
      return { ...state, selectedPlayerId: action.payload };
    case "TOGGLE_BENCH":
      return { ...state, benchOpen: !state.benchOpen };
    case "SET_TEAM_FILTER":
      return { ...state, activeTeamFilter: action.payload };
    default:
      return state;
  }
};

// ─── Phase Badge Config ──────────────────────────────────────────────────────

const phaseBadgeConfig: Record<number, { label: string; className: string }> = {
  1:  { label: "NOT STARTED",  className: "phase-badge-ns" },
  2:  { label: "1ST HALF",     className: "phase-badge-live" },
  3:  { label: "HALF TIME",    className: "phase-badge-ht" },
  4:  { label: "2ND HALF",     className: "phase-badge-live" },
  5:  { label: "FULL TIME",    className: "phase-badge-ft" },
  6:  { label: "WAIT FOR ET",  className: "phase-badge-ht" },
  7:  { label: "ET 1ST HALF",  className: "phase-badge-et" },
  8:  { label: "ET HALF TIME", className: "phase-badge-ht" },
  9:  { label: "ET 2ND HALF",  className: "phase-badge-et" },
  10: { label: "AET",          className: "phase-badge-ft" },
  11: { label: "WAIT FOR PENS",className: "phase-badge-ht" },
  12: { label: "PENALTIES",    className: "phase-badge-et" },
  13: { label: "FULL TIME",    className: "phase-badge-ft" },
  14: { label: "INTERRUPTED",  className: "phase-badge-ns" },
  15: { label: "ABANDONED",    className: "phase-badge-ns" },
};

// ─── Component ──────────────────────────────────────────────────────────────

export function LiveMatchScreen({
  fixtureId,
  wallet,
  onBack,
  getPlayerImageSrc,
}: LiveMatchScreenProps) {
  const [state, setState] = useState<LiveMatchState>(initialState);
  const [mapState, dispatch] = useReducer(matchMapReducer, {
    activeTab: "Match Map",
    followLive: true,
    selectedMomentId: null,
    selectedPlayerId: null,
    benchOpen: false,
    activeTeamFilter: "both",
  });
  const [stageName, setStageName] = useState<string>("");
  const [goalsAndCards, setGoalsAndCards] = useState<NormalizedMatchEvent[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const narratorScrollRef = useRef<HTMLDivElement>(null);
  const clockIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [activeJourney, setActiveJourney] = useState<any>(null);

  // Fetch active journey state
  const reloadJourney = useCallback(() => {
    if (!wallet) return;
    fetch(`/api/journey/me?wallet=${wallet}`)
      .then(res => res.json())
      .then(data => {
        if (data && data.primaryJourney) {
          setActiveJourney(data.primaryJourney);
        }
      })
      .catch(err => console.error("[LiveMatchScreen] Error loading journey:", err));
  }, [wallet]);

  useEffect(() => {
    reloadJourney();
  }, [reloadJourney]);

  // ─── Clock Ticker ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (state.mode === "live" && isLivePhase(state.gamePhase)) {
      clockIntervalRef.current = setInterval(() => {
        setState((prev) => ({
          ...prev,
          currentMinute: prev.currentMinute > 0 ? prev.currentMinute + 1 : prev.currentMinute,
        }));
      }, 60000);
    } else {
      if (clockIntervalRef.current) {
        clearInterval(clockIntervalRef.current);
        clockIntervalRef.current = null;
      }
    }
    return () => {
      if (clockIntervalRef.current) {
        clearInterval(clockIntervalRef.current);
        clockIntervalRef.current = null;
      }
    };
  }, [state.mode, state.gamePhase]);

  // ─── SSE Connection ───────────────────────────────────────────────────────
  const connectToStream = useCallback(
    (url: string) => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.addEventListener("connection", (e) => {
        try {
          const parsed = JSON.parse(e.data) as ClientLiveEvent & { type: "connection" };
          const payload = (parsed as { payload?: { status?: string } }).payload;
          setState((prev) => ({
            ...prev,
            isConnected: true,
            mode: (payload?.status as "live" | "replay") ?? "replay",
          }));
        } catch {
          setState((prev) => ({ ...prev, isConnected: true, mode: "replay" }));
        }
      });

      es.addEventListener("fixture_snapshot", (e) => {
        try {
          const parsed = JSON.parse(e.data);
          const snapshot: SerializableLiveFixtureState = parsed.payload ?? parsed;
          setState((prev) => ({
            ...prev,
            fixtureState: snapshot,
            playerRatings: snapshot.players ?? {},
            participant1Score: snapshot.participant1Score ?? 0,
            participant2Score: snapshot.participant2Score ?? 0,
            gamePhase: snapshot.gamePhase ?? (1 as GamePhaseId),
            currentMinute: snapshot.currentMinute ?? prev.currentMinute,
            events: (snapshot.events && snapshot.events.length > 0) ? snapshot.events : prev.events,
          }));
        } catch (err) {
          console.warn("Failed to parse fixture_snapshot:", err);
        }
      });

      es.addEventListener("score_event", (e) => {
        try {
          const parsed = JSON.parse(e.data);
          const event: NormalizedMatchEvent = parsed.payload ?? parsed;

          if (event.action === "goal" || event.action === "yellow_card" || event.action === "red_card") {
            setGoalsAndCards((prev) => {
              if (prev.some((x) => x.seq === event.seq)) return prev;
              return [...prev, event];
            });
          }

          if (event.action === "goal" && event.isConfirmed) {
            setState((prev) => ({
              ...prev,
              participant1Score:
                event.participantId === "1" ? prev.participant1Score + 1 : prev.participant1Score,
              participant2Score:
                event.participantId === "2" ? prev.participant2Score + 1 : prev.participant2Score,
            }));
          }

          setState((prev) => {
            let inferredPhase = prev.gamePhase;
            const min = event.minute ?? 0;
            const act = (event.action || "").toLowerCase();

            if (prev.mode === "replay") {
              // Infer phase from minute for replay streams that don't emit phase_change events
              if (min > 0 && min <= 45) {
                inferredPhase = 2; // 1st Half
              } else if (min > 45 && min <= 90) {
                inferredPhase = 4; // 2nd Half
              } else if (min > 90 && min <= 105) {
                inferredPhase = 7; // ET 1st Half
              } else if (min > 105 && min <= 120) {
                inferredPhase = 9; // ET 2nd Half
              } else if (min > 120) {
                inferredPhase = 12; // Penalty shootout
              }
              // Action-based overrides (more specific than minute)
              if (act === "half_time" || act === "ht" || act === "half-time") {
                inferredPhase = 3; // HT
              } else if (act === "extra_time" || act === "et_start" || act === "waiting_for_et") {
                inferredPhase = 6; // Waiting for ET
              } else if (act === "et_half_time" || act === "et_ht") {
                inferredPhase = 8; // ET Half Time
              } else if (act === "penalty_shootout" || act === "penalties_start" || act === "waiting_for_pens") {
                inferredPhase = 11; // Waiting for Pens
              } else if (act === "finalised" || act === "ft" || act === "match_ended" || act === "finished") {
                // Determine correct finished state based on how far we got
                if (prev.gamePhase === 12 || prev.gamePhase === 11) {
                  inferredPhase = 13; // FT after Pens
                } else if (prev.gamePhase >= 6) {
                  inferredPhase = 10; // AET
                } else {
                  inferredPhase = 5; // Regular FT
                }
              }
            }
            return {
              ...prev,
              events: [...prev.events.slice(-100), event],
              currentMinute: event.minute ?? prev.currentMinute,
              gamePhase: inferredPhase,
            };
          });
        } catch { /* skip */ }
      });

      es.addEventListener("player_rating", (e) => {
        try {
          const parsed = JSON.parse(e.data);
          const update: PlayerRatingUpdate = parsed.payload ?? parsed;
          setState((prev) => {
            const updatedRatings = { ...prev.playerRatings };
            if (updatedRatings[update.playerId]) {
              updatedRatings[update.playerId] = {
                ...updatedRatings[update.playerId],
                rating: update.ratingAfter,
              };
            }
            return {
              ...prev,
              playerRatings: updatedRatings,
              ratingUpdates: [...prev.ratingUpdates.slice(-50), update],
            };
          });
        } catch { /* skip */ }
      });

      es.addEventListener("benchmark_update", (e) => {
        try {
          const parsed = JSON.parse(e.data);
          const benchmark: OppositionBenchmark = parsed.payload ?? parsed;
          setState((prev) => ({ ...prev, benchmark }));
        } catch { /* skip */ }
      });

      es.addEventListener("odds_pulse", (e) => {
        try {
          const parsed = JSON.parse(e.data);
          const pulse: MatchPulseUpdate = parsed.payload ?? parsed;
          setState((prev) => ({ ...prev, matchPulse: pulse }));
        } catch { /* skip */ }
      });

      es.addEventListener("leaderboard_update", (e) => {
        try {
          const parsed = JSON.parse(e.data);
          const update = parsed.payload ?? parsed;
          setState((prev) => ({
            ...prev,
            leaderboard: {
              rank: update.rank ?? update.currentRank ?? 0,
              prevRank: update.prevRank ?? update.previousRank ?? 0,
              totalParticipants: update.totalParticipants ?? update.totalEntrants ?? 1,
              trioTotal: update.trioTotal ?? 0,
              movementLabel: update.movementLabel ?? "",
            },
          }));
        } catch { /* skip */ }
      });

      es.addEventListener("phase_change", (e) => {
        try {
          const parsed = JSON.parse(e.data);
          const change: MatchPhaseChange = parsed.payload ?? parsed;
          setState((prev) => ({ ...prev, gamePhase: change.currentPhase }));
        } catch { /* skip */ }
      });

      es.addEventListener("narrator", (e) => {
        try {
          const parsed = JSON.parse(e.data);
          const card: NarratorCard = parsed.payload ?? parsed;
          setState((prev) => ({
            ...prev,
            narratorCards: [...prev.narratorCards.slice(-20), card],
          }));
          setTimeout(() => {
            narratorScrollRef.current?.scrollTo({
              top: narratorScrollRef.current.scrollHeight,
              behavior: "smooth",
            });
          }, 100);
        } catch { /* skip */ }
      });

      es.addEventListener("finalised", (e) => {
        try {
          const parsed = JSON.parse(e.data);
          const final: FinalMatchState = parsed.payload ?? parsed;
          setState((prev) => ({
            ...prev,
            finalState: final,
            participant1Score: final.participant1Score,
            participant2Score: final.participant2Score,
            gamePhase: final.phase,
            showFinalCard: prev.mode === "live",
            mode: prev.mode === "replay" ? "completed" : prev.mode,
          }));

          // Explicitly close EventSource on finalizing to prevent automatic browser reconnect loops
          if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
          }
          reloadJourney();
        } catch { /* skip */ }
      });

      es.addEventListener("heartbeat", () => { /* keep-alive */ });

      es.onerror = () => {
        setState((prev) => ({ ...prev, isConnected: false }));
      };
    },
    [] // no deps — connectToStream is stable
  );

  const startManualReplay = useCallback(() => {
    setState((prev) => ({
      ...prev,
      mode: "replay",
      gamePhase: 1 as GamePhaseId,
      currentMinute: 0,
      events: [],
      ratingUpdates: [],
      showFinalCard: false,
    }));
    setGoalsAndCards([]);

    const params = new URLSearchParams();
    if (wallet) params.set("wallet", wallet);
    params.set("speed", String(state.replaySpeed));

    connectToStream(`/api/live/fixtures/${fixtureId}/replay?${params}`);
  }, [fixtureId, wallet, state.replaySpeed, connectToStream]);

  // ─── Initial connection ───────────────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams();
    if (wallet) params.set("wallet", wallet);
    params.set("speed", String(state.replaySpeed));

    fetch(`/api/live/fixtures/${fixtureId}/snapshot?${params}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.fixture?.stage) {
          setStageName(data.fixture.stage);
        }
        if (data.goalsAndCards) {
          setGoalsAndCards(data.goalsAndCards);
        }

        // Store user's picked trio IDs from snapshot
        if (data.userTrio) {
          setState((prev) => ({ ...prev, userTrio: data.userTrio }));
        }

        // Phases 5 (FT), 10 (AET), 13 (FT after Pens) all mean the match is done
        const FINISHED_PHASES = new Set([5, 10, 13]);
        const snapshotPhase: number = data.state?.gamePhase ?? 0;
        const isMatchCompleted = data.state?.mode === "completed" || FINISHED_PHASES.has(snapshotPhase);
        // Determine sensible final minute for display based on how the match ended
        const finalMinute = snapshotPhase === 13 ? 0 : snapshotPhase === 10 ? 120 : 90;

        if (isMatchCompleted) {
          // completed match - load finished state without starting SSE stream
          setState((prev) => ({
            ...prev,
            fixtureState: data.state,
            playerRatings: data.state.players ?? {},
            participant1Score: data.state.participant1Score ?? 0,
            participant2Score: data.state.participant2Score ?? 0,
            gamePhase: (snapshotPhase || 5) as GamePhaseId,
            currentMinute: finalMinute,
            mode: "completed",
            events: data.events ?? [],
            isConnected: true,
            userTrio: data.userTrio ?? prev.userTrio,
            benchmark: data.benchmark ?? prev.benchmark,
            narratorCards: data.narratorCards ?? [],
            finalState: data.finalState ?? null,
            keyMoments: data.matchMap?.keyMoments ?? [],
            keyMomentSnapshots: data.matchMap?.keyMomentSnapshots ?? {},
            playerStats: Object.fromEntries((data.playerStats ?? []).map((s: any) => [s.playerId, s])),
          }));
          dispatch({ type: "SET_TAB", payload: "Trio" });
        } else {
          setState((prev) => ({
            ...prev,
            fixtureState: data.state,
            playerRatings: data.state?.players ?? {},
            participant1Score: data.state?.participant1Score ?? 0,
            participant2Score: data.state?.participant2Score ?? 0,
            gamePhase: data.state?.gamePhase ?? (1 as GamePhaseId),
            currentMinute: data.state?.currentMinute ?? 0,
            events: data.events ?? [],
            keyMoments: data.matchMap?.keyMoments ?? [],
            keyMomentSnapshots: data.matchMap?.keyMomentSnapshots ?? {},
            playerStats: Object.fromEntries((data.playerStats ?? []).map((s: any) => [s.playerId, s])),
          }));
          dispatch({ type: "SET_TAB", payload: "Match Map" });
          
          // ongoing or upcoming match - start automatic SSE stream
          if (data.hasReplayData) {
            connectToStream(`/api/live/fixtures/${fixtureId}/replay?${params}`);
          } else {
            connectToStream(`/api/live/fixtures/${fixtureId}/stream?${params}`);
          }
        }
      })
      .catch(() => {
        connectToStream(`/api/live/fixtures/${fixtureId}/stream?${params}`);
      });

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixtureId, wallet]);

  // ─── Replay speed change (reconnect) ─────────────────────────────────────
  const changeReplaySpeed = useCallback(
    (speed: ReplaySpeed) => {
      setState((prev) => ({ ...prev, replaySpeed: speed }));
      const params = new URLSearchParams();
      if (wallet) params.set("wallet", wallet);
      params.set("speed", String(speed));
      // Reset events for clean replay at new speed
      setState((prev) => ({ ...prev, events: [], narratorCards: [], ratingUpdates: [] }));
      connectToStream(`/api/live/fixtures/${fixtureId}/replay?${params}`);
    },
    [fixtureId, wallet, connectToStream]
  );

  // ─── Derived Data ─────────────────────────────────────────────────────────

  const participant1Name = state.fixtureState?.participant1 ?? "Team 1";
  const participant2Name = state.fixtureState?.participant2 ?? "Team 2";
  const phaseCode = GAME_PHASE_CODES[state.gamePhase] ?? "NS";
  const phaseName = GAME_PHASE_NAMES[state.gamePhase] ?? "Not Started";
  const phaseBadge = phaseBadgeConfig[state.gamePhase] ?? { label: phaseCode, className: "phase-badge-ns" };
  const isFinished = isFinishedPhase(state.gamePhase) || Boolean(state.finalState);
  const isActive = isLivePhase(state.gamePhase);

  // ─── Live/Replay Key Moments Mapping ─────────────────────────────────────
  useEffect(() => {
    if (state.mode === "completed" || state.events.length === 0) return;
    
    const lastEvent = state.events[state.events.length - 1];
    const momentId = `moment-${lastEvent.seq}`;
    
    // Avoid duplicate moments
    if (state.keyMoments.some(m => m.id === momentId)) return;

    const isGoal = lastEvent.action === "goal" || lastEvent.action === "own_goal";
    const isPenalty = lastEvent.action === "penalty";
    const isRed = lastEvent.action === "red_card" || lastEvent.action === "second_yellow_card";
    const isSub = lastEvent.action === "substitution";
    
    const isTrioPlayer = lastEvent.playerId ? (state.userTrio?.attackerId === lastEvent.playerId || state.userTrio?.midfielderId === lastEvent.playerId || state.userTrio?.defenderId === lastEvent.playerId) : false;
    
    const isYellow = lastEvent.action === "yellow_card";
    const isMeaningfulYellow = isYellow && (isTrioPlayer || (lastEvent.playerId && [state.benchmark?.bestATT?.playerId, state.benchmark?.bestMID?.playerId, state.benchmark?.bestDEF?.playerId].includes(lastEvent.playerId)));

    const isMeaningfulShot = lastEvent.action === "shot" && (lastEvent.outcome?.toLowerCase() === "ontarget" || lastEvent.outcome?.toLowerCase() === "woodwork") && isTrioPlayer;

    const isCurated = isGoal || isPenalty || isRed || isSub || isMeaningfulYellow || isMeaningfulShot;

    if (isCurated) {
      // Wait 100ms for rating updates and benchmarks to apply
      const timer = setTimeout(() => {
        setState((prev) => {
          if (prev.keyMoments.some(m => m.id === momentId)) return prev;

          const headline = lastEvent.action === "goal" ? (isTrioPlayer ? "YOUR TRIO SCORES! ⚽" : "GOAL! ⚽") : lastEvent.action.toUpperCase().replace(/_/g, " ");
          
          const ratingChanges = [];
          if (lastEvent.playerId) {
            const lastUpdate = prev.ratingUpdates
              .slice()
              .reverse()
              .find(u => u.playerId === lastEvent.playerId);
            if (lastUpdate) {
              ratingChanges.push({
                playerId: lastUpdate.playerId,
                before: lastUpdate.ratingBefore,
                after: lastUpdate.ratingAfter,
                delta: lastUpdate.delta,
              });
            } else {
              // Fallback delta calculation if SSE has lag
              const p = prev.playerRatings[lastEvent.playerId];
              if (p) {
                const deltas: Record<string, number> = {
                  goal: 0.8,
                  own_goal: -1.0,
                  yellow_card: -0.3,
                  red_card: -1.0,
                  second_yellow_card: -0.8,
                };
                const delta = deltas[lastEvent.action] ?? 0;
                ratingChanges.push({
                  playerId: lastEvent.playerId,
                  before: p.rating - delta,
                  after: p.rating,
                  delta: delta,
                });
              }
            }
          }

          const currentTrioTotal = Math.round(
            ((prev.playerRatings[prev.userTrio?.attackerId ?? ""]?.rating ?? 6.0) +
             (prev.playerRatings[prev.userTrio?.midfielderId ?? ""]?.rating ?? 6.0) +
             (prev.playerRatings[prev.userTrio?.defenderId ?? ""]?.rating ?? 6.0)) * 10
          ) / 10;

          const currentBenchmarkTotal = prev.benchmark?.benchmarkTotal ?? 18.0;
          const currentMatchIndex = currentBenchmarkTotal > 0 ? Math.round((currentTrioTotal / currentBenchmarkTotal) * 1000) / 10 : 100.0;

          const moment: MatchMapMoment = {
            id: momentId,
            sourceSequence: lastEvent.seq,
            minute: lastEvent.minute ?? null,
            label: `${lastEvent.minute ?? 0}'`,
            type: isGoal ? "goal" : isPenalty ? "penalty" : isRed ? "red_card" : isYellow ? "yellow_card" : isSub ? "substitution" : "match_index_change",
            headline,
            summary: prev.narratorCards[prev.narratorCards.length - 1]?.detail ?? null,
            affectedPlayerIds: ratingChanges.map(rc => rc.playerId),
            ratingChanges,
            trioBefore: currentTrioTotal,
            trioAfter: currentTrioTotal,
            benchmarkBefore: currentBenchmarkTotal,
            benchmarkAfter: currentBenchmarkTotal,
            matchIndexBefore: currentMatchIndex,
            matchIndexAfter: currentMatchIndex,
            snapshotId: momentId,
          };

          const snap = buildMatchMapSnapshotClient(
            momentId,
            lastEvent.minute ?? null,
            GAME_PHASE_NAMES[prev.gamePhase] ?? "Live",
            prev.participant1Score,
            prev.participant2Score,
            prev.fixtureState!,
            prev.playerRatings,
            prev.userTrio!,
            prev.benchmark ?? { bestATT: null, bestMID: null, bestDEF: null, benchmarkTotal: 18.0 },
          );

          return {
            ...prev,
            keyMoments: [...prev.keyMoments, moment],
            keyMomentSnapshots: {
              ...prev.keyMomentSnapshots,
              [momentId]: snap,
            },
          };
        });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [state.events.length]);

  const liveSnapshot = useMemo(() => {
    if (!state.fixtureState || !state.userTrio) return null;
    return buildMatchMapSnapshotClient(
      "live",
      state.currentMinute,
      GAME_PHASE_NAMES[state.gamePhase] ?? "Live",
      state.participant1Score,
      state.participant2Score,
      state.fixtureState,
      state.playerRatings,
      state.userTrio,
      state.benchmark ?? { bestATT: null, bestMID: null, bestDEF: null, benchmarkTotal: 18.0 },
    );
  }, [state.fixtureState, state.userTrio, state.currentMinute, state.gamePhase, state.participant1Score, state.participant2Score, state.playerRatings, state.benchmark]);

  const viewedSnapshot = useMemo(() => {
    if (!mapState.followLive && mapState.selectedMomentId && state.keyMomentSnapshots[mapState.selectedMomentId]) {
      return state.keyMomentSnapshots[mapState.selectedMomentId];
    }
    return liveSnapshot;
  }, [mapState.followLive, mapState.selectedMomentId, state.keyMomentSnapshots, liveSnapshot]);

  const userTrioPlayers = useMemo(() => {
    const players = Object.values(state.playerRatings);
    if (state.userTrio) {
      // Use actual picked player IDs
      const att = players.find((p) => p.playerId === state.userTrio!.attackerId) ?? null;
      const mid = players.find((p) => p.playerId === state.userTrio!.midfielderId) ?? null;
      const def = players.find((p) => p.playerId === state.userTrio!.defenderId) ?? null;
      return { att, mid, def };
    }
    // Fallback: pick first active player per position
    const att = players.find((p) => p.position === "ATT" && !p.isSubstitutedOut);
    const mid = players.find((p) => p.position === "MID" && !p.isSubstitutedOut);
    const def = players.find((p) => p.position === "DEF" && !p.isSubstitutedOut);
    return { att: att ?? null, mid: mid ?? null, def: def ?? null };
  }, [state.playerRatings, state.userTrio]);

  const userTrioTotal = useMemo(() => {
    const { att, mid, def } = userTrioPlayers;
    return Math.round(((att?.rating ?? 0) + (mid?.rating ?? 0) + (def?.rating ?? 0)) * 10) / 10;
  }, [userTrioPlayers]);

  const visibleFeedEvents = useMemo(() => {
    if (state.mode === "completed" || state.gamePhase === 5) {
      return state.events;
    }
    return state.events.filter((e) => (e.minute ?? 0) <= state.currentMinute);
  }, [state.events, state.currentMinute, state.mode, state.gamePhase]);

  const eventCount = visibleFeedEvents.length;

  // Deduplicate and filter goals/cards for displaying under teams
  const deduplicatedEvents = useMemo(() => {
    const result: NormalizedMatchEvent[] = [];
    
    // Sort events by sequence to keep chronological order
    const sorted = [...goalsAndCards].sort((a, b) => a.seq - b.seq);
    
    for (const evt of sorted) {
      // Find if we already have a similar event for the same team/action/minute (within 2 mins)
      const dupIndex = result.findIndex(r => 
        r.action === evt.action && 
        r.participantId === evt.participantId && 
        evt.minute !== undefined &&
        Math.abs((r.minute ?? 0) - evt.minute!) <= 2
      );
      
      if (dupIndex === -1) {
        result.push(evt);
      } else {
        // If the new event has a playerName but the existing one does not, replace it!
        if (evt.playerName && !result[dupIndex].playerName) {
          result[dupIndex] = evt;
        }
      }
    }
    return result;
  }, [goalsAndCards]);

  const visibleEvents = useMemo(() => {
    if (state.gamePhase === 1 && state.mode !== "completed") return [];
    
    return deduplicatedEvents.filter((evt) => {
      if (state.mode === "completed" || state.gamePhase === 5) return true;
      return (evt.minute ?? 0) <= state.currentMinute;
    }).sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0));
  }, [deduplicatedEvents, state.currentMinute, state.mode, state.gamePhase]);

  const homeEvents = useMemo(() => {
    return visibleEvents.filter((e) => e.participantId === "1" || e.teamId === state.fixtureState?.participant1Id);
  }, [visibleEvents, state.fixtureState]);

  const awayEvents = useMemo(() => {
    return visibleEvents.filter((e) => e.participantId === "2" || e.teamId === state.fixtureState?.participant2Id);
  }, [visibleEvents, state.fixtureState]);

  // Match Pulse fill widths
  const pulseP1Width = state.matchPulse?.quality === "live"
    ? state.matchPulse.participant1Outlook
    : 50;
  const pulseP2Width = state.matchPulse?.quality === "live"
    ? state.matchPulse.participant2Outlook
    : 50;
  const pulseShiftLabel = state.matchPulse?.shiftLabel ?? "";

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="screen enter live-match-screen">
      {/* ── Back Button ────────────────────────────────────────────── */}
      <button className="back" onClick={onBack}>← Back</button>

      {/* ── Mode Badge ─────────────────────────────────────────────── */}
      <div className="live-mode-badge">
        <span className={`mode-dot ${state.mode === "live" ? "mode-live" : state.mode === "replay" ? "mode-replay" : "mode-completed"}`} />
        <span className="mode-label">
          {state.mode === "live" ? "LIVE" : state.mode === "replay" ? "REPLAY" : state.mode === "completed" ? "COMPLETED" : "CONNECTING…"}
          {state.mode === "replay" && (
            <span className="replay-tag"> · Powered by archived TxLINE events</span>
          )}
        </span>
        {/* Replay Speed Controls */}
        {state.mode === "replay" && (
          <div className="replay-speed-controls">
            {([1, 5, 20] as ReplaySpeed[]).map((speed) => (
              <button
                key={speed}
                className={`speed-btn ${state.replaySpeed === speed ? "speed-active" : ""}`}
                onClick={() => changeReplaySpeed(speed)}
              >
                {speed}×
              </button>
            ))}
          </div>
        )}
        {/* Manual Replay Trigger */}
        {state.mode === "completed" && (
          <div className="completed-controls" style={{ display: "flex", gap: "8px" }}>
            <button className="manual-replay-btn" onClick={startManualReplay}>
              Replay Match ↺
            </button>
          </div>
        )}
      </div>

      {/* ── Match Header ────────────────────────────────────────────── */}
      <div className="live-match-header">
        {/* Stage Name */}
        {stageName && (
          <div className="live-match-stage">
            {stageName}
          </div>
        )}

        <div className="live-match-scoreboard">
          <div className="live-team live-team-home">
            <div className="live-team-name">{participant1Name}</div>
          </div>
          <div className="live-score-block">
            {/* Phase Badge */}
            <div className={`phase-badge ${phaseBadge.className}`}>
              {isActive && state.mode === "live" && (
                <span className="live-clock-pulse">●</span>
              )}
              {phaseBadge.label}
            </div>
            <div className="live-score">
              <span className="live-score-num">{state.participant1Score}</span>
              <span className="live-score-sep">–</span>
              <span className="live-score-num">{state.participant2Score}</span>
            </div>
            <div className="live-phase">
              {state.currentMinute > 0
                ? state.currentMinute > 90
                  ? `90+${state.currentMinute - 90}'`  // ET display: 90+1', 90+5', etc.
                  : `${state.currentMinute}'`
                : phaseName}
            </div>
          </div>
          <div className="live-team live-team-away">
            <div className="live-team-name">{participant2Name}</div>
          </div>
        </div>

        {/* Goals and Cards Timeline */}
        {(homeEvents.length > 0 || awayEvents.length > 0) && (
          <div className="match-events-timeline">
            <div className="events-column events-home">
              {homeEvents.map((evt) => (
                <div key={evt.seq} className="event-item">
                  <span className="event-detail">
                    {evt.playerName || (evt.action === "goal" ? "Goal" : evt.action === "red_card" ? "Red card" : "Yellow card")} {evt.minute}'
                  </span>
                  <span className="event-badge">
                    {evt.action === "goal" ? "⚽" : evt.action === "red_card" ? "🟥" : "🟨"}
                  </span>
                </div>
              ))}
            </div>
            <div className="events-center-divider" />
            <div className="events-column events-away">
              {awayEvents.map((evt) => (
                <div key={evt.seq} className="event-item">
                  <span className="event-badge">
                    {evt.action === "goal" ? "⚽" : evt.action === "red_card" ? "🟥" : "🟨"}
                  </span>
                  <span className="event-detail">
                    {evt.playerName || (evt.action === "goal" ? "Goal" : evt.action === "red_card" ? "Red card" : "Yellow card")} {evt.minute}'
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Match Pulse Bar — only shown during live matches ────────── */}
      {state.mode === "live" && (
        <div className="match-pulse-container">
          <div className="match-pulse-label">
            <span>Match Outlook</span>
            {state.matchPulse?.quality !== "live" && (
              <span className="pulse-unavailable">• data unavailable</span>
            )}
          </div>
          <div className="match-pulse-bar">
            <div
              className="pulse-fill pulse-fill-p1"
              style={{ width: `${pulseP1Width}%` }}
            />
            <div className="pulse-split-labels">
              <span>{participant1Name.split(" ")[0]}</span>
              <span>{pulseP1Width.toFixed(0)}% – {pulseP2Width.toFixed(0)}%</span>
              <span>{participant2Name.split(" ")[0]}</span>
            </div>
            <div
              className="pulse-fill pulse-fill-p2"
              style={{ width: `${pulseP2Width}%` }}
            />
          </div>
          {pulseShiftLabel && (
            <div className="match-pulse-shift">{pulseShiftLabel}</div>
          )}
        </div>
      )}

      {/* ── Match Tab Bar ─────────────────────────────────────────── */}
      <div className="match-tabs-bar" style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        background: "rgba(255,255,255,0.05)",
        borderRadius: "10px",
        padding: "4px",
        marginBottom: "16px",
        height: "44px",
        alignItems: "center"
      }}>
        {(["Trio", "Match Map", "Moments", "Feed"] as MatchTab[]).map((tab) => (
          <button
            key={tab}
            className={`match-tabs-btn ${mapState.activeTab === tab ? "active" : ""}`}
            style={{
              height: "36px",
              border: "none",
              borderRadius: "8px",
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer",
              background: mapState.activeTab === tab ? "rgba(16, 185, 129, 0.15)" : "transparent",
              color: mapState.activeTab === tab ? "var(--green)" : "#9ba3af",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
            onClick={() => dispatch({ type: "SET_TAB", payload: tab })}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── Summary metrics strip ───────────────────────────────────── */}
      <div className="match-map-summary-strip" style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: "12px",
        padding: "12px 6px",
        marginBottom: "16px",
        textAlign: "center"
      }}>
        <div>
          <div style={{ fontSize: "9px", color: "#9ca3af", fontWeight: 850, letterSpacing: "0.1em", marginBottom: "4px" }}>YOUR TRIO</div>
          <div style={{ fontSize: "18px", color: "var(--green)", fontWeight: 900 }}>
            {viewedSnapshot?.trioTotal?.toFixed(1) ?? "—"}
          </div>
        </div>
        <div style={{ borderLeft: "1px solid rgba(255,255,255,0.08)", borderRight: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize: "9px", color: "#9ca3af", fontWeight: 850, letterSpacing: "0.1em", marginBottom: "4px" }}>BEST OPPOSITION</div>
          <div style={{ fontSize: "18px", color: "#f59e0b", fontWeight: 900 }}>
            {viewedSnapshot?.oppositionBenchmarkTotal?.toFixed(1) ?? "—"}
          </div>
        </div>
        <div>
          <div style={{ fontSize: "9px", color: "#9ca3af", fontWeight: 850, letterSpacing: "0.1em", marginBottom: "4px" }}>MATCH INDEX</div>
          <div style={{ fontSize: "18px", color: "#10b981", fontWeight: 900 }}>
            {viewedSnapshot?.matchIndex?.toFixed(1) ?? "—"}
          </div>
        </div>
      </div>

      {/* ── Live Supporter Journey Strip ── */}
      {activeJourney && (
        <div style={{
          background: "rgba(16, 185, 129, 0.08)",
          border: "1px solid rgba(16, 185, 129, 0.2)",
          borderRadius: "10px",
          padding: "10px 12px",
          marginBottom: "16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}>
          <div>
            <span style={{ fontSize: "8px", fontWeight: "800", color: "#10b981", letterSpacing: "0.5px", textTransform: "uppercase", display: "block" }}>PROVISIONAL LIVE JOURNEY</span>
            <span style={{ fontSize: "12px", fontWeight: "800", color: "#fff" }}>
              Projected Score: <b style={{ color: "var(--green)" }}>{((activeJourney.totalJourneyScore || 0) + (viewedSnapshot?.matchIndex ?? 100.0)).toFixed(1)}</b>
            </span>
          </div>
          <div style={{ textAlign: "right" }}>
            <span style={{ fontSize: "12px", fontWeight: "800", color: "#fff", display: "block" }}>
              Live Rank: <b style={{ color: "var(--green)" }}>{state.leaderboard?.rank ? `#${state.leaderboard.rank}` : "—"}</b>
            </span>
            {state.leaderboard?.movementLabel && (
              <span style={{ fontSize: "9px", color: "var(--green)", fontWeight: "700" }}>{state.leaderboard.movementLabel}</span>
            )}
          </div>
        </div>
      )}

      {/* ── Tabbed Content ──────────────────────────────────────────── */}
      {mapState.activeTab === "Trio" && (
        <div className="live-trio-comparison">
          <div className="trio-section-title">
            <span>YOUR THREE</span>
            <span className="trio-total">{userTrioTotal.toFixed(1)}</span>
            <span>vs</span>
            <span className="trio-total opp-total">
              {state.benchmark?.benchmarkTotal?.toFixed(1) ?? "–"}
            </span>
            <span>BEST OF OPPOSITION</span>
          </div>

          <TrioRow
            label="ATT"
            userPlayer={userTrioPlayers.att}
            oppPlayer={state.benchmark?.bestATT ?? null}
            getPlayerImageSrc={getPlayerImageSrc}
            latestUpdate={[...state.ratingUpdates].reverse().find(
              (u) => u.playerId === userTrioPlayers.att?.playerId
            )}
          />
          <TrioRow
            label="MID"
            userPlayer={userTrioPlayers.mid}
            oppPlayer={state.benchmark?.bestMID ?? null}
            getPlayerImageSrc={getPlayerImageSrc}
            latestUpdate={[...state.ratingUpdates].reverse().find(
              (u) => u.playerId === userTrioPlayers.mid?.playerId
            )}
          />
          <TrioRow
            label="DEF"
            userPlayer={userTrioPlayers.def}
            oppPlayer={state.benchmark?.bestDEF ?? null}
            getPlayerImageSrc={getPlayerImageSrc}
            latestUpdate={[...state.ratingUpdates].reverse().find(
              (u) => u.playerId === userTrioPlayers.def?.playerId
            )}
          />

          {(() => {
            const trioDiff = userTrioTotal - (state.benchmark?.benchmarkTotal ?? 18.0);
            const verdict = trioDiff > 0 
              ? `Your Trio leads by ${trioDiff.toFixed(1)}` 
              : trioDiff < 0 
              ? `Best Opposition leads by ${Math.abs(trioDiff).toFixed(1)}` 
              : `Level at ${userTrioTotal.toFixed(1)}`;
            return (
              <div style={{
                textAlign: "center",
                marginTop: "16px",
                fontSize: "11px",
                fontWeight: 800,
                color: trioDiff > 0 ? "var(--green)" : trioDiff < 0 ? "#f59e0b" : "#9ca3af",
                background: "rgba(255,255,255,0.02)",
                padding: "10px",
                borderRadius: "8px",
                border: "1px dashed rgba(255,255,255,0.06)"
              }}>
                {verdict}
              </div>
            );
          })()}
        </div>
      )}

      {mapState.activeTab === "Match Map" && (
        <div className="match-map-tab-container">
          {/* Pitch */}
          <div className="match-map-pitch" style={{
            position: "relative",
            width: "100%",
            aspectRatio: "3/4",
            background: "#112918",
            borderRadius: "16px",
            border: "1px solid rgba(255,255,255,0.08)",
            overflow: "hidden",
            boxShadow: "inset 0 0 50px rgba(0,0,0,0.8)",
            marginBottom: "16px"
          }}>
            <div style={{ position: "absolute", inset: "0", border: "2px solid rgba(255,255,255,0.08)", pointerEvents: "none" }} />
            <div style={{ position: "absolute", left: "0", right: "0", top: "50%", height: "2px", background: "rgba(255,255,255,0.08)", pointerEvents: "none" }} />
            <div style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: "80px",
              height: "80px",
              borderRadius: "50%",
              border: "2px solid rgba(255,255,255,0.08)",
              transform: "translate(-50%, -50%)",
              pointerEvents: "none"
            }} />
            <div style={{
              position: "absolute",
              left: "50%",
              top: "0",
              width: "160px",
              height: "60px",
              border: "2px solid rgba(255,255,255,0.08)",
              borderTop: "none",
              transform: "translateX(-50%)",
              pointerEvents: "none"
            }} />
            <div style={{
              position: "absolute",
              left: "50%",
              bottom: "0",
              width: "160px",
              height: "60px",
              border: "2px solid rgba(255,255,255,0.08)",
              borderBottom: "none",
              transform: "translateX(-50%)",
              pointerEvents: "none"
            }} />

            {/* Pitch Labels */}
            <div style={{ position: "absolute", top: "14px", left: "50%", transform: "translateX(-50%)", fontSize: "9px", color: "rgba(255,255,255,0.2)", fontWeight: 800, letterSpacing: "0.1em", pointerEvents: "none" }}>
              {viewedSnapshot?.oppositionTeam?.teamName?.toUpperCase()}
            </div>
            <div style={{ position: "absolute", bottom: "14px", left: "50%", transform: "translateX(-50%)", fontSize: "9px", color: "rgba(255,255,255,0.2)", fontWeight: 800, letterSpacing: "0.1em", pointerEvents: "none" }}>
              {viewedSnapshot?.supportedTeam?.teamName?.toUpperCase()}
            </div>

            {/* Opposition Team Nodes */}
            {viewedSnapshot?.oppositionTeam?.activePlayers.map((player) => (
              <PlayerNodeComponent
                key={player.playerId}
                player={player}
                isOpposition={true}
                getPlayerImageSrc={getPlayerImageSrc}
                onClick={() => dispatch({ type: "SELECT_PLAYER", payload: player.playerId })}
              />
            ))}

            {/* Supported Team Nodes */}
            {viewedSnapshot?.supportedTeam?.activePlayers.map((player) => (
              <PlayerNodeComponent
                key={player.playerId}
                player={player}
                isOpposition={false}
                getPlayerImageSrc={getPlayerImageSrc}
                onClick={() => dispatch({ type: "SELECT_PLAYER", payload: player.playerId })}
              />
            ))}
          </div>

          {/* Scrubber */}
          <div className="match-moment-scrubber-wrapper" style={{ margin: "16px 0" }}>
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "10px",
              fontSize: "11px",
              fontWeight: 700
            }}>
              <span style={{ color: "#9ca3af" }}>
                {!mapState.followLive && mapState.selectedMomentId
                  ? `Viewing ${viewedSnapshot?.minute ? `${viewedSnapshot.minute}'` : viewedSnapshot?.phase}`
                  : "Live Pitch View"}
              </span>
              {!mapState.followLive && (
                <button
                  style={{
                    background: "rgba(16, 185, 129, 0.15)",
                    border: "none",
                    borderRadius: "6px",
                    color: "var(--green)",
                    padding: "4px 8px",
                    fontSize: "10px",
                    fontWeight: 800,
                    cursor: "pointer"
                  }}
                  onClick={() => dispatch({ type: "RETURN_TO_LIVE" })}
                >
                  {state.mode === "completed" ? "Return to FT" : "Return to Live"}
                </button>
              )}
            </div>

            <div className="match-moment-scrubber-strip" style={{
              display: "flex",
              gap: "12px",
              overflowX: "auto",
              padding: "6px 0",
              scrollbarWidth: "none",
            }}>
              {state.keyMoments.map((moment) => {
                const isActive = mapState.selectedMomentId === moment.id;
                const ringStyle = isActive ? "2px solid #10b981" : "1px solid rgba(255,255,255,0.1)";
                const bgStyle = isActive ? "rgba(16, 185, 129, 0.15)" : "rgba(255,255,255,0.03)";
                const textColor = isActive ? "var(--green)" : "#9ca3af";

                const icon = moment.type === "goal" ? "⚽" : moment.type === "red_card" ? "🟥" : moment.type === "yellow_card" ? "🟨" : moment.type === "substitution" ? "🔄" : "📍";

                return (
                  <button
                    key={moment.id}
                    onClick={() => dispatch({ type: "SELECT_MOMENT", payload: moment.id })}
                    style={{
                      flex: "none",
                      minWidth: "54px",
                      height: "44px",
                      borderRadius: "8px",
                      border: ringStyle,
                      background: bgStyle,
                      color: textColor,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      fontSize: "10px",
                      fontWeight: 800
                    }}
                    aria-label={`Inspect moment at ${moment.label}`}
                  >
                    <span>{icon}</span>
                    <span style={{ marginTop: "2px" }}>{moment.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bench Drawer */}
          <div className="match-map-bench-drawer" style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "12px",
            marginBottom: "16px",
            overflow: "hidden"
          }}>
            <button
              onClick={() => dispatch({ type: "TOGGLE_BENCH" })}
              style={{
                width: "100%",
                background: "rgba(255,255,255,0.02)",
                border: "none",
                padding: "12px 16px",
                fontSize: "12px",
                fontWeight: 800,
                color: "#fff",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                cursor: "pointer"
              }}
            >
              <span>Bench · {viewedSnapshot?.supportedTeam?.shortName} {viewedSnapshot?.supportedTeam?.benchPlayers.length} · {viewedSnapshot?.oppositionTeam?.shortName} {viewedSnapshot?.oppositionTeam?.benchPlayers.length}</span>
              <span>{mapState.benchOpen ? "▲" : "▼"}</span>
            </button>

            {mapState.benchOpen && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: "11px" }}>
                {/* Supported team bench */}
                <div style={{ padding: "8px", borderRight: "1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ fontWeight: 800, color: "var(--green)", marginBottom: "8px", fontSize: "10px" }}>
                    {viewedSnapshot?.supportedTeam?.teamName}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {viewedSnapshot?.supportedTeam?.benchPlayers.map((player) => (
                      <div key={player.playerId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
                        <span>
                          {player.shirtNumber ? `#${player.shirtNumber} ` : ""}{player.shortName} ({player.role})
                          {player.isUserTrio && <span style={{ color: "var(--green)", fontWeight: 900, display: "block", fontSize: "8px" }}>YOUR PICK</span>}
                        </span>
                        <span style={{
                          background: player.enteredMatch ? getRatingColor(player.currentRating) : "rgba(255,255,255,0.05)",
                          padding: "2px 4px",
                          borderRadius: "3px",
                          fontSize: "9px",
                          fontWeight: 900
                        }}>
                          {player.enteredMatch ? player.currentRating?.toFixed(1) : "DNP"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Opposition team bench */}
                <div style={{ padding: "8px" }}>
                  <div style={{ fontWeight: 800, color: "#f59e0b", marginBottom: "8px", fontSize: "10px" }}>
                    {viewedSnapshot?.oppositionTeam?.teamName}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {viewedSnapshot?.oppositionTeam?.benchPlayers.map((player) => (
                      <div key={player.playerId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
                        <span>
                          {player.shirtNumber ? `#${player.shirtNumber} ` : ""}{player.shortName} ({player.role})
                          {player.isOppositionBenchmark && <span style={{ color: "#f59e0b", fontWeight: 900, display: "block", fontSize: "8px" }}>BENCHMARK</span>}
                        </span>
                        <span style={{
                          background: player.enteredMatch ? getRatingColor(player.currentRating) : "rgba(255,255,255,0.05)",
                          padding: "2px 4px",
                          borderRadius: "3px",
                          fontSize: "9px",
                          fontWeight: 900
                        }}>
                          {player.enteredMatch ? player.currentRating?.toFixed(1) : "DNP"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Latest Moment Impact Card */}
          {viewedSnapshot?.latestMoment && (
            <button
              onClick={() => {
                dispatch({ type: "SET_TAB", payload: "Moments" });
                dispatch({ type: "SELECT_MOMENT", payload: viewedSnapshot.latestMoment?.id ?? null });
              }}
              style={{
                width: "100%",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: "12px",
                padding: "16px",
                textAlign: "left",
                cursor: "pointer",
                color: "#fff",
                display: "block",
                marginBottom: "16px",
                outline: "none"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <span style={{ fontSize: "9px", color: "#10b981", fontWeight: 850, letterSpacing: "0.15em" }}>
                  LATEST MOMENT
                </span>
                <span style={{ fontSize: "10px", color: "#9ca3af", fontWeight: 700 }}>
                  {viewedSnapshot.latestMoment.minute ? `${viewedSnapshot.latestMoment.minute}'` : ""}
                </span>
              </div>
              
              <div style={{ fontSize: "14px", fontWeight: 900, marginBottom: "12px", color: "#fff" }}>
                {viewedSnapshot.latestMoment.headline}
              </div>

              {/* Player Rating Change Section */}
              {viewedSnapshot.latestMoment.ratingChanges.slice(0, 1).map((rc) => {
                const p = state.playerRatings[rc.playerId];
                if (!p) return null;
                const isUser = state.userTrio?.attackerId === rc.playerId ||
                               state.userTrio?.midfielderId === rc.playerId ||
                               state.userTrio?.defenderId === rc.playerId;

                const ratingDelta = rc.delta ?? (rc.after - rc.before);
                const isPositive = ratingDelta > 0;
                const deltaColor = isPositive ? "#10b981" : "#ef4444";
                const deltaText = `${isPositive ? "+" : ""}${ratingDelta.toFixed(1)}`;

                return (
                  <div
                    key={rc.playerId}
                    style={{
                      border: isUser ? "1px solid rgba(16, 185, 129, 0.4)" : "1px solid rgba(255, 255, 255, 0.08)",
                      background: isUser ? "rgba(16, 185, 129, 0.08)" : "rgba(255, 255, 255, 0.02)",
                      padding: "10px 12px",
                      borderRadius: "8px",
                      marginBottom: "12px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center"
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 800, fontSize: "11px", color: isUser ? "#10b981" : "#fff" }}>
                        {p.playerName} {isUser && <span style={{ fontSize: "8px", background: "#10b981", color: "#000", padding: "1px 4px", borderRadius: "3px", marginLeft: "6px", verticalAlign: "middle" }}>YOUR TRIO</span>}
                      </div>
                      <div style={{ fontSize: "10px", color: "#9ca3af", marginTop: "2px" }}>
                        {p.position} · Rating Impact
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 850, fontSize: "12px" }}>
                        {rc.before?.toFixed(1)} <span style={{ color: "#9ca3af" }}>→</span> {rc.after?.toFixed(1)}
                      </div>
                      <div style={{ fontWeight: 900, fontSize: "11px", color: deltaColor, marginTop: "2px" }}>
                        {deltaText}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Trio and Match Index Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", fontSize: "11px" }}>
                <div style={{
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.06)",
                  padding: "8px 10px",
                  borderRadius: "6px"
                }}>
                  <div style={{ color: "#9ca3af", fontSize: "8px", fontWeight: 700, marginBottom: "4px" }}>
                    YOUR TRIO TOTAL
                  </div>
                  <div style={{ fontWeight: 800 }}>
                    {viewedSnapshot.latestMoment.trioBefore?.toFixed(1)} <span style={{ color: "#9ca3af" }}>→</span> {viewedSnapshot.latestMoment.trioAfter?.toFixed(1)}
                  </div>
                </div>

                <div style={{
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.06)",
                  padding: "8px 10px",
                  borderRadius: "6px"
                }}>
                  <div style={{ color: "#9ca3af", fontSize: "8px", fontWeight: 700, marginBottom: "4px" }}>
                    MATCH INDEX
                  </div>
                  <div style={{ fontWeight: 800 }}>
                    {viewedSnapshot.latestMoment.matchIndexBefore?.toFixed(1)} <span style={{ color: "#9ca3af" }}>→</span> {viewedSnapshot.latestMoment.matchIndexAfter?.toFixed(1)}
                  </div>
                </div>
              </div>
            </button>
          )}
        </div>
      )}

      {mapState.activeTab === "Moments" && (
        <div className="match-moments-timeline-tab" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {state.keyMoments.length === 0 && (
            <div style={{ textAlign: "center", color: "#9ca3af", fontSize: "12px", padding: "30px 10px" }}>
              No key moments curated yet.
            </div>
          )}
          {state.keyMoments.map((moment) => (
            <div
              key={moment.id}
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: "12px",
                padding: "16px",
                fontSize: "12px"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px", color: "var(--green)", fontWeight: 900 }}>
                <span>{moment.minute ? `${moment.minute}'` : ""} · {moment.type.toUpperCase()}</span>
                <span>{moment.label}</span>
              </div>
              <h3 style={{ fontSize: "14px", fontWeight: 800, margin: "0 0 6px", color: "#fff" }}>{moment.headline}</h3>
              {moment.summary && <p style={{ color: "#9ca3af", margin: "0 0 12px", lineHeight: "1.4" }}>{moment.summary}</p>}

              <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "8px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "11px", color: "#9ca3af" }}>
                <div>
                  Trio: {moment.trioBefore?.toFixed(1)} → <strong style={{ color: "#fff" }}>{moment.trioAfter?.toFixed(1)}</strong>
                </div>
                <div>
                  Index: {moment.matchIndexBefore?.toFixed(1)} → <strong style={{ color: "#fff" }}>{moment.matchIndexAfter?.toFixed(1)}</strong>
                </div>
              </div>

              <button
                onClick={() => {
                  dispatch({ type: "SELECT_MOMENT", payload: moment.id });
                  dispatch({ type: "SET_TAB", payload: "Match Map" });
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--green)",
                  fontWeight: 800,
                  fontSize: "11px",
                  cursor: "pointer",
                  marginTop: "12px",
                  padding: "0"
                }}
              >
                View on Match Map →
              </button>
            </div>
          ))}
        </div>
      )}

      {mapState.activeTab === "Feed" && (
        <div className="live-event-feed">
          <div className="event-feed-label">
            Event Feed <span className="event-count">{eventCount}</span>
          </div>
          <div className="event-feed-list">
            {visibleFeedEvents.slice(-15).reverse().map((event, i) => (
              <div
                key={`${event.seq}-${i}`}
                className={`event-row ${event.isConfirmed ? "" : "unconfirmed"}`}
              >
                <span className="event-minute">{event.minute ? `${event.minute}'` : "–"}</span>
                <span className={`event-action event-action-${event.action}`}>
                  {event.action.replace(/_/g, " ")}
                </span>
                {(event.playerName && event.playerName !== "Unknown") && (
                  <span className="event-player">{event.playerName}</span>
                )}
                {event.outcome && <span className="event-outcome">{event.outcome}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TxLINE Attribution ──────────────────────────────────────── */}
      <div className="live-attribution">
        World Cup Impact Rating — Derived from TxLINE events
      </div>

      {/* ── Match Player Sheet Modal Overlay ────────────────────────── */}
      {mapState.selectedPlayerId && (() => {
        const p = state.playerRatings[mapState.selectedPlayerId];
        if (!p) return null;
        const isSupported = p.participantId === (state.userTrio?.teamId === state.fixtureState?.participant1Id ? "1" : "2");
        const isTrio = isSupported && (state.userTrio?.attackerId === p.playerId || state.userTrio?.midfielderId === p.playerId || state.userTrio?.defenderId === p.playerId);
        const stats = state.playerStats?.[p.playerId];

        return (
          <div className="modal-backdrop" style={{
            position: "fixed",
            inset: "0",
            background: "rgba(0,0,0,0.6)",
            zIndex: 100,
            display: "flex",
            alignItems: "flex-end"
          }} onClick={() => dispatch({ type: "SELECT_PLAYER", payload: null })}>
            <div className="player-sheet" style={{
              width: "100%",
              background: "#0c1017",
              borderRadius: "20px 20px 0 0",
              padding: "24px",
              borderTop: "1px solid rgba(255,255,255,0.08)",
              color: "#fff"
            }} onClick={(e) => e.stopPropagation()}>
              <button
                className="sheet-close"
                onClick={() => dispatch({ type: "SELECT_PLAYER", payload: null })}
                style={{
                  position: "absolute",
                  right: "20px",
                  top: "20px",
                  background: "rgba(255,255,255,0.1)",
                  border: "none",
                  borderRadius: "50%",
                  width: "30px",
                  height: "30px",
                  color: "#fff",
                  cursor: "pointer",
                  display: "grid",
                  placeItems: "center"
                }}
              >
                ✕
              </button>

              <div style={{ display: "flex", gap: "16px", alignItems: "center", marginBottom: "20px" }}>
                <img
                  src={getPlayerImageSrc({ name: p.playerName })}
                  alt=""
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = "/players/default.png";
                  }}
                  style={{
                    width: "60px",
                    height: "60px",
                    borderRadius: "12px",
                    objectFit: "cover"
                  }}
                />
                <div>
                  <h2 style={{ fontSize: "18px", fontWeight: 800, margin: "0 0 4px" }}>{p.playerName}</h2>
                  <div style={{ fontSize: "11px", color: "#9ca3af" }}>
                    {isSupported ? "Supported Team" : "Opposition Team"} · {p.position} · Shirt #{p.shirtNumber ?? "—"}
                  </div>
                  {isTrio && (
                    <span style={{
                      background: "rgba(16, 185, 129, 0.15)",
                      color: "var(--green)",
                      fontSize: "9px",
                      fontWeight: 900,
                      borderRadius: "4px",
                      padding: "2px 6px",
                      marginTop: "4px",
                      display: "inline-block"
                    }}>
                      YOUR PICK
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "16px" }}>
                <div style={{
                  background: getRatingColor(p.rating),
                  borderRadius: "12px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "16px"
                }}>
                  <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.8)", fontWeight: 700, marginBottom: "4px" }}>RATING</span>
                  <span style={{ fontSize: "28px", fontWeight: 900 }}>{p.rating.toFixed(1)}</span>
                </div>

                <div style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: "12px",
                  padding: "12px",
                  fontSize: "11px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#9ca3af" }}>Minutes Played</span>
                    <strong>{stats?.minutes ?? "0"}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#9ca3af" }}>Goals / Assists</span>
                    <strong>{stats?.goals ?? "0"} / {stats?.assists ?? "0"}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#9ca3af" }}>Shots on Target</span>
                    <strong>{stats?.shotsOnTarget ?? "0"}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#9ca3af" }}>Cards (Y / R)</span>
                    <strong>{stats?.yellowCards ?? "0"} / {stats?.redCards ?? "0"}</strong>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: "16px", fontSize: "10px", color: "#9ca3af", textAlign: "center" }}>
                {p.starter ? "Announced as Starter" : `Entered match at minute ${stats?.minuteOn ?? "—"}'`}
                {p.isSubstitutedOut && ` · Substituted off at minute ${stats?.minuteOff ?? "—"}'`}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Final Result Card (fullscreen overlay) ───────────────────── */}
      {state.showFinalCard && state.finalState && (
        <FinalResultCard
          finalState={state.finalState}
          participant1Name={participant1Name}
          participant2Name={participant2Name}
          userTrioTotal={userTrioTotal}
          leaderboard={state.leaderboard}
          activeJourney={activeJourney}
          onDismiss={() => setState((prev) => ({ ...prev, showFinalCard: false }))}
        />
      )}
    </div>
  );
}

// ─── Trio Row Sub-Component ────────────────────────────────────────────────

function TrioRow({
  label,
  userPlayer,
  oppPlayer,
  getPlayerImageSrc,
  latestUpdate,
}: {
  label: string;
  userPlayer: LivePlayerState | null;
  oppPlayer: { playerId: string; playerName: string; rating: number } | null;
  getPlayerImageSrc: (player: { name?: string }) => string;
  latestUpdate?: PlayerRatingUpdate;
}) {
  const userRating = userPlayer?.rating ?? 0;
  const oppRating = oppPlayer?.rating ?? 0;
  const isWinning = userRating > oppRating;
  const recentDelta = latestUpdate?.delta ?? 0;

  return (
    <div className={`trio-row ${isWinning ? "trio-winning" : "trio-losing"}`}>
      {/* User side */}
      <div className="trio-player trio-user">
        <img
          className="trio-avatar"
          src={getPlayerImageSrc({ name: userPlayer?.playerName })}
          alt={userPlayer?.playerName ?? label}
          onError={(e) => {
            (e.target as HTMLImageElement).src = "/players/default.png";
          }}
        />
        <div className="trio-info">
          <div className="trio-name">{userPlayer?.playerName ?? "–"}</div>
          <div
            className={`trio-rating ${recentDelta > 0 ? "rating-up" : recentDelta < 0 ? "rating-down" : ""}`}
          >
            {userRating.toFixed(1)}
            {recentDelta !== 0 && (
              <span className={`rating-delta ${recentDelta > 0 ? "delta-up" : "delta-down"}`}>
                {recentDelta > 0 ? "+" : ""}
                {recentDelta.toFixed(1)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Position label */}
      <div className="trio-pos-label">{label}</div>

      {/* Opposition side */}
      <div className="trio-player trio-opp">
        <div className="trio-info trio-info-right">
          <div className="trio-name">{oppPlayer?.playerName ?? "–"}</div>
          <div className="trio-rating">{oppRating.toFixed(1)}</div>
        </div>
        <img
          className="trio-avatar"
          src={getPlayerImageSrc({ name: oppPlayer?.playerName })}
          alt={oppPlayer?.playerName ?? label}
          onError={(e) => {
            (e.target as HTMLImageElement).src = "/players/default.png";
          }}
        />
      </div>
    </div>
  );
}

// ─── Narrator Card Sub-Component ───────────────────────────────────────────

function NarratorCardComponent({
  card,
  isLatest,
  isLive,
}: {
  card: NarratorCard;
  isLatest: boolean;
  isLive: boolean;
}) {
  const ratingDelta = card.playerRatingAfter - card.playerRatingBefore;
  const isPositive = ratingDelta > 0;
  const isNegative = ratingDelta < 0;
  const hasRatingChange = card.playerRatingBefore > 0 && Math.abs(ratingDelta) >= 0.01;
  const playerDisplayName = (card.playerName && card.playerName !== "Unknown") ? card.playerName : null;
  const trioDelta = card.trioTotalAfter - card.trioTotalBefore;

  return (
    <div
      className={`narrator-card ${
        card.isUserPlayer ? "narrator-user" : card.isOppositionBenchmark ? "narrator-opp" : ""
      } ${isPositive ? "narrator-positive" : isNegative ? "narrator-negative" : ""}`}
    >
      <div className="narrator-headline">{card.headline}</div>
      <div className="narrator-detail">{card.detail}</div>
      {hasRatingChange && playerDisplayName && (
        <div className="narrator-rating-change">
          <span className="narrator-player-name">{playerDisplayName}</span>
          <span className="narrator-before">{card.playerRatingBefore.toFixed(1)}</span>
          <span className="narrator-arrow">→</span>
          <span className={`narrator-after ${isPositive ? "narrator-up" : "narrator-down"}`}>
            {card.playerRatingAfter.toFixed(1)}
          </span>
          {isPositive && <span className="narrator-delta narrator-delta-up">+{ratingDelta.toFixed(1)}</span>}
          {isNegative && <span className="narrator-delta narrator-delta-down">{ratingDelta.toFixed(1)}</span>}
        </div>
      )}
      {/* Only show trio impact for user's players, only if it changed */}
      {card.isUserPlayer && Math.abs(trioDelta) >= 0.01 && (
        <div className="narrator-trio-impact">
          Trio impact: {trioDelta > 0 ? "+" : ""}{trioDelta.toFixed(1)}
        </div>
      )}
    </div>
  );
}

// ─── Leaderboard Widget Sub-Component ─────────────────────────────────────

function LeaderboardWidget({ leaderboard }: { leaderboard: LeaderboardState }) {
  const rankDelta = leaderboard.prevRank > 0 ? leaderboard.prevRank - leaderboard.rank : 0;
  const isUp = rankDelta > 0;
  const isDown = rankDelta < 0;

  return (
    <div className="leaderboard-widget">
      <div className="leaderboard-label">YOUR RANK</div>
      <div className="leaderboard-rank-row">
        <span className="leaderboard-rank">#{leaderboard.rank}</span>
        <span className="leaderboard-total">/ {leaderboard.totalParticipants}</span>
        {rankDelta !== 0 && (
          <span className={`rank-badge ${isUp ? "rank-up" : "rank-down"}`}>
            {isUp ? "▲" : "▼"} {Math.abs(rankDelta)}
          </span>
        )}
      </div>
      {leaderboard.movementLabel && (
        <div className={`leaderboard-movement ${isUp ? "movement-up" : "movement-down"}`}>
          {leaderboard.movementLabel}
        </div>
      )}
    </div>
  );
}

// ─── Final Result Card Sub-Component ──────────────────────────────────────

function FinalResultCard({
  finalState,
  participant1Name,
  participant2Name,
  userTrioTotal,
  leaderboard,
  activeJourney,
  onDismiss,
}: {
  finalState: FinalMatchState;
  participant1Name: string;
  participant2Name: string;
  userTrioTotal: number;
  leaderboard: LeaderboardState | null;
  activeJourney: any;
  onDismiss: () => void;
}) {
  const beatOpposition = userTrioTotal > finalState.oppositionBenchmarkTotal;

  return (
    <div className="ft-overlay" onClick={onDismiss}>
      <div className="ft-card" onClick={(e) => e.stopPropagation()}>
        {/* FT Header */}
        <div className="ft-header">
          <div className="ft-badge">FULL TIME</div>
          <div className="ft-score">
            <span>{finalState.participant1Score}</span>
            <span className="ft-score-sep">–</span>
            <span>{finalState.participant2Score}</span>
          </div>
          <div className="ft-teams">
            {participant1Name} vs {participant2Name}
          </div>
        </div>

        {/* Trio comparison */}
        <div className="ft-trio-comparison">
          <div className="ft-trio-row">
            <span className="ft-label">Your Trio Total</span>
            <span className={`ft-value ${beatOpposition ? "ft-value-win" : "ft-value-loss"}`}>
              {userTrioTotal.toFixed(1)}
            </span>
          </div>
          <div className="ft-trio-row">
            <span className="ft-label">Opposition Best</span>
            <span className="ft-value">{finalState.oppositionBenchmarkTotal.toFixed(1)}</span>
          </div>
          <div className="ft-verdict">
            {beatOpposition
              ? "✓ YOUR TRIO OUTPERFORMED THE OPPOSITION"
              : "✗ OPPOSITION BEST BEAT YOUR TRIO"}
          </div>
        </div>

        {/* Leaderboard */}
        {leaderboard && (
          <div className="ft-rank">
            <span className="ft-rank-label">Final Rank</span>
            <span className="ft-rank-value">
              #{leaderboard.rank} of {leaderboard.totalParticipants}
            </span>
          </div>
        )}

        {/* Journey Update Card */}
        {activeJourney && (
          <div style={{
            background: "rgba(16, 185, 129, 0.1)",
            border: "1px solid rgba(16, 185, 129, 0.3)",
            borderRadius: "12px",
            padding: "14px",
            marginTop: "16px",
            textAlign: "left"
          }}>
            <div style={{ fontSize: "9px", fontWeight: "800", color: "var(--green)", letterSpacing: "0.5px", textTransform: "uppercase" }}>JOURNEY UPDATED</div>
            <div style={{ fontSize: "16px", fontWeight: "800", color: "#fff", marginTop: "4px" }}>{activeJourney.teamName} Supporter Journey</div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "10px", fontSize: "12px" }}>
              <div>
                <span style={{ color: "#9ca3af", display: "block", fontSize: "9px" }}>FINAL SCORE</span>
                <strong>{activeJourney.totalJourneyScore.toFixed(1)}</strong>
              </div>
              <div>
                <span style={{ color: "#9ca3af", display: "block", fontSize: "9px" }}>FINAL RANK</span>
                <strong>{activeJourney.currentRank ? `#${activeJourney.currentRank.toLocaleString()}` : "—"}</strong>
              </div>
              <div>
                <span style={{ color: "#9ca3af", display: "block", fontSize: "9px" }}>TOP FAN</span>
                <strong style={{ color: activeJourney.topFanEligible ? "var(--green)" : "#9ca3af" }}>
                  {activeJourney.topFanEligible ? "ELIGIBLE" : "NOT ELIGIBLE"}
                </strong>
              </div>
            </div>
          </div>
        )}

        {/* TxLINE attribution */}
        <div className="ft-attribution">
          Impact ratings derived from TxLINE live event data
        </div>

        <button className="ft-dismiss-btn" onClick={onDismiss}>
          Continue Watching
        </button>
      </div>
    </div>
  );
}

// ─── Match Map Visual Helper Functions (Client) ──────────────────────────────

function getRatingColor(rating: number | null | undefined): string {
  if (rating === null || rating === undefined) return "#6b7280";
  if (rating >= 7.5) return "#059669";
  if (rating >= 6.8) return "#10b981";
  if (rating >= 6.0) return "#d97706";
  return "#dc2626";
}

function getPlayerPositionStyles(player: MatchMapPlayer, isOpposition: boolean) {
  const lineYMap: Record<MatchMapRole, number> = isOpposition
    ? { GK: 8, DEF: 22, MID: 36, ATT: 50 }
    : { GK: 92, DEF: 78, MID: 64, ATT: 50 };

  const top = lineYMap[player.role] ?? 50;

  const idx = player.layout?.indexInLine ?? 0;
  const count = player.layout?.countInLine ?? 1;
  const left = ((idx + 0.5) / count) * 100;

  return {
    position: "absolute" as const,
    top: `${top}%`,
    left: `${left}%`,
    transform: "translate(-50%, -50%)",
  };
}

function buildMatchMapTeamClient(
  teamId: string,
  fixtureState: SerializableLiveFixtureState,
  playerRatings: Record<string, LivePlayerState>,
  userTrio: UserTrio,
  benchmark: OppositionBenchmark,
  isSupported: boolean,
): MatchMapTeam {
  const userTrioIds = new Set([userTrio.attackerId, userTrio.midfielderId, userTrio.defenderId]);
  const benchmarkIds = new Set([
    benchmark.bestATT?.playerId,
    benchmark.bestMID?.playerId,
    benchmark.bestDEF?.playerId,
  ].filter(Boolean));

  const teamPlayers = Object.values(playerRatings).filter(
    (p) => p.participantId === (teamId === fixtureState.participant1Id ? "1" : "2")
  );

  const allPlayers: MatchMapPlayer[] = teamPlayers.map((ps) => {
    const isUser = isSupported && userTrioIds.has(ps.playerId);
    const isOppBenchmark = !isSupported && benchmarkIds.has(ps.playerId);
    
    return {
      playerId: ps.playerId,
      teamId: teamId,
      displayName: ps.playerName,
      shortName: ps.playerName.split(",")[0],
      photoUrl: ps.photoUrl ?? null,
      shirtNumber: ps.shirtNumber ?? null,
      role: ps.position as MatchMapRole,
      starter: ps.starter ?? true,
      officialSubstitute: ps.officialSubstitute ?? false,
      enteredMatch: ps.enteredMatch ?? (ps.starter ?? true),
      substitutedOff: ps.isSubstitutedOut ?? false,
      currentRating: ps.rating,
      finalRating: ps.rating,
      isUserTrio: isUser,
      isOppositionBenchmark: isOppBenchmark,
      isLatestMomentPlayer: false,
      latestRatingDelta: null,
    };
  });

  const activePlayers = allPlayers.filter((p) => p.starter || p.enteredMatch);
  const benchPlayers = allPlayers.filter((p) => p.officialSubstitute);

  const roles: MatchMapRole[] = ["GK", "DEF", "MID", "ATT"];
  for (const role of roles) {
    const playersInRole = activePlayers.filter((p) => p.role === role);
    playersInRole.sort((a, b) => (a.shirtNumber ?? 99) - (b.shirtNumber ?? 99) || a.playerId.localeCompare(b.playerId));
    playersInRole.forEach((p, idx) => {
      p.layout = {
        line: role,
        indexInLine: idx,
        countInLine: playersInRole.length,
      };
    });
  }

  return {
    teamId,
    teamName: teamId === fixtureState.participant1Id ? fixtureState.participant1 : fixtureState.participant2,
    shortName: teamId === fixtureState.participant1Id ? fixtureState.participant1.slice(0, 3).toUpperCase() : fixtureState.participant2.slice(0, 3).toUpperCase(),
    visualUrl: null,
    formation: null,
    activePlayers,
    benchPlayers,
  };
}

function buildMatchMapSnapshotClient(
  snapshotId: string,
  minute: number | null,
  phase: string,
  homeScore: number,
  awayScore: number,
  fixtureState: SerializableLiveFixtureState,
  playerRatings: Record<string, LivePlayerState>,
  userTrio: UserTrio,
  benchmark: OppositionBenchmark,
): MatchMapSnapshot {
  const supportedTeam = buildMatchMapTeamClient(
    userTrio.teamId,
    fixtureState,
    playerRatings,
    userTrio,
    benchmark,
    true,
  );

  const oppositionTeamId = userTrio.teamId === fixtureState.participant1Id ? fixtureState.participant2Id : fixtureState.participant1Id;
  const oppositionTeam = buildMatchMapTeamClient(
    oppositionTeamId,
    fixtureState,
    playerRatings,
    userTrio,
    benchmark,
    false,
  );

  const trioTotal = Math.round(
    ((playerRatings[userTrio.attackerId]?.rating ?? 6.0) +
     (playerRatings[userTrio.midfielderId]?.rating ?? 6.0) +
     (playerRatings[userTrio.defenderId]?.rating ?? 6.0)) * 10
  ) / 10;

  return {
    snapshotId,
    sourceSequence: null,
    minute,
    phase,
    homeScore,
    awayScore,
    supportedTeam,
    oppositionTeam,
    trioTotal,
    oppositionBenchmarkTotal: benchmark.benchmarkTotal,
    matchIndex: benchmark.benchmarkTotal > 0 ? Math.round((trioTotal / benchmark.benchmarkTotal) * 1000) / 10 : 100.0,
    latestMoment: null,
  };
}

function PlayerNodeComponent({
  player,
  isOpposition,
  getPlayerImageSrc,
  onClick,
}: {
  player: MatchMapPlayer;
  isOpposition: boolean;
  getPlayerImageSrc: (player: { name?: string }) => string;
  onClick: () => void;
}) {
  const ratingColor = getRatingColor(player.currentRating);
  const posStyle = getPlayerPositionStyles(player, isOpposition);

  const borderStyle = player.isUserTrio
    ? "2px solid #10b981"
    : player.isOppositionBenchmark
    ? "2px solid #f59e0b"
    : "1px solid rgba(255,255,255,0.3)";

  const shadowStyle = player.isUserTrio
    ? "0 0 10px rgba(16, 185, 129, 0.4)"
    : player.isOppositionBenchmark
    ? "0 0 10px rgba(245, 158, 11, 0.4)"
    : "0 2px 4px rgba(0,0,0,0.3)";

  return (
    <button
      onClick={onClick}
      style={{
        ...posStyle,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        opacity: player.substitutedOff ? 0.5 : 1.0,
        zIndex: player.isUserTrio || player.isOppositionBenchmark ? 5 : 2,
        outline: "none"
      }}
      aria-label={`${player.displayName}, ${player.role}, Rating: ${player.currentRating ?? "—"}${player.isUserTrio ? ", Your selected player" : ""}${player.isOppositionBenchmark ? ", Opposition benchmark player" : ""}`}
    >
      <div className="player-map-avatar-wrapper" style={{
        position: "relative",
        width: "36px",
        height: "36px",
        borderRadius: "50%",
        border: borderStyle,
        boxShadow: shadowStyle,
        background: "#1e3e26",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}>
        <img
          src={getPlayerImageSrc({ name: player.displayName })}
          alt=""
          onError={(e) => {
            (e.target as HTMLImageElement).src = "/players/default.png";
          }}
          style={{
            width: "100%",
            height: "100%",
            borderRadius: "50%",
            objectFit: "cover"
          }}
        />

        <div style={{
          position: "absolute",
          bottom: "-5px",
          left: "50%",
          transform: "translateX(-50%)",
          background: ratingColor,
          color: "#fff",
          fontSize: "8px",
          fontWeight: 900,
          borderRadius: "3px",
          padding: "2px 4px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
          lineHeight: "1"
        }}>
          {player.currentRating?.toFixed(1) ?? "—"}
        </div>

        {player.substitutedOff && (
          <span style={{
            position: "absolute",
            top: "-4px",
            right: "-4px",
            background: "#dc2626",
            color: "#fff",
            borderRadius: "50%",
            width: "12px",
            height: "12px",
            display: "grid",
            placeItems: "center",
            fontSize: "8px",
            fontWeight: 800
          }}>↓</span>
        )}
        {!player.starter && player.enteredMatch && (
          <span style={{
            position: "absolute",
            top: "-4px",
            right: "-4px",
            background: "#059669",
            color: "#fff",
            borderRadius: "50%",
            width: "12px",
            height: "12px",
            display: "grid",
            placeItems: "center",
            fontSize: "8px",
            fontWeight: 800
          }}>↑</span>
        )}
      </div>

      <span style={{
        marginTop: "8px",
        fontSize: "9px",
        color: "#fff",
        fontWeight: 700,
        textAlign: "center",
        textShadow: "0 1px 3px rgba(0,0,0,0.8)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: "60px"
      }}>
        {player.shortName}
      </span>
    </button>
  );
}
