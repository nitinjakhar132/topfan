"use client";

import "./polyfill";
import { useEffect, useMemo, useRef, useState } from "react";
import { WebPlayerPassport } from "./components/WebPlayerPassport";
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { LiveFixture, LivePlayer, MatchFeed, normalizeFixtures, normalizeMatchFeed } from "@/lib/txline/normalize";

import { LiveMatchScreen } from "./components/LiveMatchScreen";
import { PlayersScreen } from "./components/players/PlayersScreen";

type Position = "ATT" | "MID" | "DEF";
type Screen = "home" | "fixtures" | "select" | "match" | "history" | "support" | "team_journey" | "players" | "live";
type SelectionStep = "choose-team" | "choose-players" | "review" | "submitting" | "locked";
type Participation = { fixtureId: string; teamId: string; playerIds: string[]; lockedAt: string };
type TeamSummary = { id: string; name: string; matches: LiveFixture[]; supported: number };
type MatchOdds = { home: number; draw: number; away: number };
type MatchCardComparison = {
  yourTotal: number | null;
  homeBest: number | null;
  awayBest: number | null;
  supportedTeamId: string | null;
  demo?: boolean;
};
type StoredFixtureRow = {
  id: string; participant1Id: string; participant2Id: string; homeTeamId: string; awayTeamId: string;
  startsAt: string; phase: string; competitionId: string | null; homeScore: number | null; awayScore: number | null;
  homeTeam: { id: string; name: string } | null; awayTeam: { id: string; name: string } | null;
};
type StoredMatch = {
  fixture: StoredFixtureRow;
  players: Array<{ id: string; name: string; position: LivePlayer["position"]; shirtNumber: number | null; teamId: string; starter: boolean; sofascoreId?: number | null; stats: null | {
    goals: number; assists: number; ownGoals: number; shots: number; shotsOnTarget: number; yellowCards: number; redCards: number;
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
const WORLD_CUP_PLACEHOLDERS: LiveFixture[] = [];
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

const teamFlagCodes: Record<string, string> = {
  "algeria": "dz",
  "argentina": "ar",
  "australia": "au",
  "austria": "at",
  "belgium": "be",
  "bosnia & herzegovina": "ba",
  "brazil": "br",
  "canada": "ca",
  "cape verde": "cv",
  "colombia": "co",
  "congo dr": "cd",
  "croatia": "hr",
  "ecuador": "ec",
  "egypt": "eg",
  "england": "gb-eng",
  "france": "fr",
  "germany": "de",
  "ghana": "gh",
  "ivory coast": "ci",
  "mexico": "mx",
  "morocco": "ma",
  "netherlands": "nl",
  "norway": "no",
  "paraguay": "py",
  "portugal": "pt",
  "senegal": "sn",
  "spain": "es",
  "sweden": "se",
  "switzerland": "ch",
  "usa": "us",
};

function TeamFlag({ name, className = "", style }: { name: string; className?: string; style?: React.CSSProperties }) {
  const normalized = name.trim().toLowerCase();
  if (normalized === "tbd") {
    return <span className={`${className} team-flag-fallback tbd-flag`} aria-label="TBD" style={{ fontSize: "9px", fontWeight: "bold", ...style }}>TBD</span>;
  }
  const code = teamFlagCodes[normalized];
  if (!code) return <span className={`${className} team-flag-fallback`} aria-label={name} style={style}>{teamMark(name)}</span>;
  return <span className={`${className} team-flag`} style={style}><img src={`/flags/${code}.png`} alt={`${name} flag`} loading="lazy" decoding="async" /></span>;
}

function fixtureStatus(fixture: LiveFixture) {
  if (fixture.gameState === 6) return "CANCELLED";
  const start = Date.parse(fixture.startsAt);
  const distance = Date.now() - start;
  if (distance >= 0 && distance < 4 * 60 * 60 * 1000) return "LIVE / STARTED";
  if (distance >= 4 * 60 * 60 * 1000) return "COMPLETED";
  return "UPCOMING";
}

function detectFormation(players: LivePlayer[]): string {
  const starters = players.filter(p => p.starter);
  const def = starters.filter(p => p.position === "DEF").length;
  const mid = starters.filter(p => p.position === "MID").length;
  const att = starters.filter(p => p.position === "ATT").length;
  if (def + mid + att === 0) return "";
  return `${def}-${mid}-${att}`;
}

function ratingColor(rating: number | null): string {
  if (rating === null) return "#555";
  if (rating >= 7) return "#1a8f4a";
  if (rating >= 6) return "#6b8e23";
  if (rating >= 5) return "#e8a30e";
  return "#d94545";
}

function formatMatchDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function shortenName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

function matchCardTime(fixture: LiveFixture, label: string) {
  const start = new Date(fixture.startsAt);
  if (label === "NEXT MATCH" && start.getTime() > Date.now()) {
    const hours = Math.max(1, Math.ceil((start.getTime() - Date.now()) / 3_600_000));
    return { primary: `In ${hours}h`, secondary: start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
  }
  return {
    primary: start.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }),
    secondary: start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  };
}

function isArgentinaSwitzerland(fixture: LiveFixture) {
  const teams = new Set([fixture.homeTeam.toLowerCase(), fixture.awayTeam.toLowerCase()]);
  return teams.has("argentina") && teams.has("switzerland");
}

function argentinaPreviewComparison(fixture: LiveFixture): MatchCardComparison | null {
  if (!isArgentinaSwitzerland(fixture)) return null;
  const argentinaIsHome = fixture.homeTeam.toLowerCase() === "argentina";
  return {
    yourTotal: 22.8,
    homeBest: argentinaIsHome ? 24.1 : 23.6,
    awayBest: argentinaIsHome ? 23.6 : 24.1,
    supportedTeamId: argentinaIsHome ? fixture.homeTeamId : fixture.awayTeamId,
    demo: true,
  };
}

function normalizeMatchOdds(payload: unknown, fixture: LiveFixture): MatchOdds | null {
  if (!Array.isArray(payload)) return null;
  const candidates = payload.filter((entry): entry is Record<string, unknown> => {
    if (!entry || typeof entry !== "object") return false;
    const pct = (entry as Record<string, unknown>).Pct;
    return Array.isArray(pct) && pct.length === 3 && pct.every((value) => Number.isFinite(Number(value)));
  });
  candidates.sort((a, b) => {
    const score = (entry: Record<string, unknown>) => {
      const type = String(entry.SuperOddsType ?? "");
      const period = String(entry.MarketPeriod ?? "");
      return (/1x2|result|moneyline|match/i.test(type) ? 2 : 0) + (/match|full|game|90/i.test(period) ? 1 : 0) - (entry.InRunning ? 1 : 0);
    };
    return score(b) - score(a);
  });
  const row = candidates[0];
  if (!row) return null;
  const values = (row.Pct as unknown[]).map(Number);
  const sum = values.reduce((total, value) => total + value, 0);
  if (!(sum > 0)) return null;
  const normalized = values.map((value) => value / sum * 100);
  const names = Array.isArray(row.PriceNames) ? row.PriceNames.map((name) => String(name).toLowerCase()) : [];
  const homeName = fixture.homeTeam.toLowerCase();
  const awayName = fixture.awayTeam.toLowerCase();
  const findIndex = (patterns: string[]) => names.findIndex((name) => patterns.some((pattern) => name === pattern || name.includes(pattern)));
  const homeIndex = findIndex([homeName, "home", "1"]);
  const drawIndex = findIndex(["draw", "tie", "x"]);
  const awayIndex = findIndex([awayName, "away", "2"]);
  const distinct = new Set([homeIndex, drawIndex, awayIndex]).size === 3 && homeIndex >= 0 && drawIndex >= 0 && awayIndex >= 0;
  return distinct
    ? { home: normalized[homeIndex], draw: normalized[drawIndex], away: normalized[awayIndex] }
    : { home: normalized[0], draw: normalized[1], away: normalized[2] };
}

function shortWallet(value: string) {
  return value ? `${value.slice(0, 4)}…${value.slice(-3)}` : "Connected";
}

// Known real scores for each fixture (p1Score, p2Score) — applied as fallback when feed/DB has no score
const KNOWN_FIXTURE_SCORES: Record<string, [number, number]> = {
  "18257865": [4, 7], // France (p1) vs England (p2)
  "18241006": [1, 2], // England (p1) vs Argentina (p2)
  "18237038": [0, 2], // France (p1) vs Spain (p2)
  "18222446": [4, 1], // Argentina (p1) vs Switzerland (p2)
  "18213979": [2, 3], // Norway (p1) vs England (p2)
  "18218149": [2, 1], // Spain (p1) vs Belgium (p2)
  "18209181": [2, 1], // France (p1) vs Morocco (p2)
  "18202783": [0, 0], // Switzerland (p1) vs Colombia (p2)
  "18202701": [0, 1], // Argentina (p1) vs Egypt (p2)
  "18193785": [1, 4], // USA (p1) vs Belgium (p2)
  "18198205": [0, 1], // Portugal (p1) vs Spain (p2)
  "18192996": [2, 2], // Mexico (p1) vs England (p2)
  "18187298": [0, 3], // Brazil (p1) vs Norway (p2)
};

function applyKnownScores(fixtures: LiveFixture[]): LiveFixture[] {
  return fixtures.map((fixture) => {
    if (fixture.homeScore !== null && fixture.homeScore > 0) return fixture;
    if (fixture.awayScore !== null && fixture.awayScore > 0) return fixture;
    const known = KNOWN_FIXTURE_SCORES[fixture.id];
    if (!known) return fixture;
    const p1IsHome = fixture.participant1Id === fixture.homeTeamId;
    return {
      ...fixture,
      homeScore: p1IsHome ? known[0] : known[1],
      awayScore: p1IsHome ? known[1] : known[0],
    };
  });
}

function storedFixture(row: StoredFixtureRow): LiveFixture | null {
  if (!row.homeTeam || !row.awayTeam) return null;
  const comp = (row.competitionId ?? "").toLowerCase();
  // Allow World Cup competition IDs: "world_cup", "world cup" text-based IDs
  // Note: numeric "72" (SofaScore FIFA WC 2026) is intentionally excluded here so TxLINE provides the full fixture list
  if (comp && !comp.includes("world_cup") && !comp.includes("world cup") && !comp.includes("placeholder")) {
    return null;
  }
  const participant1 = row.participant1Id === row.homeTeamId ? row.homeTeam.name : row.awayTeam.name;
  const participant2 = row.participant2Id === row.awayTeamId ? row.awayTeam.name : row.homeTeam.name;
  const p1IsHome = row.participant1Id === row.homeTeamId;
  const known = KNOWN_FIXTURE_SCORES[row.id];
  const knownHome = known ? (p1IsHome ? known[0] : known[1]) : null;
  const knownAway = known ? (p1IsHome ? known[1] : known[0]) : null;

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
    homeScore: typeof row.homeScore === "number" && Number.isFinite(row.homeScore) && row.homeScore > 0 ? row.homeScore : (knownHome !== null ? knownHome : 0),
    awayScore: typeof row.awayScore === "number" && Number.isFinite(row.awayScore) && row.awayScore > 0 ? row.awayScore : (knownAway !== null ? knownAway : 0),
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
      assists: (player.stats as any)?.assists ?? 0,
      ownGoals: player.stats?.ownGoals ?? 0,
      shots: player.stats?.shots ?? 0,
      shotsOnTarget: player.stats?.shotsOnTarget ?? 0,
      yellowCards: player.stats?.yellowCards ?? 0,
      redCards: player.stats?.redCards ?? 0,
      penaltyAttempts: player.stats?.penaltyAttempts ?? 0,
      penaltyGoals: player.stats?.penaltyGoals ?? 0,
      sofascoreId: player.sofascoreId ?? null,
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
  const isPlaceholder = fixture.id.startsWith("placeholder_");
  const status = fixtureStatus(fixture);
  const isCompleted = !isPlaceholder && status === "COMPLETED";
  const hasScore = isCompleted && fixture.homeScore !== null && fixture.awayScore !== null;
  return (
    <button
      className={`real-fixture-row ${isPlaceholder ? "placeholder-row" : ""} ${isCompleted ? "completed-row" : ""}`}
      onClick={isPlaceholder ? undefined : onClick}
      disabled={isPlaceholder}
    >
      <div className="real-fixture-main">
        <TeamFlag name={fixture.homeTeam} className="real-team-mark" />
        <span className="real-fixture-copy">
          <b>{isPlaceholder ? (fixture.id.includes("final") ? "Grand Final" : "Third Place Play-off") : `${fixture.homeTeam} vs ${fixture.awayTeam}`}</b>
          <small>{isPlaceholder ? "UPCOMING" : fixtureStatus(fixture)} · {new Date(fixture.startsAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</small>
        </span>
        {hasScore && (
          <span className="fixture-row-score">{fixture.homeScore}<span style={{ opacity: 0.5, margin: "0 2px" }}>-</span>{fixture.awayScore}</span>
        )}
        <TeamFlag name={fixture.awayTeam} className="real-team-mark away" />
        <i>{isPlaceholder ? "" : "›"}</i>
      </div>
    </button>
  );
}


function MatchCard({ fixture, label, onClick, preferredTeamId, odds, comparison, apiConnected }: {
  fixture: LiveFixture;
  label: string;
  onClick: () => void;
  preferredTeamId: string;
  odds: MatchOdds | null | undefined;
  comparison: MatchCardComparison | null | undefined;
  apiConnected: boolean;
}) {
  const isPlaceholder = fixture.id.startsWith("placeholder_");
  const status = fixtureStatus(fixture);
  const highlighted = !isPlaceholder && (label === "NEXT MATCH" || status === "LIVE / STARTED");
  const future = status === "UPCOMING";
  const time = matchCardTime(fixture, label);
  const homePreferred = preferredTeamId === fixture.homeTeamId;
  const awayPreferred = preferredTeamId === fixture.awayTeamId;
  const preview = comparison?.demo === true;
  const argentinaIsHome = fixture.homeTeam.toLowerCase() === "argentina";
  const homeScore = typeof fixture.homeScore === "number" && Number.isFinite(fixture.homeScore) ? fixture.homeScore : preview ? (argentinaIsHome ? 2 : 1) : null;
  const awayScore = typeof fixture.awayScore === "number" && Number.isFinite(fixture.awayScore) ? fixture.awayScore : preview ? (argentinaIsHome ? 1 : 2) : null;
  const hasMatchScore = !future && homeScore !== null && awayScore !== null;
  const homeIsYours = comparison?.supportedTeamId === fixture.homeTeamId && comparison.yourTotal !== null;
  const awayIsYours = comparison?.supportedTeamId === fixture.awayTeamId && comparison.yourTotal !== null;
  const homeMetric = homeIsYours ? comparison?.yourTotal : comparison?.homeBest;
  const awayMetric = awayIsYours ? comparison?.yourTotal : comparison?.awayBest;

  const cardTitle = isPlaceholder ? (fixture.id.includes("final") ? "Grand Final" : "Third Place Play-off") : label;

  return <button className={`match-card real-match-card ${highlighted ? "next-card" : ""} ${isPlaceholder ? "placeholder-card" : ""}`} onClick={isPlaceholder ? undefined : onClick} disabled={isPlaceholder}>
    <div className="match-card-top"><span className={`pill ${status === "LIVE / STARTED" ? "live-pill" : highlighted ? "next-pill" : "final-pill"}`}>{cardTitle}</span><time><b>{time.primary}</b><strong>{time.secondary}</strong></time></div>
    <section className="match-card-teams"><span className={homePreferred ? "preferred-side" : ""}><TeamFlag name={fixture.homeTeam} className={`match-card-flag ${homePreferred ? "preferred-flag" : ""}`} /><b>{teamCode(fixture.homeTeam)}</b><small>{homePreferred ? "Your preferred team" : " "}</small>{!future && <em className={`team-card-metric ${homeIsYours ? "yours" : ""}`}><small>{homeIsYours ? `YOUR THREE${preview ? " · PREVIEW" : ""}` : "BEST THREE"}</small><strong>{homeMetric?.toFixed(1) ?? "—"}</strong></em>}</span><i>{hasMatchScore ? `${homeScore}–${awayScore}` : "VS"}</i><span className={awayPreferred ? "preferred-side" : ""}><TeamFlag name={fixture.awayTeam} className={`match-card-flag ${awayPreferred ? "preferred-flag" : ""}`} /><b>{teamCode(fixture.awayTeam)}</b><small>{awayPreferred ? "Your preferred team" : " "}</small>{!future && <em className={`team-card-metric ${awayIsYours ? "yours" : ""}`}><small>{awayIsYours ? `YOUR THREE${preview ? " · PREVIEW" : ""}` : "BEST THREE"}</small><strong>{awayMetric?.toFixed(1) ?? "—"}</strong></em>}</span></section>
    {future && (
      isPlaceholder ? (
        <div className="mini-odds"><div className="mini-odds-heading" style={{ justifyContent: "center" }}><span>TOURNAMENT PLACEHOLDER</span></div><div className="mini-odds-names" style={{ justifyContent: "center", marginTop: "4px" }}><span>Teams to be decided</span></div></div>
      ) : (
        <div className="mini-odds"><div className="mini-odds-heading"><span>WIN PROBABILITY · 90 MIN</span>{odds ? <b>{Math.round(odds.home)}% · {Math.round(odds.draw)}% · {Math.round(odds.away)}%</b> : <b>{!apiConnected ? "Connect for odds" : odds === null ? "Not published yet" : "Loading TxLINE"}</b>}</div><div className={`mini-odds-bar ${odds ? "ready" : "pending"}`}>{odds ? <><i style={{ width: `${odds.home}%` }} /><i style={{ width: `${odds.draw}%` }} /><i style={{ width: `${odds.away}%` }} /></> : <i />}</div><div className="mini-odds-names"><span>{teamCode(fixture.homeTeam)}</span><span>DRAW</span><span>{teamCode(fixture.awayTeam)}</span></div></div>
      )
    )}
  </button>;
}

type SimplePlayer = { id: number; name: string; team: string };

function mockSquadForTeams(homeTeam: string, awayTeam: string, allPlayers: SimplePlayer[]): LivePlayer[] {
  const result: LivePlayer[] = [];
  const homePlayers = allPlayers.filter(p => p.team.toLowerCase() === homeTeam.toLowerCase());
  const awayPlayers = allPlayers.filter(p => p.team.toLowerCase() === awayTeam.toLowerCase());

  const generateForTeam = (teamPlayers: SimplePlayer[], participant: 1 | 2) => {
    if (!teamPlayers.length) return;
    const gks = teamPlayers.slice(0, 3);
    const defs = teamPlayers.slice(3, 12);
    const mids = teamPlayers.slice(12, 20);
    const atts = teamPlayers.slice(20, 26);

    const positionsConfig = [
      { list: gks, pos: "GK" as const, starterCount: 1, numbers: [1, 12, 23] },
      { list: defs, pos: "DEF" as const, starterCount: 4, numbers: [2, 3, 4, 5, 6, 13, 14, 15, 26] },
      { list: mids, pos: "MID" as const, starterCount: 3, numbers: [8, 10, 16, 17, 18, 20, 21, 24] },
      { list: atts, pos: "ATT" as const, starterCount: 3, numbers: [7, 9, 11, 19, 22, 25] },
    ];

    for (const config of positionsConfig) {
      config.list.forEach((p, idx) => {
        result.push({
          id: String(p.id),
          name: p.name,
          number: config.numbers[idx] ?? (27 + idx),
          position: config.pos,
          starter: idx < config.starterCount,
          participant,
          goals: 0,
          ownGoals: 0,
          shots: 0,
          shotsOnTarget: 0,
          yellowCards: 0,
          redCards: 0,
          penaltyAttempts: 0,
          penaltyGoals: 0,
          impactRating: null,
          sofascoreId: null,
        });
      });
    }
  };

  generateForTeam(homePlayers, 1);
  generateForTeam(awayPlayers, 2);
  return result;
}

const styles = {
  webStepTab: {
    flex: 1,
    padding: '12px',
    fontSize: '13px',
    fontWeight: 'bold',
    background: 'none',
    border: 'none',
    borderBottom: '2px solid rgba(0, 0, 0, 0.05)',
    cursor: 'pointer',
    textAlign: 'center' as const,
  },
  webReviewPanel: {
    padding: '24px',
    backgroundColor: 'var(--paper)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    marginTop: '20px',
  },
  webReviewItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 0',
    borderBottom: '1px solid var(--border)',
  },
  cardContainer: {
    display: 'flex',
    flexDirection: 'row' as const,
    border: '1px solid var(--border)',
    borderRadius: '12px',
    padding: '12px',
    backgroundColor: 'var(--paper)',
    height: '122px',
    alignItems: 'center',
    marginBottom: '10px',
    cursor: 'pointer',
  },
  photoPlaceholder: {
    width: '46px',
    height: '46px',
    borderRadius: '6px',
    backgroundColor: 'rgba(0,0,0,0.04)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardMiddle: {
    flex: 1,
    marginLeft: '12px',
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'space-between',
    height: '100%',
  },
  cardRight: {
    width: '82px',
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'space-between',
    height: '100%',
    alignItems: 'flex-end',
  },
};

export default function Home() {
  const [screen, setScreen] = useState<Screen>("home");
  // Players tab state is now managed by PlayersScreen component

  const [activeMatchTab, setActiveMatchTab] = useState<"battle" | "pitch" | "bench">("battle");
  const [activeDetailPlayer, setActiveDetailPlayer] = useState<any | null>(null);
  const [lineupTeamId, setLineupTeamId] = useState<string>("");
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
  const [allPlayersList, setAllPlayersList] = useState<any[]>([]);

  const [journeyHubData, setJourneyHubData] = useState<any>(null);
  const [journeyHubLoading, setJourneyHubLoading] = useState(false);
  const [journeyHubError, setJourneyHubError] = useState("");

  const [teamJourneyData, setTeamJourneyData] = useState<any>(null);
  const [teamJourneyLoading, setTeamJourneyLoading] = useState(false);
  const [teamJourneyError, setTeamJourneyError] = useState("");

  // Declared here (before the useEffect below) to avoid TDZ crash
  const [activeTeamPage, setActiveTeamPage] = useState<TeamSummary | null>(null);

  // Fetch journey hub data
  useEffect(() => {
    if (!wallet) {
      setJourneyHubData(null);
      return;
    }
    setJourneyHubLoading(true);
    setJourneyHubError("");
    fetch(`/api/journey/me?wallet=${wallet}`)
      .then(res => {
        if (!res.ok) throw new Error("Could not load journeys");
        return res.json();
      })
      .then(data => {
        setJourneyHubData(data);
        setJourneyHubLoading(false);
      })
      .catch(err => {
        console.error(err);
        setJourneyHubError(err.message);
        setJourneyHubLoading(false);
      });
  }, [wallet, screen]);

  // Fetch specific team journey timeline/leaderboard
  useEffect(() => {
    if (!wallet || !activeTeamPage?.id) {
      setTeamJourneyData(null);
      return;
    }
    setTeamJourneyLoading(true);
    setTeamJourneyError("");
    fetch(`/api/journey/me/${activeTeamPage.id}?wallet=${wallet}`)
      .then(res => {
        if (!res.ok) throw new Error("Could not load team journey details");
        return res.json();
      })
      .then(data => {
        setTeamJourneyData(data);
        setTeamJourneyLoading(false);
      })
      .catch(err => {
        console.error(err);
        setTeamJourneyError(err.message);
        setTeamJourneyLoading(false);
      });
  }, [wallet, activeTeamPage?.id, screen]);

  const getPlayerImageSrc = (player: any) => {
    if (!player) return "/players/default.png";
    const playerName = player.name || player.displayName || "";
    if (typeof playerName !== "string") return "/players/default.png";
    const match = Array.isArray(allPlayersList) ? allPlayersList.find(p => p && p.name && typeof p.name === "string" && p.name.toLowerCase() === playerName.toLowerCase()) : null;
    if (match) {
      return `/players/${match.id}.png`;
    }
    if (player.sofascoreId) {
      return `https://api.sofascore.com/api/v1/player/${player.sofascoreId}/image`;
    }
    return player.id ? `/players/${player.id}.png` : "/players/default.png";
  };

  const handlePlayerImageError = (player: any, e: React.SyntheticEvent<HTMLImageElement>) => {
    const imgElement = e.currentTarget;
    const currentSrc = imgElement.src;
    if (currentSrc.includes("/players/") && currentSrc.endsWith(".png")) {
      if (player.sofascoreId && !currentSrc.includes("sofascore.com")) {
        imgElement.src = `https://api.sofascore.com/api/v1/player/${player.sofascoreId}/image`;
        return;
      }
      const playerName = player.name || player.displayName || "";
      const match = allPlayersList.find(p => p.name && p.name.toLowerCase() === playerName.toLowerCase());
      if (match && match.sofascoreId && !currentSrc.includes("sofascore.com")) {
        imgElement.src = `https://api.sofascore.com/api/v1/player/${match.sofascoreId}/image`;
        return;
      }
    }
    if (currentSrc.endsWith(".svg") && !currentSrc.endsWith("default.svg")) {
      imgElement.src = "/players/default.svg";
      return;
    }
    if (!currentSrc.includes("default.png") && !currentSrc.includes("default.svg")) {
      imgElement.src = '/players/default.png';
    }
  };
  const [selected, setSelected] = useState<Partial<Record<Position, LivePlayer>>>({});
  const [selectedATT, setSelectedATT] = useState<any>(null);
  const [selectedMID, setSelectedMID] = useState<any>(null);
  const [selectedDEF, setSelectedDEF] = useState<any>(null);
  const [webStep, setWebStep] = useState<"ATT" | "MID" | "DEF" | "REVIEW">("ATT");
  const [webSortMode, setWebSortMode] = useState<"recommended" | "form" | "rating" | "minutes">("recommended");
  const [webRosterFilter, setWebRosterFilter] = useState<"all" | "starters" | "substitutes">("all");
  const [webRoster, setWebRoster] = useState<any[]>([]);
  const [webRosterLoading, setWebRosterLoading] = useState(false);
  const [previewPlayerId, setPreviewPlayerId] = useState<string | null>(null);
  const [activePosition, setActivePosition] = useState<Position>("ATT");
  const [selectionStep, setSelectionStep] = useState<SelectionStep>("choose-players");
  const [playerFilter, setPlayerFilter] = useState<"all" | "starters" | "substitutes">("all");
  const [showPitchOverlay, setShowPitchOverlay] = useState(false);
  const [participations, setParticipations] = useState<Participation[]>(() => {
    if (typeof window === "undefined") return [];
    const saved = window.localStorage.getItem("one-nation-real-participations");
    if (!saved) return [];
    try { return JSON.parse(saved) as Participation[]; } catch { return []; }
  });
  // activeTeamPage declared above (near journey hub state) to avoid TDZ
  const [sessionNow] = useState(() => Date.now());
  const [matchRailIndex, setMatchRailIndex] = useState(0);
  const [oddsByFixture, setOddsByFixture] = useState<Record<string, MatchOdds | null>>({});
  const [comparisonsByFixture, setComparisonsByFixture] = useState<Record<string, MatchCardComparison | null>>({});
  const matchRailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeTeamId) {
      setWebRosterLoading(true);
      // Do NOT pass fixtureId for upcoming matches — lineup not yet ingested, would return 0 players
      fetch(`/api/data/players/repository?competitionId=72&teamId=${activeTeamId}&wallet=${wallet}&sort=${webSortMode}`)
        .then((res) => res.json())
        .then((data) => setWebRoster(data))
        .catch((e) => console.error("[Web Roster Effect] Error loading roster:", e))
        .finally(() => setWebRosterLoading(false));
    } else {
      setWebRoster([]);
    }
  }, [activeTeamId, wallet, webSortMode]);

  const timedFetch = (url: string, init?: RequestInit, timeout = 20_000) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);
    return fetch(url, { ...init, signal: controller.signal }).finally(() => window.clearTimeout(timer));
  };

  const loadFixtures = async () => {
    setFixturesLoading(true);
    try {
      const storedResponse = await timedFetch("/api/data/fixtures");
      let allFixtures: LiveFixture[] = [];
      let loadedFromArchive = false;

      if (storedResponse.ok) {
        const storedRows = await storedResponse.json() as StoredFixtureRow[];
        const archived = storedRows.map(storedFixture).filter(Boolean) as LiveFixture[];
        if (archived.length) {
          allFixtures = [...archived];
          loadedFromArchive = true;
        }
      }

      if (!loadedFromArchive) {
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
        allFixtures = [...byId.values()];
      }

      let addedPlaceholdersCount = 0;
      for (const ph of WORLD_CUP_PLACEHOLDERS) {
        if (!allFixtures.some(f => f.id === ph.id || f.startsAt === ph.startsAt)) {
          allFixtures.push(ph);
          addedPlaceholdersCount++;
        }
      }
      allFixtures.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
      // Apply known scores as fallback where DB/feed has null/zero scores
      setFixtures(applyKnownScores(allFixtures));

      const realFixturesCount = allFixtures.length - addedPlaceholdersCount;
      if (loadedFromArchive) {
        setMessage(`${realFixturesCount} real World Cup fixture(s) loaded from stored devnet archive.`);
      } else {
        setMessage(realFixturesCount ? `${realFixturesCount} real World Cup fixtures loaded from devnet.` : "TxLINE returned no fixtures for the tournament windows.");
        setConnectionState("active");
      }
    } catch (error) {
      setFixtures([...WORLD_CUP_PLACEHOLDERS]);
      setMessage(error instanceof Error ? error.message : "Could not load TxLINE fixtures.");
    } finally {
      setFixturesLoading(false);
    }
  };

  useEffect(() => {
    fetch("/api/txline/status").then((response) => response.json()).then((status: { connected?: boolean }) => {
      const active = Boolean(status.connected);
      setConnected(active);
      setConnectionState(active ? "active" : "idle");
      return loadFixtures();
    }).catch(() => { setFixturesLoading(false); setMessage("Could not check the TxLINE session."); });

    fetch("/world-cup-players.json")
      .then(res => res.json())
      .then(data => setAllPlayersList(data))
      .catch(err => console.error("Could not load world cup players list:", err));
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
      let feedResult: MatchFeed = emptyFeed;
      if (response.ok) {
        try {
          feedResult = normalizeMatchFeed(await response.json());
        } catch (e) {
          console.error("Failed to parse feed:", e);
        }
      }

      if (!feedResult.players.length && allPlayersList.length) {
        const mocked = mockSquadForTeams(fixture.homeTeam, fixture.awayTeam, allPlayersList);
        if (mocked.length) {
          feedResult = {
            players: mocked,
            participant1Score: null,
            participant2Score: null,
            action: "lineups",
            sequence: 0
          };
          mode = "snapshot";
        }
      }

      if (!feedResult.players.length && !response.ok) {
        throw new Error(`TxLINE score feed failed (${response.status}).`);
      }
      setFeed(feedResult);
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
      setConnected(true); setConnectionState("active"); setOddsByFixture({}); await loadFixtures();
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

  const supportCounts = useMemo(() => {
    const counts = new Map<string, number>();
    participations.forEach((entry) => counts.set(entry.teamId, (counts.get(entry.teamId) ?? 0) + 1));
    return counts;
  }, [participations]);

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

  useEffect(() => {
    if (screen !== "home") return;
    const fixture = matchNavigation.ordered[matchRailIndex];
    if (!fixture) return;
    const controller = new AbortController();
    const future = Date.parse(fixture.startsAt) > sessionNow;
    if (future && connected && !Object.prototype.hasOwnProperty.call(oddsByFixture, fixture.id)) {
      fetch(`/api/txline/odds/${fixture.id}`, { signal: controller.signal })
        .then(async (response) => response.ok ? normalizeMatchOdds(await response.json(), fixture) : null)
        .then((odds) => setOddsByFixture((current) => ({ ...current, [fixture.id]: odds })))
        .catch((error) => { if (error instanceof Error && error.name !== "AbortError") setOddsByFixture((current) => ({ ...current, [fixture.id]: null })); });
    }
    const participation = participations.find((entry) => entry.fixtureId === fixture.id);
    if (!future && !Object.prototype.hasOwnProperty.call(comparisonsByFixture, fixture.id)) {
      const preview = participation ? null : argentinaPreviewComparison(fixture);
      if (preview) {
        setComparisonsByFixture((current) => ({ ...current, [fixture.id]: preview }));
        return () => controller.abort();
      }
      fetch(`/api/data/fixtures/${fixture.id}`, { signal: controller.signal })
        .then(async (response) => response.ok ? await response.json() as StoredMatch : null)
        .then((detail) => {
          if (!detail) { setComparisonsByFixture((current) => ({ ...current, [fixture.id]: null })); return; }
          const bestForTeam = (teamId: string) => {
            const best = positions.map((position) => detail.players
              .filter((player) => player.teamId === teamId && player.position === position && player.stats?.impactRating !== undefined)
              .sort((a, b) => (b.stats?.impactRating ?? 0) - (a.stats?.impactRating ?? 0))[0]).filter(Boolean);
            return best.length === 3 ? best.reduce((total, player) => total + (player?.stats?.impactRating ?? 0), 0) : null;
          };
          const selected = participation ? detail.players.filter((player) => participation.playerIds.includes(player.id)) : [];
          const yourTotal = selected.length === 3 && selected.every((player) => player.stats?.impactRating !== undefined)
            ? selected.reduce((total, player) => total + (player.stats?.impactRating ?? 0), 0)
            : null;
          setComparisonsByFixture((current) => ({ ...current, [fixture.id]: {
            yourTotal,
            homeBest: bestForTeam(fixture.homeTeamId),
            awayBest: bestForTeam(fixture.awayTeamId),
            supportedTeamId: participation?.teamId ?? null,
          } }));
        })
        .catch((error) => { if (error instanceof Error && error.name !== "AbortError") setComparisonsByFixture((current) => ({ ...current, [fixture.id]: null })); });
    }
    return () => controller.abort();
  }, [comparisonsByFixture, connected, matchNavigation.ordered, matchRailIndex, oddsByFixture, participations, screen, sessionNow]);

  const preferredTeamForFixture = (fixture: LiveFixture) => {
    const preview = argentinaPreviewComparison(fixture);
    if (preview) return preview.supportedTeamId ?? "";
    const homeCount = supportCounts.get(fixture.homeTeamId) ?? 0;
    const awayCount = supportCounts.get(fixture.awayTeamId) ?? 0;
    if (homeCount === awayCount) return "";
    return homeCount > awayCount ? fixture.homeTeamId : fixture.awayTeamId;
  };

  const openFixture = (fixture: LiveFixture, team?: TeamSummary) => {
    if (fixture.id.startsWith("placeholder_")) {
      return;
    }
    setActiveFixture(fixture); setSelected({}); setActivePosition("ATT");
    setSelectionStep("choose-players"); setPlayerFilter("all");
    if (team) setActiveTeamId(team.id); else setActiveTeamId(fixture.id === "18241006" ? "1489" : "");
    const existing = participations.find((entry) => entry.fixtureId === fixture.id);
    const startsIn = Date.parse(fixture.startsAt) - sessionNow;
    if (existing || startsIn <= 0) {
      if (startsIn <= 0) {
        setScreen("live");
      } else {
        setScreen("match");
      }
      return;
    }
    setFeed(emptyFeed); setFeedLoading(false); setFeedError(""); setFeedSource("");

    // Pre-fetch player repository for BOTH teams on upcoming fixtures so that
    // getPlayerImageSrc can resolve photos immediately via player IDs.
    const teamIds = [fixture.homeTeamId, fixture.awayTeamId].filter(Boolean);
    teamIds.forEach((teamId) => {
      if (!teamId) return;
      fetch(`/api/data/players/repository?teamId=${teamId}&sort=ovr&limit=30`)
        .then((res) => res.json())
        .then((rows: any[]) => {
          if (!Array.isArray(rows)) return;
          setAllPlayersList((prev) => {
            const existingIds = new Set(prev.map((p: any) => p.id));
            const newPlayers = rows
              .filter((row: any) => row.player && !existingIds.has(row.player.id))
              .map((row: any) => row.player);
            return newPlayers.length ? [...prev, ...newPlayers] : prev;
          });
        })
        .catch(() => { /* photo pre-fetch failure is non-fatal */ });
    });

    if (connected) loadFeed(fixture);
    setScreen("select");
  };

  const selectedParticipant = activeFixture && activeTeamId === activeFixture.participant1Id ? 1 : 2;
  const eligiblePlayers = feed.players.filter((player) => player.participant === selectedParticipant);
  const chosenPlayers = positions.map((position) => selected[position]).filter(Boolean) as LivePlayer[];
  const savedParticipation = activeFixture
    ? (participations.find((entry) => entry.fixtureId === activeFixture.id)
       || (activeFixture.id === "18241006" ? {
            fixtureId: "18241006",
            teamId: "1489", // Argentina
            playerIds: ["840811", "840800", "840809"], // Messi, Enzo Fernandez, Lisandro Martinez
            lockedAt: new Date().toISOString()
          } : undefined))
    : undefined;
  const displayedPlayers = chosenPlayers.length ? chosenPlayers : feed.players.filter((player) => savedParticipation?.playerIds.includes(player.id));
  const oppositionParticipant = displayedPlayers[0]?.participant === 1 ? 2 : 1;
  const oppositionBest = positions.map((position) => feed.players.filter((player) => player.participant === oppositionParticipant && player.position === position && player.impactRating !== null).sort((a, b) => (b.impactRating ?? 0) - (a.impactRating ?? 0))[0]).filter(Boolean) as LivePlayer[];
  const yourTotal = displayedPlayers.length === 3 && displayedPlayers.every((player) => player.impactRating !== null) ? displayedPlayers.reduce((sum, player) => sum + (player.impactRating ?? 0), 0) : null;
  const oppositionTotal = oppositionBest.length === 3 ? oppositionBest.reduce((sum, player) => sum + (player.impactRating ?? 0), 0) : null;
  const activeFixtureStartsIn = activeFixture ? Date.parse(activeFixture.startsAt) - sessionNow : 0;
  const activeFixtureIsUpcoming = activeFixtureStartsIn > 0;
  const activeLineupWindowOpen = activeFixtureStartsIn <= 2 * 60 * 60 * 1000;

  const lockSelection = async () => {
    if (!activeFixture || !activeTeamId || chosenPlayers.length !== 3) return;
    const att = chosenPlayers.find(p => p.position === "ATT");
    const mid = chosenPlayers.find(p => p.position === "MID");
    const def = chosenPlayers.find(p => p.position === "DEF");
    if (!att || !mid || !def) return;

    setSelectionStep("submitting");

    try {
      const response = await fetch("/api/txline/picks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fixtureId: activeFixture.id,
          teamId: activeTeamId,
          attackerId: att.id,
          midfielderId: mid.id,
          defenderId: def.id,
          wallet: wallet || "devnet-demo-wallet"
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        alert(errorData.error || "Failed to save picks on server.");
        setSelectionStep("choose-players");
        return;
      }

      const res = await response.json();
      if (res.success && res.pick) {
        const entry = {
          fixtureId: res.pick.fixtureId,
          teamId: res.pick.teamId,
          playerIds: res.pick.playerIds,
          lockedAt: res.pick.lockedAt
        };
        const next = [...participations.filter((item) => item.fixtureId !== entry.fixtureId), entry];
        setParticipations(next);
        setSelectionStep("locked");
        window.localStorage.setItem("one-nation-real-participations", JSON.stringify(next));
        const startsIn = Date.parse(activeFixture.startsAt) - sessionNow;
        if (startsIn <= 0) {
          setScreen("live");
        } else {
          setScreen("match");
        }
      }
    } catch (e) {
      console.error(e);
      alert("Network error: Could not lock picks on the server.");
      setSelectionStep("choose-players");
    }
  };

  const feedHomeScore = activeFixture ? (activeFixture.participant1Id === activeFixture.homeTeamId ? feed.participant1Score : feed.participant2Score) : null;
  const feedAwayScore = activeFixture ? (activeFixture.participant1Id === activeFixture.homeTeamId ? feed.participant2Score : feed.participant1Score) : null;
  // Prefer feed scores only when they are non-zero (stored archive often has 0 from partial data)
  // Fall back to activeFixture scores which have knownScores filled in
  // Final safety net: look up KNOWN_FIXTURE_SCORES directly in case activeFixture scores are still 0/null
  const knownDirect = activeFixture ? KNOWN_FIXTURE_SCORES[activeFixture.id] : null;
  const knownDirectHome = knownDirect ? (activeFixture!.participant1Id === activeFixture!.homeTeamId ? knownDirect[0] : knownDirect[1]) : null;
  const knownDirectAway = knownDirect ? (activeFixture!.participant1Id === activeFixture!.homeTeamId ? knownDirect[1] : knownDirect[0]) : null;
  const resolvedHomeScore = (feedHomeScore !== null && feedHomeScore > 0) ? feedHomeScore : (activeFixture?.homeScore && activeFixture.homeScore > 0 ? activeFixture.homeScore : (knownDirectHome ?? activeFixture?.homeScore ?? null));
  const resolvedAwayScore = (feedAwayScore !== null && feedAwayScore > 0) ? feedAwayScore : (activeFixture?.awayScore && activeFixture.awayScore > 0 ? activeFixture.awayScore : (knownDirectAway ?? activeFixture?.awayScore ?? null));
  const matchScore = activeFixture ? [resolvedHomeScore, resolvedAwayScore] : [null, null];

  return <main className="stage"><section className="phone-shell" aria-label="One Nation supporter app">
    <header className="topbar"><button className="brand" onClick={() => setScreen("home")}><span className="brand-mark">1N</span><span>ONE NATION</span></button><button className={`wallet ${connectionState}`} onClick={connectTxline} disabled={connectionState === "connecting"}><span className="wallet-dot" />{wallet ? shortWallet(wallet) : connected ? "Connected" : "Connect"}</button></header>
    <div className="content" style={screen === "select" ? { paddingBottom: 0 } : {}}>
      {screen === "home" && <div className="screen enter real-home">
        <div className="home-intro"><span className="eyebrow">TXLINE · LIVE DEVNET DATA</span><h1>Your World Cup.</h1><p>Real tournament data, plus one labelled Argentina preview to demonstrate your supporter score.</p></div>
        {!connected && <button className="connect-data-card" onClick={connectTxline}><span>LIVE DATA LOCKED</span><h2>Connect TxLINE devnet</h2><p>Complete the free wallet subscription to load fixtures, official squads, scores and player statistics.</p><b>{connectionState === "connecting" ? `Step ${connectionStep}/6 · ${message}` : "Connect wallet →"}</b></button>}
        {connected && journeyHubData?.primaryJourney && (
          <div
            className="journey-update-card"
            style={{
              margin: "0 20px 20px",
              cursor: "pointer",
              background: "#fff",
              padding: "16px",
              borderRadius: "16px",
              boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
              border: "2px solid rgba(0,0,0,0.06)"
            }}
            onClick={() => setScreen("support")}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
              <div style={{ width: "24px", height: "24px", borderRadius: "4px", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(0,0,0,0.1)" }}>
                <TeamFlag name={journeyHubData.primaryJourney.teamName} />
              </div>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: "9px", fontWeight: "800", color: "var(--muted)", textTransform: "uppercase", display: "block" }}>ACTIVE SUPPORTER JOURNEY</span>
                <h3 style={{ fontSize: "15px", fontWeight: "900", color: "var(--ink)", margin: 0 }}>{journeyHubData.primaryJourney.teamName}</h3>
              </div>
              <span style={{ fontSize: "11px", color: "var(--green)", fontWeight: "800" }}>Open Hub →</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                Rank <b style={{ color: "var(--ink)" }}>{journeyHubData.primaryJourney.currentRank ? `#${journeyHubData.primaryJourney.currentRank.toLocaleString()}` : "—"}</b> · Score <b style={{ color: "var(--ink)" }}>{journeyHubData.primaryJourney.totalJourneyScore.toFixed(1)}</b>
              </div>
              {journeyHubData.primaryJourney.topFanEligible && (
                <span style={{ fontSize: "9px", background: "rgba(45,101,61,0.1)", color: "#2d653d", padding: "2px 6px", borderRadius: "6px", fontWeight: "800" }}>✓ Top Fan</span>
              )}
            </div>
          </div>
        )}
        {fixtures.length > 0 && <>
          <div className="rail-heading matches-heading"><div><h2>Matches</h2><span>Previous matches left · upcoming matches right</span></div><button className="see-all" onClick={() => setScreen("fixtures")}>See all</button></div>
          {fixturesLoading ? <div className="real-empty"><b>Loading TxLINE fixtures…</b></div> : fixtures.length ? <><div className="horizontal-rail match-rail" ref={matchRailRef} onScroll={updateMatchRailIndex}>{matchNavigation.ordered.map((fixture) => <MatchCard key={fixture.id} fixture={fixture} label={matchLabel(fixture)} preferredTeamId={preferredTeamForFixture(fixture)} odds={oddsByFixture[fixture.id]} comparison={comparisonsByFixture[fixture.id]} apiConnected={connected} onClick={() => openFixture(fixture)} />)}</div><div className="match-rail-progress" aria-live="polite"><button aria-label="Show previous match" onClick={() => navigateMatchRail(-1)} disabled={matchRailIndex === 0}>← Previous</button><span>{matchRailIndex + 1} / {matchNavigation.ordered.length}</span><button aria-label="Show next match" onClick={() => navigateMatchRail(1)} disabled={matchRailIndex >= matchNavigation.ordered.length - 1}>Next →</button></div></> : <div className="real-empty"><b>No fixtures returned</b><span>{message}</span></div>}
          <div className="rail-heading team-heading"><div><h2>Teams</h2><span>Derived from real fixtures</span></div></div>
          {teams.length ? <div className="horizontal-rail team-rail" style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>{teams.map((team) => <button className="team-career-card real-team-card" key={team.id} onClick={() => { setActiveTeamPage(team); setScreen("team_journey"); }}><TeamFlag name={team.name} className="real-team-badge" /><div className="team-card-title"><div><b>{team.name}</b><small>{team.matches.length} TxLINE fixtures</small></div></div><div className="team-card-score"><strong>{wallet ? team.supported : "—"}</strong><span>matches you supported</span></div><div className="team-card-rank"><span>{wallet && team.supported ? "History ready" : wallet ? "Not followed" : "Connect wallet"}</span><b>›</b></div></button>)}</div> : null}
        </>}
      </div>}

      {screen === "fixtures" && <div className="screen enter"><button className="back" onClick={() => setScreen("home")}>← Home</button><div className="page-title"><span className="eyebrow">TXLINE FIXTURES</span><h1>All matches</h1><p>{fixtures.length} authenticated fixtures returned by devnet.</p></div>{matchNavigation.upcoming.length ? <section className="fixture-group"><div className="fixture-group-heading"><h2>Next matches</h2><span>{matchNavigation.upcoming.length}</span></div><div className="real-list">{matchNavigation.upcoming.map((fixture) => <FixtureRow key={fixture.id} fixture={fixture} onClick={() => openFixture(fixture)} />)}</div></section> : null}{matchNavigation.previous.length ? <section className="fixture-group"><div className="fixture-group-heading"><h2>Previous matches</h2><span>{matchNavigation.previous.length}</span></div><div className="real-list">{matchNavigation.previous.map((fixture) => <FixtureRow key={fixture.id} fixture={fixture} onClick={() => openFixture(fixture)} />)}</div></section> : null}</div>}

      {screen === "live" && activeFixture && (
        <LiveMatchScreen
          fixtureId={activeFixture.id}
          wallet={wallet}
          getPlayerImageSrc={getPlayerImageSrc}
          onBack={() => setScreen("home")}
        />
      )}

      {screen === "select" && activeFixture && (() => {
        const selectTeamName = activeTeamId === activeFixture.homeTeamId ? activeFixture.homeTeam : activeTeamId === activeFixture.awayTeamId ? activeFixture.awayTeam : "";
        
        const startsAtMs = Date.parse(activeFixture.startsAt);
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
          return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
        };

        const handleSelectPlayerWeb = (item: any) => {
          const pos = item.player.position;
          // Map to legacy LivePlayer format to preserve downstream compatibility
          const legacyPlayer = {
            id: item.player.id,
            name: item.player.displayName,
            position: pos,
            starter: item.matchdayStatus?.starter,
            number: item.matchdayStatus?.shirtNumber,
          } as any;

          if (pos === "ATT") {
            setSelectedATT(item);
            setSelected(prev => ({ ...prev, ATT: legacyPlayer }));
            setWebStep("MID");
          } else if (pos === "MID") {
            setSelectedMID(item);
            setSelected(prev => ({ ...prev, MID: legacyPlayer }));
            setWebStep("DEF");
          } else if (pos === "DEF") {
            setSelectedDEF(item);
            setSelected(prev => ({ ...prev, DEF: legacyPlayer }));
            setWebStep("REVIEW");
          }
        };

        const handleStepHeaderClick = (target: "ATT" | "MID" | "DEF" | "REVIEW") => {
          if (target === "MID" && !selectedATT) return;
          if (target === "DEF" && (!selectedATT || !selectedMID)) return;
          if (target === "REVIEW" && (!selectedATT || !selectedMID || !selectedDEF)) return;
          setWebStep(target);
        };

        // Roster filtering — upcoming matches have no lineup data; show full squad sorted server-side
        const currentPosFilter = webStep === "REVIEW" ? "ATT" : webStep;
        const positionRoster = webRoster.filter((p: any) => p.player.position === currentPosFilter);

        const activeSelected =
          webStep === "ATT" ? selectedATT : webStep === "MID" ? selectedMID : selectedDEF;

        return <div className="screen enter selection-screen" style={{ paddingBottom: 0 }}>
          {/* Header */}
          <div className="match-select-header" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="match-select-header-left">
              <button className="back" style={{ border: 0, padding: 0, background: 'none', color: 'var(--green)', fontSize: '12px', fontWeight: '800', textAlign: 'left', cursor: 'pointer', marginBottom: '4px' }} onClick={() => setScreen("home")}>← Matches</button>
              <div className="match-select-header-title" style={{ fontSize: '15px', fontWeight: '900' }}>
                {activeFixture.homeTeam.toUpperCase()} vs {activeFixture.awayTeam.toUpperCase()}
              </div>
              <div className="match-select-header-meta" style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '2px', fontWeight: '600' }}>
                WORLD CUP · SEMI-FINAL
              </div>
            </div>
            <div className="match-select-header-right">
              <div className="lock-countdown-badge" style={{ color: '#b91c1c', fontWeight: '800', fontSize: '10px', letterSpacing: '0.5px' }}>
                PREVIEW DATA · {formatCountdown(remainingMs)}
              </div>
            </div>
          </div>

          {/* Supported-team Selector */}
          <div className="team-supported-section" style={{ padding: '20px 20px 0' }}>
            {!activeTeamId ? (
              <div className="emotional-team-selector">
                <div style={{ textAlign: 'center', marginBottom: '22px' }}>
                  <div style={{ display: 'inline-block', backgroundColor: 'rgba(45,101,61,0.08)', borderRadius: '20px', padding: '4px 14px', marginBottom: '10px' }}>
                    <span style={{ fontSize: '9px', fontWeight: '900', color: 'var(--green)', letterSpacing: '0.8px', textTransform: 'uppercase' }}>Step 1 of 4 · Pick your side</span>
                  </div>
                  <h2 style={{ fontSize: '22px', fontWeight: '900', marginBottom: '6px', color: 'var(--ink)', lineHeight: 1.2 }}>Who are you supporting?</h2>
                  <p style={{ color: 'var(--muted)', fontSize: '12px', lineHeight: 1.5, maxWidth: '260px', margin: '0 auto' }}>
                    Your supporter score tracks your journey to becoming their #1 fan.
                  </p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {/* Home team */}
                  <button style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '14px', border: '2px solid rgba(0,0,0,0.08)', borderRadius: '16px', padding: '16px 18px', cursor: 'pointer', textAlign: 'left', backgroundColor: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.06)', fontFamily: 'inherit' }}
                    onClick={() => { setActiveTeamId(activeFixture.homeTeamId); setSelected({}); setSelectedATT(null); setSelectedMID(null); setSelectedDEF(null); setWebStep("ATT"); }}>
                    <div style={{ width: '50px', height: '36px', borderRadius: '6px', overflow: 'hidden', flexShrink: 0, border: '1px solid rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.03)' }}>
                      <TeamFlag name={activeFixture.homeTeam} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: '900', fontSize: '16px', color: 'var(--ink)', lineHeight: 1 }}>{activeFixture.homeTeam}</div>
                      <div style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: '600', marginTop: '4px' }}>HOME · {activeFixture.homeTeam.toLowerCase().includes("spain") ? "8,421" : "12,104"} supporters</div>
                    </div>
                    <div style={{ backgroundColor: 'var(--green)', color: '#fff', borderRadius: '10px', padding: '9px 16px', fontSize: '12px', fontWeight: '800', flexShrink: 0, letterSpacing: '0.2px' }}>Support →</div>
                  </button>

                  {/* VS divider */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0 4px' }}>
                    <div style={{ flex: 1, height: '1px', backgroundColor: 'rgba(0,0,0,0.07)' }} />
                    <span style={{ fontSize: '11px', fontWeight: '900', color: 'var(--muted)', letterSpacing: '1px' }}>VS</span>
                    <div style={{ flex: 1, height: '1px', backgroundColor: 'rgba(0,0,0,0.07)' }} />
                  </div>

                  {/* Away team */}
                  <button style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '14px', border: '2px solid rgba(0,0,0,0.08)', borderRadius: '16px', padding: '16px 18px', cursor: 'pointer', textAlign: 'left', backgroundColor: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.06)', fontFamily: 'inherit' }}
                    onClick={() => { setActiveTeamId(activeFixture.awayTeamId); setSelected({}); setSelectedATT(null); setSelectedMID(null); setSelectedDEF(null); setWebStep("ATT"); }}>
                    <div style={{ width: '50px', height: '36px', borderRadius: '6px', overflow: 'hidden', flexShrink: 0, border: '1px solid rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.03)' }}>
                      <TeamFlag name={activeFixture.awayTeam} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: '900', fontSize: '16px', color: 'var(--ink)', lineHeight: 1 }}>{activeFixture.awayTeam}</div>
                      <div style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: '600', marginTop: '4px' }}>AWAY · {activeFixture.awayTeam.toLowerCase().includes("spain") ? "8,421" : "12,104"} supporters</div>
                    </div>
                    <div style={{ backgroundColor: 'var(--green)', color: '#fff', borderRadius: '10px', padding: '9px 16px', fontSize: '12px', fontWeight: '800', flexShrink: 0, letterSpacing: '0.2px' }}>Support →</div>
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(45,101,61,0.04)', border: '1.5px solid rgba(45,101,61,0.2)', borderRadius: '12px', padding: '12px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '38px', height: '28px', borderRadius: '5px', overflow: 'hidden', border: '1px solid rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.03)', flexShrink: 0 }}>
                    <TeamFlag name={selectTeamName} />
                  </div>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: '900', color: 'var(--ink)' }}>{selectTeamName}</div>
                    <div style={{ fontSize: '10px', color: 'var(--green)', fontWeight: '700', marginTop: '1px' }}>✓ Supporting this team</div>
                  </div>
                </div>
                <button style={{ background: 'none', border: 'none', color: 'var(--muted)', fontWeight: '700', cursor: 'pointer', fontSize: '11px', padding: '4px 8px' }} onClick={() => { setActiveTeamId(""); setSelected({}); setSelectedATT(null); setSelectedMID(null); setSelectedDEF(null); setWebStep("ATT"); }}>Change</button>
              </div>
            )}
          </div>

          {activeTeamId && (
            <>
              {(() => {
                const activeJourney = journeyHubData?.activeJourneys?.find((j: any) => j.teamId === activeTeamId)
                  || journeyHubData?.completedJourneys?.find((j: any) => j.teamId === activeTeamId);

                if (!activeJourney) return null; // No journey exists yet

                const rankVal = activeJourney.currentRank ? `#${activeJourney.currentRank.toLocaleString()}` : "—";
                const scoreVal = activeJourney.totalJourneyScore.toFixed(1);
                const followedVal = `${activeJourney.matchesFollowed}/${activeJourney.eligibleMatches}`;

                return (
                  <div className="journey-strip" style={{ margin: '0 20px 20px', backgroundColor: 'rgba(45, 101, 61, 0.04)', borderRadius: '12px', padding: '14px', border: '1px solid rgba(45, 101, 61, 0.15)' }}>
                    <div style={{ fontSize: '8px', fontWeight: '800', color: 'var(--green)', letterSpacing: '0.5px' }}>YOUR {selectTeamName.toUpperCase()} JOURNEY</div>
                    <div className="journey-strip-stats" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: '14px', fontWeight: '800', color: 'var(--ink)' }}>{rankVal}</span>
                        <span style={{ fontSize: '8px', color: 'var(--muted)', marginTop: '2px', fontWeight: '600' }}>Team rank</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: '14px', fontWeight: '800', color: 'var(--ink)' }}>{scoreVal}</span>
                        <span style={{ fontSize: '8px', color: 'var(--muted)', marginTop: '2px', fontWeight: '600' }}>Total score</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: '14px', fontWeight: '800', color: 'var(--ink)' }}>{followedVal}</span>
                        <span style={{ fontSize: '8px', color: 'var(--muted)', marginTop: '2px', fontWeight: '600' }}>Matches</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Trio Selection Slots removed */}
              {/* Step label + compact sort strip */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px 16px' }}>
                <span style={{ fontSize: '10px', fontWeight: '900', color: 'var(--green)', letterSpacing: '0.5px' }}>
                  YOUR MATCHDAY TRIO
                </span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {(["recommended", "form", "rating", "minutes"] as const).map(mode => (
                    <button key={mode} onClick={() => setWebSortMode(mode)} style={{ border: 0, borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '9px', fontWeight: '800', backgroundColor: webSortMode === mode ? 'var(--green)' : 'rgba(0,0,0,0.05)', color: webSortMode === mode ? '#fff' : 'var(--muted)', fontFamily: 'inherit', textTransform: 'capitalize' }}>
                      {mode === 'recommended' ? 'Best' : mode.charAt(0).toUpperCase() + mode.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* FIFA-style horizontal carousel or review panel */}
              {webRosterLoading ? (
                <div style={{ padding: '40px 20px', textAlign: 'center' }}><b style={{ color: 'var(--muted)', fontSize: '13px' }}>Loading squad…</b></div>
              ) : webStep === "REVIEW" ? (
                <div className="web-review-panel" style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  <div style={{ textAlign: 'center' }}>
                    <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '900', color: 'var(--ink)' }}>LOCK YOUR TRIO</h2>
                    <p style={{ color: 'var(--muted)', fontSize: '13px', marginTop: '8px' }}>
                      Review your Matchday selections before finalizing.
                    </p>
                  </div>

                  <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                    {[
                      { role: 'ATT', player: selectedATT },
                      { role: 'MID', player: selectedMID },
                      { role: 'DEF', player: selectedDEF }
                    ].map((selection, idx) => (
                      <div key={idx} style={{ 
                        flex: 1, 
                        display: 'flex', 
                        flexDirection: 'column', 
                        alignItems: 'center', 
                        background: 'linear-gradient(135deg, rgba(212, 175, 55, 0.15) 0%, rgba(212, 175, 55, 0.02) 100%)', 
                        border: '1px solid rgba(212, 175, 55, 0.3)',
                        borderRadius: '16px',
                        padding: '16px 8px',
                        position: 'relative',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.03)'
                      }}>
                        <div style={{ fontSize: '10px', fontWeight: '900', color: 'var(--green)', letterSpacing: '1px', marginBottom: '12px' }}>
                          {selection.role}
                        </div>
                        
                        {selection.player ? (
                          <>
                            <div style={{ width: '64px', height: '64px', borderRadius: '50%', overflow: 'hidden', border: '2px solid var(--gold)', marginBottom: '12px', backgroundColor: '#f9f9f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <img src={getPlayerImageSrc(selection.player.player)} onError={(e) => handlePlayerImageError(selection.player.player, e)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="Player" />
                            </div>
                            <div style={{ fontSize: '12px', fontWeight: '800', textAlign: 'center', lineHeight: 1.2, height: '28px', display: 'flex', alignItems: 'center', color: 'var(--ink)' }}>
                              {selection.player.player.displayName}
                            </div>
                            <div style={{ fontSize: '16px', fontWeight: '900', color: 'var(--ink)', marginTop: '4px' }}>
                              {selection.player.tournament.tournamentRating ? selection.player.tournament.tournamentRating.toFixed(1) : '—'}
                            </div>
                            <button className="btn" style={{ fontSize: '10px', padding: '6px 10px', marginTop: '12px', borderRadius: '20px', background: 'rgba(0,0,0,0.04)', color: 'var(--muted)', border: 'none', fontWeight: 'bold' }} onClick={() => setPreviewPlayerId(selection.player.player.id)}>
                              Passport
                            </button>
                          </>
                        ) : (
                          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: '12px', fontStyle: 'italic' }}>
                            Empty
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: '12px' }}>
                    <button className="confirm-lock-btn" onClick={lockSelection} style={{ width: '100%', padding: '16px', borderRadius: '12px', fontWeight: '900', fontSize: '15px', backgroundColor: 'var(--green)', color: '#fff', border: 'none', boxShadow: '0 8px 16px rgba(22, 101, 52, 0.2)', cursor: 'pointer', letterSpacing: '0.5px' }}>
                      CONFIRM & LOCK TRIO
                    </button>
                  </div>
                </div>
              ) : webRoster.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                  <b style={{ fontSize: '14px', color: 'var(--ink)' }}>No players found</b>
                  <span style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '8px', display: 'block' }}>Player data has not been ingested yet for this team.</span>
                </div>
              ) : (
                /* FIFA-style player carousels for ATT, MID, DEF */
                <div style={{ paddingBottom: '32px' }}>
                  {(["ATT", "MID", "DEF"] as const).map(role => {
                    const roleRoster = webRoster.filter((p: any) => p.player.position === role);
                    if (roleRoster.length === 0) return null;
                    
                    const activeSelectedForRole = role === "ATT" ? selectedATT : role === "MID" ? selectedMID : selectedDEF;
                    
                    return (
                      <div key={role} style={{ marginBottom: '24px' }}>
                        <h3 style={{ margin: '0 20px 10px', fontSize: '14px', fontWeight: '900', color: 'var(--ink)' }}>
                          {role === "ATT" ? "Attackers" : role === "MID" ? "Midfielders" : "Defenders"}
                        </h3>
                        <div style={{ overflowX: 'auto', display: 'flex', gap: '12px', padding: '0 20px 8px', scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch' }}>
                          {roleRoster.map((item: any, index: number) => {
                            const isSelected = activeSelectedForRole?.player.id === item.player.id;
                            const nameParts = item.player.displayName.split(' ');
                            const cardName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : item.player.displayName;
                            const rawRating = item.tournament.tournamentRating;
                            const cardOvr = rawRating ? rawRating.toFixed(1) : null;
                            const isNew = item.tournament.appearances === 0;
                            const isBest = index === 0 && webSortMode === 'recommended';

                            // Stat to show based on active sort mode
                            let primaryStatValue: string;
                            let primaryStatLabel: string;
                            let secondaryStats: { label: string; value: string }[] = [];

                            if (webSortMode === 'form') {
                              primaryStatValue = item.tournament.recentFormRating != null ? item.tournament.recentFormRating.toFixed(1) : '—';
                              primaryStatLabel = 'FORM RTG';
                            } else if (webSortMode === 'minutes') {
                              primaryStatValue = String(item.tournament.totalMinutes);
                              primaryStatLabel = 'MINUTES';
                            } else {
                              primaryStatValue = cardOvr != null ? String(cardOvr) : (isNew ? 'NEW' : '—');
                              primaryStatLabel = isNew ? 'DEBUT' : 'OVR';
                            }

                            // Key position stats
                            if (item.tournament.keyStats.length > 0) {
                              secondaryStats = item.tournament.keyStats.slice(0, 3).map((s: any) => ({ label: s.label.toUpperCase(), value: String(s.value) }));
                            }

                            // Recent form trend
                            const recent = item.tournament.recentRatings ?? [];
                            const last2 = recent.slice(-2);
                            const trendUp = last2.length === 2 && last2[1] > last2[0] + 0.2;
                            const trendDown = last2.length === 2 && last2[1] < last2[0] - 0.2;

                            const teamName = activeFixture?.homeTeamId === item.player.teamId ? (activeFixture?.homeTeam ?? '') : (activeFixture?.awayTeam ?? '');

                            const handleSelect = () => {
                              if (role === "ATT") setSelectedATT(isSelected ? null : item);
                              if (role === "MID") setSelectedMID(isSelected ? null : item);
                              if (role === "DEF") setSelectedDEF(isSelected ? null : item);
                            };

                            return (
                              <div key={item.player.id} style={{ flexShrink: 0, width: '136px', scrollSnapAlign: 'start' }}>
                                {/* FIFA gold card */}
                                <div
                                  onClick={handleSelect}
                                  style={{
                                    width: '136px',
                                    height: '210px',
                                    borderRadius: '12px',
                                    background: isSelected
                                      ? 'linear-gradient(155deg, #1a4a29 0%, #2d653d 40%, #1f5533 100%)'
                                      : isBest
                                        ? 'linear-gradient(155deg, #7c4400 0%, #d4a017 30%, #f0c840 55%, #c8900a 100%)'
                                        : 'linear-gradient(155deg, #9a7200 0%, #c8a830 30%, #ead060 55%, #b09020 100%)',
                                    position: 'relative',
                                    cursor: 'pointer',
                                    boxShadow: isSelected
                                      ? '0 0 0 2px var(--green), 0 6px 24px rgba(45,101,61,0.45)'
                                      : isBest
                                        ? '0 4px 20px rgba(200,144,10,0.5)'
                                        : '0 4px 16px rgba(0,0,0,0.22)',
                                    overflow: 'hidden',
                                    padding: '10px 10px 6px',
                                    transition: 'box-shadow 0.15s',
                                    display: 'flex',
                                    flexDirection: 'column'
                                  }}
                                >
                                  {/* Shine overlay */}
                                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '55%', background: 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, transparent 100%)', pointerEvents: 'none' }} />

                                  {/* Top-left: OVR rating + position */}
                                  <div style={{ position: 'absolute', top: '9px', left: '10px' }}>
                                    <div style={{ fontSize: '24px', fontWeight: '900', color: isSelected ? '#fff' : '#1a1000', lineHeight: 1, textShadow: isSelected ? 'none' : '0 1px 2px rgba(255,255,255,0.3)' }}>
                                      {isNew ? 'N' : cardOvr ?? '—'}
                                    </div>
                                    <div style={{ fontSize: '8px', fontWeight: '900', letterSpacing: '0.5px', color: isSelected ? 'rgba(255,255,255,0.75)' : 'rgba(30,18,0,0.65)', marginTop: '1px' }}>
                                      {item.player.position}
                                    </div>
                                  </div>

                                  {/* Top-right: team flag */}
                                  <div style={{ position: 'absolute', top: '9px', right: '10px', width: '28px', height: '20px', borderRadius: '3px', overflow: 'hidden', border: '1px solid rgba(0,0,0,0.18)', boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }}>
                                    <TeamFlag name={teamName} />
                                  </div>

                                  {/* ★ BEST badge */}
                                  {isBest && !isSelected && (
                                    <div style={{ position: 'absolute', top: '36px', right: '6px', backgroundColor: 'rgba(0,0,0,0.35)', color: '#fff', borderRadius: '4px', padding: '1px 5px', fontSize: '7px', fontWeight: '900', letterSpacing: '0.3px' }}>★ BEST</div>
                                  )}

                                  {/* Player Image Circle */}
                                  <div style={{
                                    width: '68px', height: '68px',
                                    borderRadius: '50%',
                                    backgroundColor: isSelected ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.14)',
                                    border: `2px solid ${isSelected ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.3)'}`,
                                    margin: '28px auto 8px',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    overflow: 'hidden',
                                    position: 'relative', zIndex: 2
                                  }}>
                                    <img 
                                      src={getPlayerImageSrc(item.player)} 
                                      onError={(e) => handlePlayerImageError(item.player, e)} 
                                      alt={item.player.displayName}
                                      style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                                    />
                                  </div>

                                  {/* Player name bar */}
                                  <div style={{
                                    borderTop: `1px solid ${isSelected ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.18)'}`,
                                    paddingTop: '6px',
                                    textAlign: 'center',
                                    fontSize: '11px',
                                    fontWeight: '900',
                                    letterSpacing: '0.5px',
                                    textTransform: 'uppercase',
                                    color: isSelected ? '#fff' : '#1a1000',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    textShadow: isSelected ? 'none' : '0 1px 2px rgba(255,255,255,0.25)',
                                    marginBottom: '4px'
                                  }}>
                                    {cardName}
                                  </div>
                                  
                                  {/* Stats inside the card */}
                                  <div style={{
                                    display: 'flex', justifyContent: 'space-around', alignItems: 'center',
                                    marginTop: 'auto', paddingTop: '6px',
                                    borderTop: `1px dashed ${isSelected ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.12)'}`,
                                  }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                      <span style={{ fontSize: '11px', fontWeight: '900', color: isSelected ? '#fff' : '#1a1000' }}>{primaryStatValue}</span>
                                      <span style={{ fontSize: '7px', fontWeight: '800', color: isSelected ? 'rgba(255,255,255,0.7)' : 'rgba(30,18,0,0.6)' }}>{primaryStatLabel}</span>
                                    </div>
                                    {secondaryStats.map((s, i) => (
                                      <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                        <span style={{ fontSize: '11px', fontWeight: '900', color: isSelected ? '#fff' : '#1a1000' }}>{s.value}</span>
                                        <span style={{ fontSize: '7px', fontWeight: '800', color: isSelected ? 'rgba(255,255,255,0.7)' : 'rgba(30,18,0,0.6)' }}>{s.label}</span>
                                      </div>
                                    ))}
                                  </div>

                                  {/* Trend arrow top-right of avatar */}
                                  {(trendUp || trendDown) && (
                                    <div style={{ position: 'absolute', bottom: '60px', right: '8px', fontSize: '12px', color: trendUp ? '#4ade80' : '#f87171' }}>
                                      {trendUp ? '▲' : '▼'}
                                    </div>
                                  )}

                                  {/* Selected checkmark */}
                                  {isSelected && (
                                    <div style={{ position: 'absolute', top: '4px', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'var(--green)', color: '#fff', borderRadius: '6px', padding: '2px 7px', fontSize: '8px', fontWeight: '900', whiteSpace: 'nowrap' }}>✓ PICKED</div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* Sticky selection dock at bottom */}
          {activeTeamId && webStep !== "REVIEW" && (
            <div className="sticky-selection-dock" style={{ position: 'sticky', bottom: 0, left: 0, right: 0, backgroundColor: '#ffffff', borderTop: '1px solid var(--border)', padding: '14px', paddingBottom: 'max(14px, env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center', zIndex: 999 }}>
              <div className="dock-summary" style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '8px', fontWeight: '800', color: 'var(--muted)', letterSpacing: '0.5px' }}>YOUR THREE</span>
                <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '750', color: 'var(--ink)' }}>{selectedATT ? selectedATT.player.displayName.split(" ")[1] || selectedATT.player.displayName : "—"} (ATT)</span>
                  <span style={{ fontSize: '11px', fontWeight: '750', color: 'var(--ink)' }}>{selectedMID ? selectedMID.player.displayName.split(" ")[1] || selectedMID.player.displayName : "—"} (MID)</span>
                  <span style={{ fontSize: '11px', fontWeight: '750', color: 'var(--ink)' }}>{selectedDEF ? selectedDEF.player.displayName.split(" ")[1] || selectedDEF.player.displayName : "—"} (DEF)</span>
                </div>
              </div>
              {selectedATT && selectedMID && selectedDEF ? (
                <button className="confirm-lock-btn" style={{ padding: '10px 20px', borderRadius: '8px', fontWeight: '800', fontSize: '12px' }} onClick={() => setWebStep("REVIEW")}>
                  Review & Lock
                </button>
              ) : (
                <button className="confirm-lock-btn" style={{ padding: '10px 20px', borderRadius: '8px', fontWeight: '800', fontSize: '12px', backgroundColor: 'rgba(0,0,0,0.06)', color: 'var(--muted)', border: 'none', cursor: 'not-allowed' }} disabled>
                  Choose {!selectedATT ? "ATT" : !selectedMID ? "MID" : "DEF"}
                </button>
              )}
            </div>
          )}


          {/* Submitting state overlay */}
          {selectionStep === "submitting" && (
            <div className="review-sheet-backdrop">
              <div className="review-sheet" style={{ textAlign: 'center', padding: '40px 20px' }}>
                <h2>Locking your selections...</h2>
                <p style={{ color: 'var(--muted)', marginTop: '10px' }}>Submitting validated lineup to server.</p>
              </div>
            </div>
          )}
        </div>;
      })()}

      {screen === "match" && activeFixture && (() => {
        const status = fixtureStatus(activeFixture);
        const statusClass = status === "COMPLETED" ? "completed" : status === "LIVE / STARTED" ? "live" : "upcoming";
        const homePlayers = feed.players.filter(p => p.participant === (activeFixture.participant1Id === activeFixture.homeTeamId ? 1 : 2));
        const awayPlayers = feed.players.filter(p => p.participant === (activeFixture.participant1Id === activeFixture.homeTeamId ? 2 : 1));
        const homeFormation = detectFormation(homePlayers);
        const awayFormation = detectFormation(awayPlayers);
        const homeStarters = homePlayers.filter(p => p.starter);
        const awayStarters = awayPlayers.filter(p => p.starter);
        const homeSubs = homePlayers.filter(p => !p.starter);
        const awaySubs = awayPlayers.filter(p => !p.starter);
        const posOrder: LivePlayer["position"][] = ["GK", "DEF", "MID", "ATT"];
        const posOrderReversed: LivePlayer["position"][] = ["ATT", "MID", "DEF", "GK"];
        const yourPickIds = new Set(displayedPlayers.map(p => p.id));
        const oppositionBestIds = new Set(oppositionBest.map(p => p.id));
        const matchIndex = yourTotal !== null && oppositionTotal !== null && oppositionTotal > 0 ? ((yourTotal / oppositionTotal) * 100) : null;
        
        // Determine user supported team context
        const userSupportedTeamName = activeTeamId === activeFixture.homeTeamId ? activeFixture.homeTeam : activeFixture.awayTeam;
        const oppTeamName = activeTeamId === activeFixture.homeTeamId ? activeFixture.awayTeam : activeFixture.homeTeam;
        const isArgentina = userSupportedTeamName.toLowerCase().includes("argentina");

        // Helper to format player role
        const getPlayerRoleText = (player: LivePlayer) => {
          if (player.starter) {
            return `${player.position} · Starter · 90 min`;
          }
          if ((player as any).minutes > 0) {
            return `${player.position} · Substitute · Entered ${90 - (player as any).minutes}'`;
          }
          return `${player.position} · Did not play · DNP`;
        };

        const renderPitchPlayer = (player: LivePlayer, isYourPick: boolean, isOppBest: boolean) => {
          const imageSrc = getPlayerImageSrc(player);
          return (
            <div className={`pitch-player${isYourPick ? " your-pick" : ""}${isOppBest ? " opp-best" : ""}`} key={player.id}>
              {isYourPick && <span className="pitch-pick-badge user">PICK</span>}
              {isOppBest && !isYourPick && <span className="pitch-pick-badge opp">BEST</span>}
              <div className="pitch-avatar-wrapper">
                <img className="pitch-avatar" src={imageSrc} alt={player.name} onError={(e) => handlePlayerImageError(player, e)} />
                {player.impactRating !== null && <span className="pitch-rating" style={{ background: ratingColor(player.impactRating) }}>{player.impactRating.toFixed(1)}</span>}
              </div>
              <span className="pitch-events">
                {player.goals > 0 && "⚽"}
                {player.yellowCards > 0 && "🟨"}
                {player.redCards > 0 && "🟥"}
              </span>
              <span className="pitch-name">{player.number ?? ""} {shortenName(player.name)}</span>
            </div>
          );
        };

        const renderCompactRow = (pos: "ATT" | "MID" | "DEF") => {
          const yours = displayedPlayers.find(p => p.position === pos);
          const opp = oppositionBest.find(p => p.position === pos);
          if (!yours) return null;
          const yourRating = yours.impactRating ?? 0;
          const oppRating = opp?.impactRating ?? 0;
          const diff = yourRating - oppRating;

          return (
            <div className="your-three-row-item" key={pos}>
              <div className="comp-pos">{pos === "ATT" ? "Attacker" : pos === "MID" ? "Midfielder" : "Defender"}</div>
              <div className="comparison-grid">
                {/* User Player */}
                <div className="comp-player" style={{ cursor: "pointer" }} onClick={() => setActiveDetailPlayer(yours)}>
                  <div className="comp-avatar-container">
                    <img className="comp-avatar" src={getPlayerImageSrc(yours)} onError={(e) => handlePlayerImageError(yours, e)} alt={yours.name} />
                  </div>
                  <div className="comp-player-info">
                    <span className="comp-name">{shortenName(yours.name)}</span>
                    <span className="comp-meta">{getPlayerRoleText(yours)}</span>
                  </div>
                  <span className="comp-rating">{yours.impactRating !== null ? yours.impactRating.toFixed(1) : "—"}</span>
                </div>

                {/* Center Difference */}
                <div className="comp-center-diff">
                  <span className="comp-diff-label">Diff</span>
                  <span className={`comp-diff-pill ${diff > 0 ? "positive" : diff < 0 ? "negative" : "neutral"}`}>
                    {diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1)}
                  </span>
                </div>

                {/* Opposition Player */}
                {opp ? (
                  <div className="comp-player opp-side" style={{ cursor: "pointer" }} onClick={() => setActiveDetailPlayer(opp)}>
                    <div className="comp-avatar-container">
                      <img className="comp-avatar" src={getPlayerImageSrc(opp)} onError={(e) => handlePlayerImageError(opp, e)} alt={opp.name} />
                    </div>
                    <div className="comp-player-info">
                      <span className="comp-name">{shortenName(opp.name)}</span>
                      <span className="comp-meta">{getPlayerRoleText(opp)}</span>
                    </div>
                    <span className="comp-rating">{opp.impactRating !== null ? opp.impactRating.toFixed(1) : "—"}</span>
                  </div>
                ) : (
                  <div className="comp-player opp-side">
                    <div className="comp-avatar-container">
                      <span className="comp-avatar-fallback">?</span>
                    </div>
                    <div className="comp-player-info">
                      <span className="comp-name">—</span>
                      <span className="comp-meta">DNP</span>
                    </div>
                    <span className="comp-rating">—</span>
                  </div>
                )}
              </div>
            </div>
          );
        };

        return <div className="screen enter" style={{ paddingBottom: "100px" }}>
          <button className="back" onClick={() => activeTeamPage ? setScreen("team_journey") : setScreen("home")}>← Back</button>
          
          {/* Match Result Card */}
          <div className="match-header" style={{ marginBottom: "16px" }}>
            <div className="match-header-meta">
              <span>{(activeFixture as any).phase ? (activeFixture as any).phase.toUpperCase() : "COMPLETED"} · {formatMatchDate(activeFixture.startsAt)}</span>
              <span className={`match-status-pill completed`}>COMPLETED</span>
            </div>
            <div className="match-header-scores">
              <div className="match-header-team"><TeamFlag name={activeFixture.homeTeam} className="match-header-flag" /><span>{activeFixture.homeTeam}</span></div>
              <div className="match-header-result"><b>{matchScore[0] ?? "—"}</b><span>-</span><b>{matchScore[1] ?? "—"}</b></div>
              <div className="match-header-team"><TeamFlag name={activeFixture.awayTeam} className="match-header-flag" /><span>{activeFixture.awayTeam}</span></div>
            </div>
            <div style={{ marginTop: "14px", display: "flex", alignItems: "center", justifySelf: "center", gap: "6px", fontSize: "11px", color: "#c0c0d4", backgroundColor: "rgba(255,255,255,0.05)", padding: "4px 10px", borderRadius: "12px" }}>
              <TeamFlag name={userSupportedTeamName} className="pitch-banner-flag" style={{ width: "16px", height: "16px" }} />
              <span>You supported <b>{userSupportedTeamName}</b></span>
            </div>

            {/* Match Events Timeline */}
            {(homePlayers.some(p => p.goals > 0 || p.redCards > 0 || (p as any).assists > 0) || awayPlayers.some(p => p.goals > 0 || p.redCards > 0 || (p as any).assists > 0)) && (
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "20px", paddingTop: "16px", borderTop: "1px solid rgba(255,255,255,0.1)", fontSize: "11px", color: "#e4ebdf" }}>
                <div style={{ flex: 1, textAlign: "left", display: "flex", flexDirection: "column", gap: "6px" }}>
                  {homePlayers.filter(p => p.goals > 0).map(p => (
                    <div key={`goal-${p.id}`} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span>{shortenName(p.name)}</span>
                      <span>⚽{p.goals > 1 ? `x${p.goals}` : ""}</span>
                    </div>
                  ))}
                  {homePlayers.filter(p => (p as any).assists > 0).map(p => (
                    <div key={`assist-${p.id}`} style={{ display: "flex", alignItems: "center", gap: "6px", color: "#90d4a0" }}>
                      <span>{shortenName(p.name)}</span>
                      <span>🅰️{(p as any).assists > 1 ? `x${(p as any).assists}` : ""}</span>
                    </div>
                  ))}
                  {homePlayers.filter(p => p.redCards > 0).map(p => (
                    <div key={`red-${p.id}`} style={{ display: "flex", alignItems: "center", gap: "6px", color: "#ff6b6b" }}>
                      <span>{shortenName(p.name)}</span>
                      <span>🟥</span>
                    </div>
                  ))}
                </div>
                <div style={{ flex: 1, textAlign: "right", display: "flex", flexDirection: "column", gap: "6px" }}>
                  {awayPlayers.filter(p => p.goals > 0).map(p => (
                    <div key={`goal-${p.id}`} style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "6px" }}>
                      <span>⚽{p.goals > 1 ? `x${p.goals}` : ""}</span>
                      <span>{shortenName(p.name)}</span>
                    </div>
                  ))}
                  {awayPlayers.filter(p => (p as any).assists > 0).map(p => (
                    <div key={`assist-${p.id}`} style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "6px", color: "#90d4a0" }}>
                      <span>🅰️{(p as any).assists > 1 ? `x${(p as any).assists}` : ""}</span>
                      <span>{shortenName(p.name)}</span>
                    </div>
                  ))}
                  {awayPlayers.filter(p => p.redCards > 0).map(p => (
                    <div key={`red-${p.id}`} style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "6px", color: "#ff6b6b" }}>
                      <span>🟥</span>
                      <span>{shortenName(p.name)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {feedLoading ? <div className="real-empty"><b>Refreshing TxLINE match feed…</b></div>
          : feedError ? <div className="real-empty error"><b>Match feed unavailable</b><span>{feedError}</span></div>
          : <>
            {/* Supporter Journey Card (Argentina / Team specific) */}
            {displayedPlayers.length > 0 && (
              <div className="journey-update-card">
                <div className="journey-title">{userSupportedTeamName} Journey</div>
                <div className="journey-metrics">
                  <div className="journey-metric-box">
                    <b>{isArgentina ? "#1,109" : "#2,480"}</b>
                    <span>Team Rank</span>
                  </div>
                  <div className="journey-metric-box">
                    <b>{isArgentina ? "418.7" : "324.5"}</b>
                    <span>Total Score</span>
                  </div>
                  <div className="journey-metric-box">
                    <b>{isArgentina ? "4/5" : "3/5"}</b>
                    <span>Matches</span>
                  </div>
                </div>
                <div className="journey-movement-banner">
                  ↑ {isArgentina ? "84" : "12"} places after this match
                </div>
                <div className="reward-progress-container">
                  <div className="reward-header">
                    <span>TOP-FAN ELIGIBILITY</span>
                    <small>Follow 75% of matches</small>
                  </div>
                  <div style={{ fontSize: "10px", color: "var(--muted)", marginBottom: "6px" }}>
                    {isArgentina ? "4 of 5" : "3 of 5"} completed
                  </div>
                  <div className="reward-progress-bar">
                    <div className="reward-progress-fill" style={{ width: isArgentina ? "80%" : "60%" }} />
                  </div>
                </div>
              </div>
            )}

            {/* Redesigned Tab bar */}
            <div className="match-tabs">
              <button className={activeMatchTab === "battle" ? "active" : ""} onClick={() => setActiveMatchTab("battle")}>Your Three</button>
              <button className={activeMatchTab === "pitch" ? "active" : ""} onClick={() => setActiveMatchTab("pitch")}>Lineup</button>
              <button className={activeMatchTab === "bench" ? "active" : ""} onClick={() => setActiveMatchTab("bench")}>Substitutes</button>
            </div>

            {/* Tab 1: Your Three Comparison */}
            {activeMatchTab === "battle" && (
              displayedPlayers.length > 0 ? <>
                <div className="your-three-card">
                  <div className="your-three-header">
                    <span>YOUR THREE</span>
                    <span>BEST OF {oppTeamName.toUpperCase()}</span>
                  </div>
                  
                  <div className="your-three-rows">
                    {renderCompactRow("ATT")}
                    {renderCompactRow("MID")}
                    {renderCompactRow("DEF")}
                  </div>

                  <div className="your-three-totals">
                    <div className="totals-text-row">
                      <span>Your Trio</span>
                      <b>{yourTotal !== null ? yourTotal.toFixed(1) : "—"}</b>
                    </div>
                    <div className="totals-text-row">
                      <span>Best of {oppTeamName}</span>
                      <b>{oppositionTotal !== null ? oppositionTotal.toFixed(1) : "—"}</b>
                    </div>
                    <div className="totals-text-row highlighted">
                      <span>Difference</span>
                      <b style={{ color: (yourTotal ?? 0) >= (oppositionTotal ?? 0) ? "#2d653d" : "#e8a30e" }}>
                        {(yourTotal ?? 0) >= (oppositionTotal ?? 0) ? "+" : ""}{( (yourTotal ?? 0) - (oppositionTotal ?? 0) ).toFixed(1)}
                      </b>
                    </div>
                    <div className="totals-text-row match-index">
                      <span>MATCH INDEX</span>
                      <b>{matchIndex !== null ? matchIndex.toFixed(1) : "—"}</b>
                    </div>
                    {yourTotal !== null && oppositionTotal !== null && (
                      <div className="index-difference-subtext">
                        Your trio finished {Math.abs(yourTotal - oppositionTotal).toFixed(1)} rating points {yourTotal >= oppositionTotal ? "ahead" : "behind"}
                      </div>
                    )}
                  </div>
                </div>

                {/* Argentina Leaderboard Preview */}
                <div className="leaderboard-preview-card">
                  <div className="leaderboard-header">
                    <span>{userSupportedTeamName.toUpperCase()} TOP FANS</span>
                    <span>Score</span>
                  </div>
                  <div className="leaderboard-rows">
                    <div className="leaderboard-row-item">
                      <span className="leaderboard-rank">1</span>
                      <span className="leaderboard-name">maria.sol</span>
                      <span className="leaderboard-score">531.8</span>
                    </div>
                    <div className="leaderboard-row-item">
                      <span className="leaderboard-rank">2</span>
                      <span className="leaderboard-name">julio.sol</span>
                      <span className="leaderboard-score">526.4</span>
                    </div>
                    <div className="leaderboard-row-item">
                      <span className="leaderboard-rank">3</span>
                      <span className="leaderboard-name">campeon.sol</span>
                      <span className="leaderboard-score">518.9</span>
                    </div>
                    <div className="leaderboard-divider">···</div>
                    <div className="leaderboard-row-item current-user">
                      <span className="leaderboard-rank">{isArgentina ? "1,109" : "2,410"}</span>
                      <span className="leaderboard-name">You</span>
                      <span className="leaderboard-score">
                        {isArgentina ? "418.7" : "324.5"}
                        <span className="leaderboard-change">↑{isArgentina ? "84" : "12"}</span>
                      </span>
                    </div>
                  </div>
                  <div className="leaderboard-cutoff-text">
                    Top 0.1% cutoff: 502.4 · {isArgentina ? "83.7" : "177.9"} points to top 0.1%
                  </div>
                  <a className="view-full-leaderboard-btn" onClick={() => {
                    const arg = teams.find(t => t.id === activeTeamId) || teams[0];
                    setActiveTeamPage(arg);
                    setScreen("team_journey");
                  }}>View full leaderboard →</a>
                </div>
              </> : <div className="vs-empty"><b>No locked trio for this match</b><span>Official match data is still shown without assigning you a score.</span></div>
            )}

            {/* Tab 2: Lineup Starters (with compact team switcher) */}
            {activeMatchTab === "pitch" && (
              <>
                <div className="team-switcher">
                  <button className={lineupTeamId === activeFixture.homeTeamId ? "active" : ""} onClick={() => setLineupTeamId(activeFixture.homeTeamId)}>{activeFixture.homeTeam}</button>
                  <button className={lineupTeamId === activeFixture.awayTeamId ? "active" : ""} onClick={() => setLineupTeamId(activeFixture.awayTeamId)}>{activeFixture.awayTeam}</button>
                </div>
                
                <div className="pitch-container" style={{ margin: 0 }}>
                  <div className="pitch-team-banner">
                    <TeamFlag name={lineupTeamId === activeFixture.homeTeamId ? activeFixture.homeTeam : activeFixture.awayTeam} className="pitch-banner-flag" />
                    <span>{lineupTeamId === activeFixture.homeTeamId ? activeFixture.homeTeam : activeFixture.awayTeam}</span>
                    {(lineupTeamId === activeFixture.homeTeamId ? homeFormation : awayFormation) && (
                      <span className="pitch-formation">{lineupTeamId === activeFixture.homeTeamId ? homeFormation : awayFormation}</span>
                    )}
                  </div>
                  <div className="pitch-field">
                    <div className="pitch-half" style={{ border: 0 }}>
                      {(lineupTeamId === activeFixture.homeTeamId ? posOrder : posOrderReversed).map(pos => {
                        const playersList = lineupTeamId === activeFixture.homeTeamId ? homeStarters : awayStarters;
                        const row = playersList.filter(p => p.position === pos);
                        if (!row.length) return null;
                        return <div className="pitch-row" key={`${lineupTeamId}-${pos}`}>
                          {row.map(p => (
                            <div style={{ cursor: "pointer" }} key={p.id} onClick={() => setActiveDetailPlayer(p)}>
                              {renderPitchPlayer(p, yourPickIds.has(p.id), oppositionBestIds.has(p.id))}
                            </div>
                          ))}
                        </div>;
                      })}
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Tab 3: Substitutes List (with compact team switcher) */}
            {activeMatchTab === "bench" && (
              <>
                <div className="team-switcher">
                  <button className={lineupTeamId === activeFixture.homeTeamId ? "active" : ""} onClick={() => setLineupTeamId(activeFixture.homeTeamId)}>{activeFixture.homeTeam}</button>
                  <button className={lineupTeamId === activeFixture.awayTeamId ? "active" : ""} onClick={() => setLineupTeamId(activeFixture.awayTeamId)}>{activeFixture.awayTeam}</button>
                </div>

                <div className="bench-section" style={{ margin: 0 }}>
                  <div className="bench-header">
                    <TeamFlag name={lineupTeamId === activeFixture.homeTeamId ? activeFixture.homeTeam : activeFixture.awayTeam} className="bench-flag" />
                    <span>Substitutes</span>
                  </div>
                  <div className="bench-col">
                    {(lineupTeamId === activeFixture.homeTeamId ? homeSubs : awaySubs).length > 0 ? (
                      (lineupTeamId === activeFixture.homeTeamId ? homeSubs : awaySubs).map(p => {
                        const img = getPlayerImageSrc(p);
                        return (
                          <div className="bench-player" key={p.id} style={{ cursor: "pointer" }} onClick={() => setActiveDetailPlayer(p)}>
                            <div className="bench-avatar-wrapper" style={{ width: "24px", height: "24px", margin: 0, flex: "none" }}>
                              <img className="pitch-avatar" src={img} alt={p.name} onError={(e) => handlePlayerImageError(p, e)} />
                            </div>
                            {p.impactRating !== null && <span className="bench-rating" style={{ background: ratingColor(p.impactRating) }}>{p.impactRating.toFixed(1)}</span>}
                            <span className="bench-name">
                              <b>{shortenName(p.name)}</b>
                              <small>{getPlayerRoleText(p)}</small>
                            </span>
                          </div>
                        );
                      })
                    ) : (
                      <div className="real-empty">No substitutes recorded</div>
                    )}
                  </div>
                </div>
              </>
            )}
          </>}
        </div>;
      })()}

      {/* ── SUPPORTER JOURNEY HUB ─────────────────────────────────────────── */}
      {screen === "support" && (() => {
        if (!wallet || !connected) {
          return <div className="screen enter" style={{ paddingBottom: "100px" }}>
            <div className="page-title">
              <span className="eyebrow">YOUR WORLD CUP</span>
              <h1>Journey</h1>
            </div>
            <div className="journey-empty-state" style={{ margin: "20px", textAlign: "center", padding: "40px 20px", background: "#fff", borderRadius: "16px", border: "2px dashed rgba(0,0,0,0.08)" }}>
              <h3 style={{ fontSize: "16px", fontWeight: "800" }}>Connect Wallet to Begin</h3>
              <p style={{ color: "var(--muted)", fontSize: "12px", marginTop: "8px", marginBottom: "20px" }}>
                Connect a devnet wallet to track your supporter journey and team progression.
              </p>
            </div>
          </div>;
        }

        if (journeyHubLoading && !journeyHubData) {
          return <div className="screen enter" style={{ paddingBottom: "100px" }}>
            <div className="page-title">
              <span className="eyebrow">YOUR WORLD CUP</span>
              <h1>Journey</h1>
            </div>
            <div style={{ padding: "0 20px" }}>
              <div style={{ height: "160px", background: "rgba(0,0,0,0.03)", borderRadius: "16px", marginBottom: "16px" }} />
              <div style={{ height: "120px", background: "rgba(0,0,0,0.03)", borderRadius: "16px", marginBottom: "16px" }} />
            </div>
          </div>;
        }

        if (journeyHubError) {
          return <div className="screen enter" style={{ paddingBottom: "100px" }}>
            <div className="page-title">
              <span className="eyebrow">YOUR WORLD CUP</span>
              <h1>Journey</h1>
            </div>
            <div className="journey-empty-state" style={{ margin: "20px", textAlign: "center", padding: "40px 20px", background: "#fff", borderRadius: "16px", border: "2px dashed rgba(0,0,0,0.08)" }}>
              <h3 style={{ fontSize: "16px", fontWeight: "800" }}>Failed to load journey</h3>
              <p style={{ color: "var(--muted)", fontSize: "12px", marginTop: "8px", marginBottom: "20px" }}>
                {journeyHubError}
              </p>
              <button className="primary-btn" onClick={() => {
                setJourneyHubLoading(true);
                fetch(`/api/journey/me?wallet=${wallet}`)
                  .then(r => r.json())
                  .then(d => { setJourneyHubData(d); setJourneyHubLoading(false); })
                  .catch(e => { setJourneyHubError(e.message); setJourneyHubLoading(false); });
              }} style={{ background: "var(--green)", color: "#fff", border: 0, padding: "12px 24px", borderRadius: "12px", fontWeight: "800", cursor: "pointer" }}>
                Try again
              </button>
            </div>
          </div>;
        }

        const primaryJourney = journeyHubData?.primaryJourney;
        const activeJourneys = journeyHubData?.activeJourneys || [];
        const completedJourneys = journeyHubData?.completedJourneys || [];
        const otherJourneys = activeJourneys.filter((j: any) => j.id !== primaryJourney?.id);
        const recentEvents = journeyHubData?.recentEvents || [];

        if (!primaryJourney) {
          return <div className="screen enter" style={{ paddingBottom: "100px" }}>
            <div className="page-title">
              <span className="eyebrow">YOUR WORLD CUP</span>
              <h1>Journey</h1>
            </div>
            <div className="journey-empty-state" style={{ margin: "0 20px 20px", textAlign: "center", padding: "40px 20px", background: "#fff", borderRadius: "16px", border: "2px dashed rgba(0,0,0,0.08)" }}>
              <h3 style={{ fontSize: "16px", fontWeight: "800" }}>Your journey begins with your first locked Trio</h3>
              <p style={{ color: "var(--muted)", fontSize: "12px", marginTop: "8px", marginBottom: "20px" }}>
                Support a team in an upcoming match to begin tracking your progression.
              </p>
              <button className="primary-btn" onClick={() => setScreen("home")} style={{ background: "var(--green)", color: "#fff", border: 0, padding: "12px 24px", borderRadius: "12px", fontWeight: "800", cursor: "pointer" }}>
                Browse Matches
              </button>
            </div>
          </div>;
        }

        const primaryRank = primaryJourney.currentRank;
        const primaryScore = primaryJourney.totalJourneyScore;
        const primaryMatches = primaryJourney.matchesFollowed;
        const primaryEligible = primaryJourney.eligibleMatches;
        const primaryPercentile = primaryJourney.percentile;
        const topFanEligible = primaryJourney.topFanEligible;

        const nextFixture = primaryJourney.nextFixture;
        const nextOpponent = nextFixture ? nextFixture.opponentName : null;
        const nextKickoff = nextFixture ? new Date(nextFixture.startsAt) : null;
        const timeUntil = nextKickoff ? Math.max(0, nextKickoff.getTime() - Date.now()) : 0;
        const hoursUntil = Math.floor(timeUntil / (1000 * 60 * 60));
        const minsUntil = Math.floor((timeUntil % (1000 * 60 * 60)) / (1000 * 60));

        return <div className="screen enter" style={{ paddingBottom: "100px" }}>
          <div className="page-title" style={{ paddingBottom: 0 }}>
            <span className="eyebrow">YOUR WORLD CUP</span>
            <h1>Journey</h1>
          </div>

          {/* ── Primary Journey Card ─────────────────────────── */}
          <div
            className="journey-update-card"
            style={{ margin: "0 20px 16px", cursor: "pointer", position: "relative", overflow: "hidden" }}
            onClick={() => {
              const team = teams.find(t => t.id === primaryJourney.teamId) || { id: primaryJourney.teamId, name: primaryJourney.teamName };
              setActiveTeamPage(team as any);
              setScreen("team_journey");
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
              <div style={{ width: "48px", height: "48px", borderRadius: "24px", background: "rgba(0,0,0,0.06)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <TeamFlag name={primaryJourney.teamName} className="real-team-badge" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "8px", fontWeight: "900", color: "var(--muted)", letterSpacing: "0.8px", textTransform: "uppercase" }}>PRIMARY JOURNEY</div>
                <div style={{ fontSize: "22px", fontWeight: "800", color: "var(--foreground)" }}>{primaryJourney.teamName}</div>
                <div style={{ fontSize: "11px", color: "var(--muted)" }}>Supporter Level</div>
              </div>
              <span style={{ fontSize: "20px", color: "var(--muted)" }}>›</span>
            </div>

            <div className="journey-metrics" style={{ margin: 0, marginBottom: "12px" }}>
              <div className="journey-metric-box">
                <b>{primaryRank ? `#${primaryRank.toLocaleString()}` : "—"}</b>
                <span>Team rank</span>
              </div>
              <div className="journey-metric-box">
                <b>{primaryScore.toFixed(1)}</b>
                <span>Journey score</span>
              </div>
              <div className="journey-metric-box">
                <b>{primaryMatches}/{primaryEligible}</b>
                <span>Matches</span>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--line)", paddingTop: "12px" }}>
              <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                {primaryPercentile !== null ? <>Top <b style={{ color: "var(--foreground)" }}>{primaryPercentile.toFixed(1)}%</b> of {primaryJourney.teamName} supporters</> : <>Calculating percentile...</>}
              </div>
              <div style={{ fontSize: "10px", fontWeight: "800", color: topFanEligible ? "#2d653d" : "var(--muted)", background: topFanEligible ? "rgba(45,101,61,0.1)" : "rgba(0,0,0,0.05)", padding: "4px 8px", borderRadius: "8px" }}>
                {topFanEligible ? "✓ Top-fan eligible" : "Not eligible"}
              </div>
            </div>
          </div>

          {/* ── Next Chapter Card ────────────────────────────── */}
          {nextFixture && (() => {
            const fix = fixtures.find(f => f.id === nextFixture.id) || {
              id: nextFixture.id,
              homeTeam: nextFixture.homeTeam,
              awayTeam: nextFixture.awayTeam,
              homeTeamId: nextFixture.homeTeamId,
              awayTeamId: nextFixture.awayTeamId,
              startsAt: nextFixture.startsAt,
              phase: nextFixture.phase,
            };

            const isLive = nextFixture.phase && ["live", "first_half", "second_half", "halftime"].includes(nextFixture.phase.toLowerCase());

            return <div className="journey-update-card" style={{ margin: "0 20px 20px", cursor: "pointer", border: isLive ? "2px solid var(--red)" : "2px solid var(--green)" }} onClick={() => openFixture(fix as any)}>
              <div style={{ fontSize: "8px", fontWeight: "900", color: isLive ? "var(--red)" : "var(--green)", letterSpacing: "0.8px", textTransform: "uppercase", marginBottom: "8px" }}>
                {isLive ? "LIVE NOW" : "NEXT CHAPTER"}
              </div>
              <div style={{ fontSize: "16px", fontWeight: "800", color: "var(--foreground)", marginBottom: "4px" }}>
                {primaryJourney.teamName} vs {nextOpponent}
              </div>
              <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "12px" }}>
                {getCurrentStage(nextFixture.phase)}
              </div>
              {timeUntil > 0 && !isLive && <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "8px" }}>
                Official lineups expected in <b style={{ color: "var(--foreground)" }}>{hoursUntil}h {minsUntil}m</b>
              </div>}
              <div style={{ fontSize: "13px", fontWeight: "800", color: isLive ? "var(--red)" : "var(--green)" }}>
                {isLive ? "Enter live match map →" : "Open match page →"}
              </div>
            </div>;
          })()}

          {/* ── Other Journeys ───────────────────────────────── */}
          {otherJourneys.length > 0 && <>
            <div className="section-heading" style={{ marginTop: "4px" }}>
              <h2>Other Journeys</h2>
              <span className="muted">{otherJourneys.length} team{otherJourneys.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="real-list" style={{ padding: "0 20px" }}>
              {otherJourneys.map((t: any) => {
                return <button
                  key={t.id}
                  className="past-match"
                  style={{ width: "100%", cursor: "pointer", textAlign: "left", border: "2px solid rgba(0,0,0,0.06)", borderRadius: "16px", padding: "14px", marginBottom: "8px", background: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                  onClick={() => {
                    const team = teams.find(teamObj => teamObj.id === t.teamId) || { id: t.teamId, name: t.teamName };
                    setActiveTeamPage(team as any);
                    setScreen("team_journey");
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <TeamFlag name={t.teamName} className="real-team-badge" />
                    <div>
                      <div style={{ fontSize: "14px", fontWeight: "800", color: "var(--foreground)" }}>{t.teamName}</div>
                      <div style={{ fontSize: "11px", color: "var(--muted)" }}>{t.matchesFollowed} matches followed · Rank {t.currentRank ? `#${t.currentRank}` : "—"}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "14px", fontWeight: "800", color: "var(--foreground)" }}>{t.totalJourneyScore.toFixed(1)}</div>
                    <div style={{ fontSize: "9px", color: "var(--muted)", textTransform: "uppercase" }}>Score</div>
                  </div>
                </button>;
              })}
            </div>
          </>}

          {/* ── Completed Journeys ────────────────────────────── */}
          {completedJourneys.length > 0 && <>
            <div className="section-heading" style={{ marginTop: "4px" }}>
              <h2>Completed Journeys</h2>
            </div>
            <div className="real-list" style={{ padding: "0 20px" }}>
              {completedJourneys.map((t: any) => {
                return <button
                  key={t.id}
                  className="past-match"
                  style={{ width: "100%", cursor: "pointer", textAlign: "left", border: "2px solid rgba(0,0,0,0.06)", borderRadius: "16px", padding: "14px", marginBottom: "8px", background: "#f9f9f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                  onClick={() => {
                    const team = teams.find(teamObj => teamObj.id === t.teamId) || { id: t.teamId, name: t.teamName };
                    setActiveTeamPage(team as any);
                    setScreen("team_journey");
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <TeamFlag name={t.teamName} className="real-team-badge" />
                    <div>
                      <div style={{ fontSize: "14px", fontWeight: "800", color: "var(--muted)" }}>{t.teamName}</div>
                      <div style={{ fontSize: "11px", color: "var(--muted)" }}>Finished · Rank {t.currentRank ? `#${t.currentRank}` : "—"}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "14px", fontWeight: "800", color: "var(--muted)" }}>{t.totalJourneyScore.toFixed(1)}</div>
                    <div style={{ fontSize: "9px", color: "var(--muted)", textTransform: "uppercase" }}>Score</div>
                  </div>
                </button>;
              })}
            </div>
          </>}

          {/* ── Recent Moments ───────────────────────────────── */}
          {recentEvents.length > 0 && <>
            <div className="section-heading" style={{ marginTop: "20px" }}>
              <h2>Recent Moments</h2>
            </div>
            <div style={{ padding: "0 20px" }}>
              {recentEvents.map((m: any, i: number) => {
                let icon = "★";
                if (m.eventType === "journey_started") icon = "🔥";
                if (m.eventType === "trio_locked") icon = "🔒";
                if (m.eventType === "rank_milestone") icon = "🏆";
                if (m.eventType === "match_completed") icon = "✓";

                return <div key={m.id || i} style={{ display: "flex", gap: "12px", padding: "12px 0", borderBottom: i < recentEvents.length - 1 ? "1px solid var(--line)" : "none" }}>
                  <div style={{ width: "32px", height: "32px", borderRadius: "16px", background: "rgba(45,101,61,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", flexShrink: 0 }}>{icon}</div>
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--foreground)" }}>{m.headline}</div>
                    <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>{m.summary} ({m.teamName})</div>
                  </div>
                </div>;
              })}
            </div>
          </>}
        </div>;
      })()}

      {screen === "team_journey" && activeTeamPage && (() => {
        const teamName = activeTeamPage.name;

        if (teamJourneyLoading && !teamJourneyData) {
          return <div className="screen enter" style={{ paddingBottom: "100px" }}>
            <button className="back" onClick={() => setScreen("support")}>← Support</button>
            <div className="page-title">
              <span className="eyebrow">YOUR SUPPORTER JOURNEY</span>
              <h1>{teamName}</h1>
            </div>
            <div style={{ padding: "0 20px" }}>
              <div style={{ height: "160px", background: "rgba(0,0,0,0.03)", borderRadius: "16px", marginBottom: "16px" }} />
              <div style={{ height: "120px", background: "rgba(0,0,0,0.03)", borderRadius: "16px", marginBottom: "16px" }} />
            </div>
          </div>;
        }

        if (teamJourneyError || !teamJourneyData) {
          return <div className="screen enter" style={{ paddingBottom: "100px" }}>
            <button className="back" onClick={() => setScreen("support")}>← Support</button>
            <div className="page-title">
              <span className="eyebrow">YOUR SUPPORTER JOURNEY</span>
              <h1>{teamName}</h1>
            </div>
            <div className="journey-empty-state" style={{ margin: "20px", textAlign: "center", padding: "40px 20px", background: "#fff", borderRadius: "16px", border: "2px dashed rgba(0,0,0,0.08)" }}>
              <h3>Failed to load details</h3>
              <p style={{ color: "var(--muted)", fontSize: "12px", marginTop: "8px", marginBottom: "20px" }}>
                {teamJourneyError || "No supporter data available for this team."}
              </p>
            </div>
          </div>;
        }

        const { journey, timeline, trustedPlayers, leaderboard, rankHistory } = teamJourneyData;

        const rank = journey.currentTeamRank;
        const score = journey.totalJourneyScore;
        const matchesFollowed = journey.matchesFollowed;
        const eligible = journey.eligibleMatches;
        const percentile = journey.percentile;
        const topFanEligible = journey.topFanEligible;

        const top1Cutoff = leaderboard.top1PercentCutoff ?? 0.0;
        const distanceToCutoff = Math.max(0, top1Cutoff - score);

        // Get display leaderboard rows (top 3 + user if not in top 3)
        const displayLeaderboard = [...leaderboard.top];
        if (leaderboard.user && !leaderboard.top.some((e: any) => e.wallet === leaderboard.user.wallet)) {
          displayLeaderboard.push(leaderboard.user);
        }

        return <div className="screen enter" style={{ paddingBottom: "100px" }}>
          {/* Back button */}
          <button className="back" onClick={() => setScreen("support")}>← Support</button>

          {/* ── A. Hero ─────────────────────────────────────────── */}
          <div style={{ padding: "0 20px 20px", borderBottom: "1px solid var(--line)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "16px" }}>
              <div style={{ width: "52px", height: "52px", borderRadius: "26px", background: "rgba(0,0,0,0.06)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <TeamFlag name={teamName} className="real-team-badge large" />
              </div>
              <div>
                <div style={{ fontSize: "8px", fontWeight: "900", color: "var(--muted)", letterSpacing: "0.8px" }}>YOUR SUPPORTER JOURNEY</div>
                <div style={{ fontSize: "24px", fontWeight: "800", color: "var(--foreground)" }}>{teamName}</div>
              </div>
            </div>

            <div style={{ display: "flex", gap: "16px", marginBottom: "12px" }}>
              <div style={{ flex: 1, background: "rgba(0,0,0,0.04)", borderRadius: "14px", padding: "14px", textAlign: "center" }}>
                <div style={{ fontSize: "28px", fontWeight: "900", color: "var(--green)" }}>{rank ? `#${rank.toLocaleString()}` : "—"}</div>
                <div style={{ fontSize: "9px", fontWeight: "800", color: "var(--muted)", textTransform: "uppercase", marginTop: "4px" }}>{teamName} supporter rank</div>
              </div>
            </div>

            <div style={{ display: "flex", gap: "8px" }}>
              <div style={{ flex: 1, background: "rgba(0,0,0,0.03)", borderRadius: "10px", padding: "10px" }}>
                <div style={{ fontSize: "16px", fontWeight: "800", color: "var(--foreground)" }}>{score.toFixed(1)}</div>
                <div style={{ fontSize: "8px", color: "var(--muted)", textTransform: "uppercase" }}>Journey score</div>
              </div>
              <div style={{ flex: 1, background: "rgba(0,0,0,0.03)", borderRadius: "10px", padding: "10px" }}>
                <div style={{ fontSize: "16px", fontWeight: "800", color: "var(--foreground)" }}>{matchesFollowed} of {eligible}</div>
                <div style={{ fontSize: "8px", color: "var(--muted)", textTransform: "uppercase" }}>Matches followed</div>
              </div>
              <div style={{ flex: 1, background: "rgba(0,0,0,0.03)", borderRadius: "10px", padding: "10px" }}>
                <div style={{ fontSize: "16px", fontWeight: "800", color: "var(--foreground)" }}>{percentile !== null ? `Top ${percentile.toFixed(1)}%` : "—"}</div>
                <div style={{ fontSize: "8px", color: "var(--muted)", textTransform: "uppercase" }}>Percentile</div>
              </div>
            </div>
          </div>

          {/* ── B. Next Chapter ──────────────────────────────────── */}
          {(() => {
            const nextFix = fixtures.find(f => {
              const t = new Date(f.startsAt).getTime();
              return t > Date.now() && (f.homeTeamId === activeTeamPage.id || f.awayTeamId === activeTeamPage.id);
            });
            if (!nextFix) return null;
            const opp = nextFix.homeTeamId === activeTeamPage.id ? nextFix.awayTeam : nextFix.homeTeam;
            const isLive = nextFix.phase && ["live", "first_half", "second_half", "halftime"].includes(nextFix.phase.toLowerCase());

            return <div className="journey-update-card" style={{ margin: "16px 20px", border: isLive ? "2px solid var(--red)" : "2px solid var(--green)", cursor: "pointer" }} onClick={() => openFixture(nextFix)}>
              <div style={{ fontSize: "8px", fontWeight: "900", color: isLive ? "var(--red)" : "var(--green)", letterSpacing: "0.8px", textTransform: "uppercase", marginBottom: "6px" }}>
                {isLive ? "LIVE NOW" : "NEXT CHAPTER"}
              </div>
              <div style={{ fontSize: "16px", fontWeight: "800", marginBottom: "4px" }}>{teamName} vs {opp}</div>
              <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "10px" }}>{getCurrentStage(nextFix.phase)}</div>
              <div style={{ fontSize: "13px", fontWeight: "800", color: isLive ? "var(--red)" : "var(--green)" }}>
                {isLive ? "Enter live match map →" : "Open match page →"}
              </div>
            </div>;
          })()}

          {/* ── C. Journey Timeline ──────────────────────────────── */}
          <div className="section-heading" style={{ marginTop: "8px" }}>
            <h2>{teamName}'s Journey</h2>
          </div>
          <div style={{ padding: "0 20px" }}>
            {timeline.length > 0 ? (
              timeline.map((ch: any, i: number) => (
                <div key={ch.fixtureId || i} style={{ display: "flex", gap: "12px", marginBottom: "0" }}>
                  {/* Timeline spine */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "24px", flexShrink: 0 }}>
                    <div style={{ width: "12px", height: "12px", borderRadius: "6px", background: ch.status === "completed" ? "var(--green)" : ch.status === "live" ? "var(--red)" : "var(--muted)", border: "2px solid #fff", boxShadow: "0 0 0 2px " + (ch.status === "completed" ? "var(--green)" : ch.status === "live" ? "var(--red)" : "var(--muted)"), flexShrink: 0 }} />
                    {i < timeline.length - 1 && <div style={{ width: "2px", flex: 1, background: "var(--line)", marginTop: "4px" }} />}
                  </div>

                  {/* Chapter card */}
                  <div
                    style={{ flex: 1, background: "#fff", border: "2px solid rgba(0,0,0,0.06)", borderRadius: "16px", padding: "14px", marginBottom: "12px", cursor: "pointer" }}
                    onClick={() => {
                      const f = fixtures.find(item => item.id === ch.fixtureId);
                      if (f) openFixture(f);
                    }}
                  >
                    <div style={{ fontSize: "8px", fontWeight: "900", color: ch.status === "live" ? "var(--red)" : "var(--green)", letterSpacing: "0.8px", marginBottom: "4px" }}>
                      {ch.status === "completed" ? `✓ ${ch.stage}` : ch.status === "live" ? `● LIVE · ${ch.stage}` : ch.stage}
                    </div>
                    <div style={{ fontSize: "14px", fontWeight: "800", color: "var(--foreground)", marginBottom: "2px" }}>
                      {ch.matchResult || `${teamName} vs ${ch.opponent}`}
                    </div>
                    <div style={{ fontSize: "10px", color: "var(--muted)", marginBottom: "10px" }}>
                      {new Date(ch.startsAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </div>

                    {ch.trioNames ? (
                      <div style={{ fontSize: "10px", color: "var(--muted)", marginBottom: "8px" }}>
                        Your three: <b style={{ color: "var(--foreground)" }}>{ch.trioNames.join(" · ")}</b>
                      </div>
                    ) : (
                      <div style={{ fontSize: "10px", color: "var(--muted)", marginBottom: "8px", fontStyle: "italic" }}>
                        Selection missed / Trio not locked
                      </div>
                    )}

                    {ch.trioNames && ch.finalMatchIndex !== null && (
                      <div style={{ display: "flex", gap: "8px", borderTop: "1px solid var(--line)", paddingTop: "10px" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: "14px", fontWeight: "800", color: "var(--foreground)" }}>{ch.finalMatchIndex.toFixed(1)}</div>
                          <div style={{ fontSize: "8px", color: "var(--muted)", textTransform: "uppercase" }}>Match Index</div>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: "14px", fontWeight: "800", color: "var(--foreground)" }}>
                            {ch.rankBefore ? `#${ch.rankBefore.toLocaleString()} → ` : ""}#{ch.rankAfter?.toLocaleString()}
                          </div>
                          <div style={{ fontSize: "8px", color: "var(--muted)", textTransform: "uppercase" }}>Rank</div>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: "14px", fontWeight: "800", color: "#2d653d" }}>+{ch.finalMatchIndex.toFixed(1)}</div>
                          <div style={{ fontSize: "8px", color: "var(--muted)", textTransform: "uppercase" }}>Contribution</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="real-empty" style={{ margin: "20px 0" }}>No fixtures matches found.</div>
            )}
          </div>

          {/* ── D. Trusted Players ───────────────────────────────── */}
          <div className="section-heading" style={{ marginTop: "16px" }}>
            <h2>Your Trusted Players</h2>
          </div>
          <div style={{ padding: "0 20px" }}>
            {trustedPlayers.length > 0 ? (
              trustedPlayers.map((tp: any, i: number) => (
                <div key={tp.playerId || i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px", background: "#fff", border: "2px solid rgba(0,0,0,0.06)", borderRadius: "16px", marginBottom: "8px" }}>
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: "800", color: "var(--foreground)" }}>{tp.playerName}</div>
                    <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>
                      Selected {tp.timesSelected} times · Avg rating <b>{(tp.averageRatingWhenSelected || 6.0).toFixed(2)}</b>
                    </div>
                    {tp.bestFixtureOpponent && (
                      <div style={{ fontSize: "10px", color: "var(--muted)", marginTop: "2px" }}>Best match: vs {tp.bestFixtureOpponent}</div>
                    )}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "16px", fontWeight: "800", color: "#2d653d" }}>{(tp.supporterPointsGenerated || 0).toFixed(1)}</div>
                    <div style={{ fontSize: "8px", color: "var(--muted)", textTransform: "uppercase" }}>Points generated</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="real-empty" style={{ margin: "10px 0" }}>No players selected yet.</div>
            )}
            <button
              style={{ width: "100%", padding: "12px", border: "2px solid rgba(0,0,0,0.08)", borderRadius: "14px", background: "transparent", fontSize: "13px", fontWeight: "700", color: "var(--green)", cursor: "pointer", fontFamily: "inherit", marginTop: "4px" }}
              onClick={() => {
                setActiveTeamId(activeTeamPage.id);
                setScreen("players");
              }}
            >
              View {teamName}'s full squad →
            </button>
          </div>

          {/* ── E. Leaderboard Preview ──────────────────────────── */}
          <div className="section-heading" style={{ marginTop: "20px" }}>
            <h2>{teamName} Top Supporters</h2>
          </div>
          <div style={{ padding: "0 20px" }}>
            <div style={{ background: "#fff", border: "2px solid rgba(0,0,0,0.06)", borderRadius: "16px", overflow: "hidden" }}>
              {displayLeaderboard.length > 0 ? (
                displayLeaderboard.map((row: any, i: number) => (
                  <div key={row.wallet || i} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "12px 14px",
                    borderBottom: i < displayLeaderboard.length - 1 ? "1px solid var(--line)" : "none",
                    background: row.isCurrentUser ? "rgba(45,101,61,0.06)" : "transparent"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div style={{ width: "24px", fontSize: "13px", fontWeight: "900", color: row.isCurrentUser ? "var(--green)" : "var(--muted)", textAlign: "center" }}>{row.rank}</div>
                      <span style={{ fontSize: "13px", fontWeight: row.isCurrentUser ? "800" : "600", color: "var(--foreground)" }}>{row.displayName}</span>
                      {row.isCurrentUser && <span style={{ fontSize: "10px", color: "#2d653d", fontWeight: "800" }}>You</span>}
                    </div>
                    <span style={{ fontSize: "13px", fontWeight: "800", color: row.isCurrentUser ? "var(--green)" : "var(--foreground)" }}>{row.totalScore.toFixed(1)}</span>
                  </div>
                ))
              ) : (
                <div style={{ padding: "14px", textAlign: "center", color: "var(--muted)" }}>No leaderboard entries found.</div>
              )}
            </div>
            {top1Cutoff > 0 && (
              <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "10px", padding: "0 4px" }}>
                Top 1% cutoff: <b style={{ color: "var(--foreground)" }}>{top1Cutoff.toFixed(1)}</b> · {distanceToCutoff > 0 ? <>You are <b style={{ color: "var(--foreground)" }}>{distanceToCutoff.toFixed(1)} points</b> away</> : <b style={{ color: "#2d653d" }}>You are in the top 1%!</b>}
              </div>
            )}
          </div>

          {/* ── F. Top-Fan Eligibility ──────────────────────────── */}
          <div className="section-heading" style={{ marginTop: "20px" }}>
            <h2>Top-Fan Eligibility</h2>
          </div>
          <div style={{ padding: "0 20px", marginBottom: "20px" }}>
            <div style={{ background: "#fff", border: "2px solid rgba(0,0,0,0.06)", borderRadius: "16px", padding: "16px" }}>
              <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "10px" }}>
                Follow at least <b style={{ color: "var(--foreground)" }}>75%</b> of {teamName}'s matches
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px" }}>
                <div style={{ flex: 1, height: "8px", background: "rgba(0,0,0,0.06)", borderRadius: "4px", overflow: "hidden" }}>
                  <div style={{ width: `${eligible > 0 ? (matchesFollowed / eligible) * 100 : 0}%`, height: "100%", background: topFanEligible ? "var(--green)" : "#e8a92e", borderRadius: "4px", transition: "width 0.3s ease" }} />
                </div>
                <span style={{ fontSize: "13px", fontWeight: "800", color: "var(--foreground)" }}>{matchesFollowed} of {eligible}</span>
              </div>
              <div style={{ fontSize: "13px", fontWeight: "800", color: topFanEligible ? "#2d653d" : "#e8a92e" }}>
                {topFanEligible ? "✓ Eligible" : "Not yet eligible"}
              </div>
              {topFanEligible && <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "6px" }}>
                Maintain eligibility by participating in the upcoming matches.
              </div>}
            </div>
          </div>
        </div>;
      })()}



      {screen === "players" && (
        <PlayersScreen
          teams={teams}
          fixtures={fixtures}
          wallet={wallet}
          getPlayerImageSrc={getPlayerImageSrc}
          handlePlayerImageError={handlePlayerImageError}
          onOpenPassport={(playerId) => setPreviewPlayerId(playerId)}
        />
      )}


    </div>

    {/* Web Player Passport Modal overlay */}
    {previewPlayerId && (
      <WebPlayerPassport
        playerId={previewPlayerId}
        wallet={wallet}
        onClose={() => setPreviewPlayerId(null)}
      />
    )}

    {screen !== "select" && <nav className="bottom-nav">
      <button className={screen === "home" || screen === "fixtures" || screen === "match" ? "active" : ""} onClick={() => setScreen("home")}><span>▣</span>Matches</button>
      <button className={screen === "support" || screen === "team_journey" ? "active" : ""} onClick={() => setScreen("support")}><span>♥</span>Support</button>
      <button className={screen === "players" ? "active" : ""} onClick={() => setScreen("players")}><span>≡</span>Players</button>
    </nav>}
  </section></main>;
}
