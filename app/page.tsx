"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { LiveFixture, LivePlayer, MatchFeed, normalizeFixtures, normalizeMatchFeed } from "@/lib/txline/normalize";

type Position = "ATT" | "MID" | "DEF";
type Screen = "home" | "fixtures" | "select" | "match" | "history" | "team" | "profile";
type Participation = { fixtureId: string; teamId: string; playerIds: string[]; lockedAt: string };
type TeamSummary = { id: string; name: string; matches: LiveFixture[]; supported: number };
type StoredFixtureRow = {
  id: string; participant1Id: string; participant2Id: string; homeTeamId: string; awayTeamId: string;
  startsAt: string; phase: string; competitionId: string | null; homeScore: number | null; awayScore: number | null;
  homeTeam: { id: string; name: string } | null; awayTeam: { id: string; name: string } | null;
};
type StoredMatch = {
  fixture: StoredFixtureRow;
  players: Array<{ id: string; name: string; position: LivePlayer["position"]; shirtNumber: number | null; teamId: string; starter: boolean; stats: null | {
    goals: number; ownGoals: number; shots: number; shotsOnTarget: number; yellowCards: number; redCards: number;
    penaltyAttempts: number; penaltyGoals: number; impactRating: number; dataCoverage: "complete" | "partial" | "unavailable";
  } }>;
};
type WalletProvider = {
  connect: () => Promise<{ publicKey: { toString: () => string } }>;
  signTransaction?: (transaction: Transaction) => Promise<Transaction>;
  signAndSendTransaction?: (transaction: Transaction) => Promise<{ signature: string }>;
  signMessage?: (message: Uint8Array, encoding?: string) => Promise<{ signature: Uint8Array }>;
};

declare global {
  interface Window {
    solana?: WalletProvider;
    phantom?: { solana?: WalletProvider };
    solflare?: WalletProvider;
  }
}

const positions: Position[] = ["ATT", "MID", "DEF"];
const emptyFeed: MatchFeed = { players: [], participant1Score: null, participant2Score: null, action: null, sequence: null };
const WORLD_CUP_FIXTURE_WINDOWS = [20615, 20645]; // 2026-06-11 and 2026-07-11 UTC epoch days.
const DEVNET_RPC = "https://api.devnet.solana.com";
const TXLINE_PROGRAM_ID = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
const TXLINE_TOKEN_MINT = new PublicKey("4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG");

function installedWallet() {
  return window.phantom?.solana ?? window.solana ?? window.solflare;
}

function within<T>(promise: Promise<T>, milliseconds: number, label: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} timed out. Check devnet in your wallet and retry.`)), milliseconds);
    promise.then((value) => { window.clearTimeout(timer); resolve(value); }, (error) => { window.clearTimeout(timer); reject(error); });
  });
}

async function prepareDevnetSubscription(publicKey: string) {
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const user = new PublicKey(publicKey);
  const userTokenAccount = getAssociatedTokenAddressSync(TXLINE_TOKEN_MINT, user, false, TOKEN_2022_PROGRAM_ID);
  const [pricingMatrix] = PublicKey.findProgramAddressSync([new TextEncoder().encode("pricing_matrix")], TXLINE_PROGRAM_ID);
  const [treasuryPda] = PublicKey.findProgramAddressSync([new TextEncoder().encode("token_treasury_v2")], TXLINE_PROGRAM_ID);
  const treasuryVault = getAssociatedTokenAddressSync(TXLINE_TOKEN_MINT, treasuryPda, true, TOKEN_2022_PROGRAM_ID);
  const transaction = new Transaction();
  if (!(await within(connection.getAccountInfo(userTokenAccount), 15_000, "Solana devnet account check"))) {
    transaction.add(createAssociatedTokenAccountInstruction(user, userTokenAccount, user, TXLINE_TOKEN_MINT, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
  }
  transaction.add(new TransactionInstruction({
    programId: TXLINE_PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: pricingMatrix, isSigner: false, isWritable: false },
      { pubkey: TXLINE_TOKEN_MINT, isSigner: false, isWritable: false },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: treasuryVault, isSigner: false, isWritable: true },
      { pubkey: treasuryPda, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Uint8Array.from([254, 28, 191, 138, 156, 179, 183, 53, 1, 0, 4]) as Buffer,
  }));
  const latest = await within(connection.getLatestBlockhash("confirmed"), 15_000, "Solana devnet blockhash request");
  transaction.feePayer = user;
  transaction.recentBlockhash = latest.blockhash;
  return { connection, transaction, latest };
}

function teamCode(name: string) {
  const words = name.replace(/[^a-z0-9 ]/gi, "").trim().split(/\s+/);
  return (words.length > 1 ? words.map((word) => word[0]).join("") : name.slice(0, 3)).toUpperCase();
}

function teamMark(name: string) {
  return teamCode(name).slice(0, 2);
}

function fixtureStatus(fixture: LiveFixture) {
  if (fixture.gameState === 6) return "CANCELLED";
  const start = Date.parse(fixture.startsAt);
  const distance = Date.now() - start;
  if (distance >= 0 && distance < 4 * 60 * 60 * 1000) return "LIVE / STARTED";
  if (distance >= 4 * 60 * 60 * 1000) return "COMPLETED";
  return "UPCOMING";
}

function shortWallet(value: string) {
  return value ? `${value.slice(0, 4)}…${value.slice(-3)}` : "Connected";
}

function storedFixture(row: StoredFixtureRow): LiveFixture | null {
  if (!row.homeTeam || !row.awayTeam) return null;
  const participant1 = row.participant1Id === row.homeTeamId ? row.homeTeam.name : row.awayTeam.name;
  const participant2 = row.participant2Id === row.awayTeamId ? row.awayTeam.name : row.homeTeam.name;
  return {
    id: row.id,
    participant1Id: row.participant1Id,
    participant2Id: row.participant2Id,
    participant1,
    participant2,
    homeTeamId: row.homeTeamId,
    awayTeamId: row.awayTeamId,
    homeTeam: row.homeTeam.name,
    awayTeam: row.awayTeam.name,
    startsAt: row.startsAt,
    gameState: row.phase === "final" ? 5 : null,
    competitionId: row.competitionId ?? "",
  };
}

function storedFeed(detail: StoredMatch): MatchFeed {
  const fixture = detail.fixture;
  const participant1IsHome = fixture.participant1Id === fixture.homeTeamId;
  return {
    players: detail.players.map((player) => ({
      id: player.id,
      name: player.name,
      number: player.shirtNumber,
      position: player.position,
      starter: player.starter,
      participant: player.teamId === fixture.participant1Id ? 1 : 2,
      goals: player.stats?.goals ?? 0,
      ownGoals: player.stats?.ownGoals ?? 0,
      shots: player.stats?.shots ?? 0,
      shotsOnTarget: player.stats?.shotsOnTarget ?? 0,
      yellowCards: player.stats?.yellowCards ?? 0,
      redCards: player.stats?.redCards ?? 0,
      penaltyAttempts: player.stats?.penaltyAttempts ?? 0,
      penaltyGoals: player.stats?.penaltyGoals ?? 0,
      impactRating: player.stats && player.stats.dataCoverage !== "unavailable" ? player.stats.impactRating : null,
    })),
    participant1Score: participant1IsHome ? fixture.homeScore : fixture.awayScore,
    participant2Score: participant1IsHome ? fixture.awayScore : fixture.homeScore,
    action: fixture.phase === "final" ? "game_finalised" : fixture.phase,
    sequence: null,
  };
}

function playerStatLine(player: LivePlayer) {
  const stats = [`${player.goals} goals`, `${player.shots} shots`];
  if (player.yellowCards) stats.push(`${player.yellowCards} yellow`);
  if (player.redCards) stats.push(`${player.redCards} red`);
  return stats.join(" · ");
}

function FixtureRow({ fixture, onClick }: { fixture: LiveFixture; onClick: () => void }) {
  return <button className="real-fixture-row" onClick={onClick}>
    <span className="real-team-mark">{teamMark(fixture.homeTeam)}</span>
    <span className="real-fixture-copy"><b>{fixture.homeTeam} vs {fixture.awayTeam}</b><small>{fixtureStatus(fixture)} · {new Date(fixture.startsAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</small></span>
    <span className="real-team-mark away">{teamMark(fixture.awayTeam)}</span><i>›</i>
  </button>;
}

function MatchCard({ fixture, label, onClick }: { fixture: LiveFixture; label: string; onClick: () => void }) {
  const status = fixtureStatus(fixture);
  const highlighted = label === "NEXT MATCH" || status === "LIVE / STARTED";
  return <button className={`match-card real-match-card ${highlighted ? "next-card" : ""}`} onClick={onClick}>
    <div><span className={`pill ${status === "LIVE / STARTED" ? "live-pill" : highlighted ? "next-pill" : "final-pill"}`}>{label}</span><time>{new Date(fixture.startsAt).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</time></div>
    <section><span><em>{teamMark(fixture.homeTeam)}</em><b>{teamCode(fixture.homeTeam)}</b></span><i>VS</i><span><em>{teamMark(fixture.awayTeam)}</em><b>{teamCode(fixture.awayTeam)}</b></span></section>
    <footer><span>{new Date(fixture.startsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><b>{highlighted ? "View match →" : "Match details →"}</b></footer>
  </button>;
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("home");
  const [wallet, setWallet] = useState("");
  const [connected, setConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<"idle" | "connecting" | "active" | "error">("idle");
  const [connectionStep, setConnectionStep] = useState(0);
  const [message, setMessage] = useState("Connect a devnet wallet to request real TxLINE data.");
  const [fixtures, setFixtures] = useState<LiveFixture[]>([]);
  const [fixturesLoading, setFixturesLoading] = useState(true);
  const [activeFixture, setActiveFixture] = useState<LiveFixture | null>(null);
  const [activeTeamId, setActiveTeamId] = useState("");
  const [feed, setFeed] = useState<MatchFeed>(emptyFeed);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState("");
  const [feedSource, setFeedSource] = useState<"historical" | "snapshot" | "">("");
  const [selected, setSelected] = useState<Partial<Record<Position, LivePlayer>>>({});
  const [activePosition, setActivePosition] = useState<Position>("ATT");
  const [participations, setParticipations] = useState<Participation[]>(() => {
    if (typeof window === "undefined") return [];
    const saved = window.localStorage.getItem("one-nation-real-participations");
    if (!saved) return [];
    try { return JSON.parse(saved) as Participation[]; } catch { return []; }
  });
  const [activeTeamPage, setActiveTeamPage] = useState<TeamSummary | null>(null);
  const [sessionNow] = useState(() => Date.now());
  const [matchRailIndex, setMatchRailIndex] = useState(0);
  const matchRailRef = useRef<HTMLDivElement>(null);

  const timedFetch = (url: string, init?: RequestInit, timeout = 20_000) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);
    return fetch(url, { ...init, signal: controller.signal }).finally(() => window.clearTimeout(timer));
  };

  const loadFixtures = async () => {
    setFixturesLoading(true);
    try {
      const storedResponse = await timedFetch("/api/data/fixtures");
      if (storedResponse.ok) {
        const storedRows = await storedResponse.json() as StoredFixtureRow[];
        const archived = storedRows.map(storedFixture).filter(Boolean) as LiveFixture[];
        if (archived.length) {
          setFixtures(archived.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)));
          setConnected(true);
          setConnectionState("active");
          setMessage(`${archived.length} real TxLINE fixture${archived.length === 1 ? "" : "s"} loaded from the stored devnet archive.`);
          return;
        }
      }
      const responses = await Promise.all(WORLD_CUP_FIXTURE_WINDOWS.map((startEpochDay) => timedFetch(`/api/txline/fixtures?startEpochDay=${startEpochDay}`)));
      const failed = responses.find((response) => !response.ok);
      if (failed) {
        if (failed.status === 401 || failed.status === 403) {
          setConnected(false); setConnectionState("error");
          throw new Error("TxLINE access is not active in this browser. Connect the funded devnet wallet and approve both requests.");
        }
        throw new Error(`TxLINE fixtures failed (${failed.status}).`);
      }
      const batches = await Promise.all(responses.map((response) => response.json()));
      const byId = new Map<string, LiveFixture>();
      for (const batch of batches) for (const fixture of normalizeFixtures(batch)) byId.set(fixture.id, fixture);
      const normalized = [...byId.values()].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
      setFixtures(normalized);
      setMessage(normalized.length ? `${normalized.length} real TxLINE tournament fixtures loaded from devnet.` : "TxLINE returned no fixtures for the tournament windows.");
      setConnectionState("active");
    } catch (error) {
      setFixtures([]);
      setMessage(error instanceof Error ? error.message : "Could not load TxLINE fixtures.");
    } finally {
      setFixturesLoading(false);
    }
  };

  useEffect(() => {
    fetch("/api/txline/status").then((response) => response.json()).then((status: { connected?: boolean }) => {
      setConnected(Boolean(status.connected));
      return loadFixtures();
    }).catch(() => { setFixturesLoading(false); setMessage("Could not check the TxLINE session."); });
    // loadFixtures is intentionally run once for the cookie-backed session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadFeed = async (fixture: LiveFixture) => {
    setFeedLoading(true); setFeedError(""); setFeedSource(""); setFeed(emptyFeed);
    try {
      const storedResponse = await timedFetch(`/api/data/fixtures/${fixture.id}`);
      if (storedResponse.ok) {
        const detail = await storedResponse.json() as StoredMatch;
        if (detail.players.length) {
          setFeed(storedFeed(detail));
          setFeedSource("historical");
          return;
        }
      }
      const isPast = Date.parse(fixture.startsAt) < sessionNow;
      let mode: "historical" | "snapshot" = isPast ? "historical" : "snapshot";
      let response = await timedFetch(`/api/txline/scores/${fixture.id}${mode === "historical" ? "?mode=historical" : ""}`);
      if (!response.ok && isPast) {
        mode = "snapshot";
        response = await timedFetch(`/api/txline/scores/${fixture.id}`);
      }
      if (!response.ok) throw new Error(`TxLINE score feed failed (${response.status}).`);
      setFeed(normalizeMatchFeed(await response.json()));
      setFeedSource(mode);
    } catch (error) {
      setFeedError(error instanceof Error ? error.message : "Could not load the TxLINE match feed.");
    } finally { setFeedLoading(false); }
  };

  const connectTxline = async () => {
    const provider = installedWallet();
    if (!provider) { setConnectionState("error"); setMessage("Open this site in Phantom's browser, or in Chrome with Phantom installed, then retry."); return; }
    if (!provider.signMessage || (!provider.signTransaction && !provider.signAndSendTransaction)) { setConnectionState("error"); setMessage("This wallet cannot sign the TxLINE activation requests. Use Phantom or Solflare."); return; }
    let step = 1;
    try {
      setConnectionState("connecting"); setConnectionStep(step); setMessage("Connecting wallet…");
      const walletConnection = await provider.connect();
      const publicKey = walletConnection.publicKey.toString(); setWallet(publicKey);
      step = 2; setConnectionStep(step); setMessage("Starting TxLINE guest session…");
      const session = await timedFetch("/api/txline/session", { method: "POST" }).then((response) => response.json()) as { jwt?: string; error?: string };
      if (!session.jwt) throw new Error(session.error ?? "TxLINE guest session failed.");
      step = 3; setConnectionStep(step); setMessage("Preparing free TxLINE subscription on devnet…");
      const prepared = await prepareDevnetSubscription(publicKey);
      step = 4; setConnectionStep(step); setMessage("Approve the devnet subscription in your wallet…");
      let txSig: string;
      if (provider.signTransaction) {
        const signed = await provider.signTransaction(prepared.transaction);
        txSig = await within(prepared.connection.sendRawTransaction(signed.serialize(), { skipPreflight: false }), 25_000, "Devnet transaction submission");
        const confirmation = await within(prepared.connection.confirmTransaction({ signature: txSig, ...prepared.latest }, "confirmed"), 35_000, "TxLINE subscription confirmation");
        if (confirmation.value.err) throw new Error("The TxLINE devnet subscription transaction failed.");
      } else txSig = (await provider.signAndSendTransaction!(prepared.transaction)).signature;
      step = 5; setConnectionStep(step); setMessage("Activating TxLINE API token…");
      const signedMessage = await provider.signMessage(new TextEncoder().encode(`${txSig}::${session.jwt}`), "utf8");
      const walletSignature = btoa(String.fromCharCode(...signedMessage.signature));
      const activation = await timedFetch("/api/txline/activate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ txSig, walletSignature }) });
      if (!activation.ok) throw new Error((await activation.json()).error ?? "TxLINE activation failed.");
      step = 6; setConnectionStep(step); setMessage("Fetching real TxLINE fixtures…");
      setConnected(true); await loadFixtures();
    } catch (error) {
      setConnectionState("error");
      setMessage(error instanceof Error && error.name === "AbortError" ? `Step ${step} timed out. Retry the connection.` : error instanceof Error ? error.message : "TxLINE connection failed.");
    }
  };

  const teams = useMemo<TeamSummary[]>(() => {
    const map = new Map<string, { name: string; matches: LiveFixture[] }>();
    for (const fixture of fixtures) {
      for (const [id, name] of [[fixture.participant1Id, fixture.participant1], [fixture.participant2Id, fixture.participant2]]) {
        const current = map.get(id) ?? { name, matches: [] }; current.matches.push(fixture); map.set(id, current);
      }
    }
    return [...map.entries()].map(([id, value]) => ({ id, ...value, supported: participations.filter((entry) => entry.teamId === id).length })).sort((a, b) => b.supported - a.supported || a.name.localeCompare(b.name));
  }, [fixtures, participations]);

  const matchNavigation = useMemo(() => {
    const completed = fixtures
      .filter((fixture) => Date.parse(fixture.startsAt) <= sessionNow - 4 * 60 * 60 * 1000)
      .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
    const live = fixtures
      .filter((fixture) => Date.parse(fixture.startsAt) > sessionNow - 4 * 60 * 60 * 1000 && Date.parse(fixture.startsAt) <= sessionNow)
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    const upcoming = fixtures
      .filter((fixture) => Date.parse(fixture.startsAt) > sessionNow)
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    const ordered = [...fixtures].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    const focusId = live[0]?.id ?? upcoming[0]?.id ?? completed[0]?.id ?? "";
    return {
      ordered,
      focusIndex: Math.max(0, ordered.findIndex((fixture) => fixture.id === focusId)),
      lastMatchId: completed[0]?.id ?? "",
      nextMatchId: upcoming[0]?.id ?? "",
      upcoming: [...live, ...upcoming],
      previous: completed,
    };
  }, [fixtures, sessionNow]);

  const matchLabel = (fixture: LiveFixture) => {
    if (fixture.id === matchNavigation.lastMatchId) return "LAST MATCH";
    if (fixture.id === matchNavigation.nextMatchId) return "NEXT MATCH";
    const status = fixtureStatus(fixture);
    if (status === "LIVE / STARTED") return "LIVE NOW";
    if (status === "UPCOMING") return "UPCOMING";
    return "PREVIOUS";
  };

  const navigateMatchRail = (direction: -1 | 1) => {
    const nextIndex = Math.min(matchNavigation.ordered.length - 1, Math.max(0, matchRailIndex + direction));
    const card = matchRailRef.current?.querySelectorAll<HTMLElement>(".match-card")[nextIndex];
    card?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    setMatchRailIndex(nextIndex);
  };

  const updateMatchRailIndex = () => {
    const rail = matchRailRef.current;
    if (!rail) return;
    const cards = [...rail.querySelectorAll<HTMLElement>(".match-card")];
    if (!cards.length) return;
    const railCenter = rail.getBoundingClientRect().left + rail.clientWidth / 2;
    let nearest = 0;
    let distance = Number.POSITIVE_INFINITY;
    cards.forEach((card, index) => {
      const bounds = card.getBoundingClientRect();
      const candidate = Math.abs(bounds.left + bounds.width / 2 - railCenter);
      if (candidate < distance) { distance = candidate; nearest = index; }
    });
    setMatchRailIndex(nearest);
  };

  useEffect(() => {
    if (screen !== "home" || fixturesLoading || !matchNavigation.ordered.length) return;
    const frame = window.requestAnimationFrame(() => {
      const rail = matchRailRef.current;
      const card = rail?.querySelectorAll<HTMLElement>(".match-card")[matchNavigation.focusIndex];
      if (!rail || !card) return;
      rail.scrollTo({ left: card.offsetLeft - (rail.clientWidth - card.offsetWidth) / 2, behavior: "auto" });
      setMatchRailIndex(matchNavigation.focusIndex);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fixturesLoading, matchNavigation.focusIndex, matchNavigation.ordered.length, screen]);

  const openFixture = (fixture: LiveFixture, team?: TeamSummary) => {
    setActiveFixture(fixture); setSelected({}); setActivePosition("ATT");
    if (team) setActiveTeamId(team.id); else setActiveTeamId("");
    loadFeed(fixture);
    const existing = participations.find((entry) => entry.fixtureId === fixture.id);
    setScreen(existing || Date.parse(fixture.startsAt) <= sessionNow ? "match" : "select");
  };

  const selectedParticipant = activeFixture && activeTeamId === activeFixture.participant1Id ? 1 : 2;
  const eligiblePlayers = feed.players.filter((player) => player.participant === selectedParticipant);
  const chosenPlayers = positions.map((position) => selected[position]).filter(Boolean) as LivePlayer[];
  const savedParticipation = activeFixture ? participations.find((entry) => entry.fixtureId === activeFixture.id) : undefined;
  const displayedPlayers = chosenPlayers.length ? chosenPlayers : feed.players.filter((player) => savedParticipation?.playerIds.includes(player.id));
  const oppositionParticipant = displayedPlayers[0]?.participant === 1 ? 2 : 1;
  const oppositionBest = positions.map((position) => feed.players.filter((player) => player.participant === oppositionParticipant && player.position === position && player.impactRating !== null).sort((a, b) => (b.impactRating ?? 0) - (a.impactRating ?? 0))[0]).filter(Boolean) as LivePlayer[];
  const yourTotal = displayedPlayers.length === 3 && displayedPlayers.every((player) => player.impactRating !== null) ? displayedPlayers.reduce((sum, player) => sum + (player.impactRating ?? 0), 0) : null;
  const oppositionTotal = oppositionBest.length === 3 ? oppositionBest.reduce((sum, player) => sum + (player.impactRating ?? 0), 0) : null;

  const lockSelection = () => {
    if (!activeFixture || !activeTeamId || chosenPlayers.length !== 3) return;
    const entry = { fixtureId: activeFixture.id, teamId: activeTeamId, playerIds: chosenPlayers.map((player) => player.id), lockedAt: new Date().toISOString() };
    const next = [...participations.filter((item) => item.fixtureId !== entry.fixtureId), entry];
    setParticipations(next); window.localStorage.setItem("one-nation-real-participations", JSON.stringify(next)); setScreen("match");
  };

  const matchScore = activeFixture ? (activeFixture.participant1Id === activeFixture.homeTeamId ? [feed.participant1Score, feed.participant2Score] : [feed.participant2Score, feed.participant1Score]) : [null, null];

  return <main className="stage"><section className="phone-shell" aria-label="One Nation supporter app">
    <header className="topbar"><button className="brand" onClick={() => setScreen("home")}><span className="brand-mark">1N</span><span>ONE NATION</span></button><span className="network-badge">DEVNET</span><button className={`wallet ${connectionState}`} onClick={connectTxline} disabled={connectionState === "connecting"}><span className="wallet-dot" />{wallet ? shortWallet(wallet) : connected ? "TxLINE active" : "Connect"}</button></header>
    <div className="content">
      {screen === "home" && <div className="screen enter real-home">
        <div className="home-intro"><span className="eyebrow">TXLINE · LIVE DEVNET DATA</span><h1>Your World Cup.</h1><p>Nothing on this screen is filled with demonstration sports data.</p></div>
        {!connected && <button className="connect-data-card" onClick={connectTxline}><span>LIVE DATA LOCKED</span><h2>Connect TxLINE devnet</h2><p>Complete the free wallet subscription to load fixtures, official squads, scores and player statistics.</p><b>{connectionState === "connecting" ? `Step ${connectionStep}/6 · ${message}` : "Connect wallet →"}</b></button>}
        {connected && <>
          <div className="rail-heading matches-heading"><div><h2>Matches</h2><span>Previous matches left · upcoming matches right</span></div><button className="see-all" onClick={() => setScreen("fixtures")}>See all</button></div>
          {fixturesLoading ? <div className="real-empty"><b>Loading TxLINE fixtures…</b></div> : fixtures.length ? <><div className="horizontal-rail match-rail" ref={matchRailRef} onScroll={updateMatchRailIndex}>{matchNavigation.ordered.map((fixture) => <MatchCard key={fixture.id} fixture={fixture} label={matchLabel(fixture)} onClick={() => openFixture(fixture)} />)}</div><div className="match-rail-progress" aria-live="polite"><button aria-label="Show previous match" onClick={() => navigateMatchRail(-1)} disabled={matchRailIndex === 0}>← Previous</button><span>{matchRailIndex + 1} / {matchNavigation.ordered.length}</span><button aria-label="Show next match" onClick={() => navigateMatchRail(1)} disabled={matchRailIndex >= matchNavigation.ordered.length - 1}>Next →</button></div></> : <div className="real-empty"><b>No fixtures returned</b><span>{message}</span></div>}
          <div className="rail-heading team-heading"><div><h2>Teams</h2><span>Derived from real fixtures</span></div></div>
          {teams.length ? <div className="horizontal-rail team-rail">{teams.map((team) => <button className="team-career-card real-team-card" key={team.id} onClick={() => { setActiveTeamPage(team); setScreen("team"); }}><span className="real-team-badge">{teamMark(team.name)}</span><div className="team-card-title"><div><b>{team.name}</b><small>{team.matches.length} TxLINE fixtures</small></div></div><div className="team-card-score"><strong>{team.supported}</strong><span>matches you supported</span></div><div className="team-card-rank"><span>{team.supported ? "History ready" : "Not followed"}</span><b>›</b></div></button>)}</div> : null}
        </>}
        <div className={`devnet-status ${connectionState}`}><span>●</span><div><b>TxLINE · Solana devnet</b><small>{message}</small></div></div>
      </div>}

      {screen === "fixtures" && <div className="screen enter"><button className="back" onClick={() => setScreen("home")}>← Home</button><div className="page-title"><span className="eyebrow">TXLINE FIXTURES</span><h1>All matches</h1><p>{fixtures.length} authenticated fixtures returned by devnet.</p></div>{matchNavigation.upcoming.length ? <section className="fixture-group"><div className="fixture-group-heading"><h2>Next matches</h2><span>{matchNavigation.upcoming.length}</span></div><div className="real-list">{matchNavigation.upcoming.map((fixture) => <FixtureRow key={fixture.id} fixture={fixture} onClick={() => openFixture(fixture)} />)}</div></section> : null}{matchNavigation.previous.length ? <section className="fixture-group"><div className="fixture-group-heading"><h2>Previous matches</h2><span>{matchNavigation.previous.length}</span></div><div className="real-list">{matchNavigation.previous.map((fixture) => <FixtureRow key={fixture.id} fixture={fixture} onClick={() => openFixture(fixture)} />)}</div></section> : null}</div>}

      {screen === "select" && activeFixture && <div className="screen enter"><button className="back" onClick={() => setScreen("home")}>← Matches</button><div className="page-title"><span className="eyebrow">OFFICIAL TXLINE LINEUP</span><h1>Choose your team</h1><p>{activeFixture.homeTeam} vs {activeFixture.awayTeam}</p></div>
        <div className="real-team-choice"><button className={activeTeamId === activeFixture.homeTeamId ? "active" : ""} onClick={() => { setActiveTeamId(activeFixture.homeTeamId); setSelected({}); }}>{teamMark(activeFixture.homeTeam)}<b>{activeFixture.homeTeam}</b></button><button className={activeTeamId === activeFixture.awayTeamId ? "active" : ""} onClick={() => { setActiveTeamId(activeFixture.awayTeamId); setSelected({}); }}>{teamMark(activeFixture.awayTeam)}<b>{activeFixture.awayTeam}</b></button></div>
        {feedLoading ? <div className="real-empty"><b>Loading official squad…</b></div> : feedError ? <div className="real-empty error"><b>Squad unavailable</b><span>{feedError}</span></div> : !feed.players.length ? <div className="real-empty"><b>Official lineup has not arrived</b><span>Players will appear only after TxLINE sends the real lineups action.</span></div> : activeTeamId ? <><div className="position-tabs">{positions.map((position) => <button key={position} className={activePosition === position ? "active" : ""} onClick={() => setActivePosition(position)}><span>{selected[position] ? "✓" : position}</span>{position}</button>)}</div><div className="player-list">{eligiblePlayers.filter((player) => player.position === activePosition).map((player) => <button className={`player-row ${selected[activePosition]?.id === player.id ? "picked" : ""}`} key={player.id} onClick={() => setSelected((current) => ({ ...current, [activePosition]: player }))}><span className="shirt-number">{player.number ?? "—"}</span><span className="player-name"><b>{player.name}</b><small>{player.starter ? "Starting" : "Substitute"} · TxLINE position {player.position}</small></span><span className="select-circle">{selected[activePosition]?.id === player.id ? "✓" : "+"}</span></button>)}</div><div className="selection-dock"><div className="mini-picks">{positions.map((position) => <span className={selected[position] ? "filled" : ""} key={position}>{selected[position]?.number ?? position}</span>)}<div><b>{chosenPlayers.length}/3 selected</b><small>Real official squad</small></div></div><button disabled={chosenPlayers.length !== 3} onClick={lockSelection}>Lock my three</button></div></> : null}
      </div>}

      {screen === "match" && activeFixture && <div className="screen enter"><button className="back" onClick={() => activeTeamPage ? setScreen("team") : setScreen("home")}>← Matches</button><div className="scoreboard real-scoreboard"><span className="real-team-mark">{teamMark(activeFixture.homeTeam)}</span><div><small>{fixtureStatus(activeFixture)} · TXLINE</small><b>{matchScore[0] ?? "—"} <i>—</i> {matchScore[1] ?? "—"}</b><span>{activeFixture.homeTeam} · {activeFixture.awayTeam}</span></div><span className="real-team-mark away">{teamMark(activeFixture.awayTeam)}</span></div>
        {feedLoading ? <div className="real-empty"><b>Refreshing TxLINE match feed…</b></div> : feedError ? <div className="real-empty error"><b>Match feed unavailable</b><span>{feedError}</span></div> : <><div className="live-summary"><div><span>YOUR THREE</span><b>{yourTotal?.toFixed(1) ?? "—"}</b></div><div className="index-ring"><b>{yourTotal !== null && oppositionTotal !== null ? ((yourTotal / oppositionTotal) * 100).toFixed(1) : "—"}</b><small>MATCH INDEX</small></div><div><span>BEST OPP.</span><b>{oppositionTotal?.toFixed(1) ?? "—"}</b></div></div><p className="status-line">{feedSource === "historical" ? "Full TxLINE historical sequence" : "Latest TxLINE score snapshot"}{feed.action ? ` · ${feed.action}${feed.sequence ? ` · seq ${feed.sequence}` : ""}` : " · waiting for match actions"}</p><div className="compare-label"><span>YOUR SELECTED PLAYERS</span><span>TXLINE IMPACT</span></div><div className="rating-stack">{displayedPlayers.length ? displayedPlayers.map((player) => <div className="rating-row" key={player.id}><span className={`position-tag ${player.position.toLowerCase()}`}>{player.position}</span><span><b>{player.name}</b><small>{playerStatLine(player)}</small></span><strong>{player.impactRating?.toFixed(1) ?? "—"}</strong></div>) : <div className="real-empty"><b>No locked trio for this match</b><span>Official match data is still shown without assigning you a score.</span></div>}</div><div className="compare-label opposition-label"><span>BEST OF THE OPPOSITION</span><span>REAL STATS ONLY</span></div><div className="opposition-row">{positions.map((position) => { const player = oppositionBest.find((item) => item.position === position); return <div key={position}><span>{position}</span><b>{player?.name ?? "Waiting"}</b><strong>{player?.impactRating?.toFixed(1) ?? "—"}</strong></div>; })}</div><div className="real-rank-pending"><b>Rank and percentile pending</b><span>They will appear only after real user entries for this fixture are settled. No distribution is fabricated.</span></div></>}
      </div>}

      {screen === "history" && <div className="screen enter"><div className="page-title"><span className="eyebrow">REAL USER HISTORY</span><h1>Your matches</h1><p>Only fixtures where this device locked a real TxLINE lineup.</p></div>{participations.length ? <div className="real-list">{participations.map((entry) => { const fixture = fixtures.find((item) => item.id === entry.fixtureId); return fixture ? <FixtureRow key={entry.fixtureId} fixture={fixture} onClick={() => openFixture(fixture)} /> : null; })}</div> : <div className="real-empty large"><b>No participation history yet</b><span>Choose three players from a real official lineup. That match will then appear here.</span></div>}</div>}

      {screen === "team" && activeTeamPage && <div className="screen enter"><button className="back" onClick={() => setScreen("home")}>← Teams</button><div className="team-history-title"><span className="real-team-badge large">{teamMark(activeTeamPage.name)}</span><div><span className="eyebrow">TXLINE TEAM HISTORY</span><h1>{activeTeamPage.name}</h1><p>{activeTeamPage.matches.length} real fixtures · {activeTeamPage.supported} supported</p></div></div><div className="section-heading"><h2>World Cup matches</h2><span className="muted">TxLINE fixtures</span></div><div className="real-list">{activeTeamPage.matches.map((fixture) => <FixtureRow key={fixture.id} fixture={fixture} onClick={() => openFixture(fixture, activeTeamPage)} />)}</div></div>}

      {screen === "profile" && <div className="screen enter profile-screen"><div className="avatar">1N</div><span className="eyebrow">DEVNET PROFILE</span><h1>{wallet ? shortWallet(wallet) : "No wallet"}</h1><p>{connected ? "TxLINE API token active in this browser." : "Connect to create a real supporter profile."}</p><div className="history-overview"><div><b>{participations.length}</b><span>Real entries</span></div><div><b>{teams.filter((team) => team.supported).length}</b><span>Teams backed</span></div><div><b>{fixtures.length}</b><span>Fixtures loaded</span></div></div></div>}
    </div>
    {screen !== "select" && <nav className="bottom-nav"><button className={screen === "home" || screen === "fixtures" || screen === "team" || screen === "match" ? "active" : ""} onClick={() => setScreen("home")}><span>▣</span>Home</button><button className={screen === "history" ? "active" : ""} onClick={() => setScreen("history")}><span>◷</span>History</button><button className={screen === "profile" ? "active" : ""} onClick={() => setScreen("profile")}><span>●</span>Profile</button></nav>}
  </section></main>;
}
