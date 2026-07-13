"use client";

import { useMemo, useState } from "react";
import { Transaction } from "@solana/web3.js";

type Position = "ATT" | "MID" | "DEF";
type Screen = "home" | "select" | "live" | "team" | "profile";
type Player = {
  id: string;
  name: string;
  number: number;
  position: Position;
  status: "Starting" | "Substitute";
  rating: number;
  goals: number;
  shots: number;
  cards: number;
  minutes: number;
};
type TeamCareer = {
  id: string;
  name: string;
  code: string;
  flag: string;
  matches: number;
  score: number;
  rank: number;
  percentile: number;
  primary?: boolean;
};

declare global {
  interface Window {
    solana?: {
      isPhantom?: boolean;
      connect: () => Promise<{ publicKey: { toString: () => string } }>;
      signAndSendTransaction: (transaction: Transaction) => Promise<{ signature: string }>;
      signMessage: (message: Uint8Array, encoding?: string) => Promise<{ signature: Uint8Array }>;
    };
  }
}

const positions: Position[] = ["ATT", "MID", "DEF"];
const positionNames: Record<Position, string> = { ATT: "Attacker", MID: "Midfielder", DEF: "Defender" };
const players: Player[] = [
  { id: "arg-9", name: "Julian Alvarez", number: 9, position: "ATT", status: "Starting", rating: 7.8, goals: 3, shots: 11, cards: 0, minutes: 389 },
  { id: "arg-10", name: "Lionel Messi", number: 10, position: "ATT", status: "Starting", rating: 8.1, goals: 4, shots: 18, cards: 1, minutes: 421 },
  { id: "arg-22", name: "Lautaro Martinez", number: 22, position: "ATT", status: "Substitute", rating: 6.4, goals: 2, shots: 7, cards: 0, minutes: 176 },
  { id: "arg-20", name: "Alexis Mac Allister", number: 20, position: "MID", status: "Starting", rating: 7.5, goals: 1, shots: 6, cards: 1, minutes: 402 },
  { id: "arg-8", name: "Enzo Fernandez", number: 8, position: "MID", status: "Starting", rating: 7.1, goals: 0, shots: 5, cards: 1, minutes: 411 },
  { id: "arg-11", name: "Giovani Lo Celso", number: 11, position: "MID", status: "Substitute", rating: 6.2, goals: 0, shots: 2, cards: 0, minutes: 138 },
  { id: "arg-13", name: "Cristian Romero", number: 13, position: "DEF", status: "Starting", rating: 8.0, goals: 1, shots: 2, cards: 2, minutes: 430 },
  { id: "arg-6", name: "Lisandro Martinez", number: 6, position: "DEF", status: "Starting", rating: 7.4, goals: 0, shots: 1, cards: 1, minutes: 356 },
  { id: "arg-26", name: "Nahuel Molina", number: 26, position: "DEF", status: "Substitute", rating: 6.5, goals: 0, shots: 3, cards: 0, minutes: 244 },
];

const careers: TeamCareer[] = [
  { id: "arg", name: "Argentina", code: "ARG", flag: "🇦🇷", matches: 5, score: 522.4, rank: 18, percentile: 98, primary: true },
  { id: "jpn", name: "Japan", code: "JPN", flag: "🇯🇵", matches: 3, score: 309.8, rank: 142, percentile: 88 },
  { id: "mar", name: "Morocco", code: "MAR", flag: "🇲🇦", matches: 2, score: 214.1, rank: 74, percentile: 93 },
  { id: "esp", name: "Spain", code: "ESP", flag: "🇪🇸", matches: 1, score: 104.6, rank: 690, percentile: 61 },
];

const matchHistory = [
  { opponent: "France", flag: "🇫🇷", result: "2–1", contribution: 112.6, base: 99.1, bonus: 13.5, place: "Top 10%" },
  { opponent: "Denmark", flag: "🇩🇰", result: "1–0", contribution: 108.4, base: 94.2, bonus: 14.2, place: "Top 5%" },
  { opponent: "Japan", flag: "🇯🇵", result: "2–0", contribution: 101.8, base: 92.8, bonus: 9.0, place: "Top 40%" },
  { opponent: "Morocco", flag: "🇲🇦", result: "1–1", contribution: 99.7, base: 88.4, bonus: 11.3, place: "Top 25%" },
  { opponent: "Spain", flag: "🇪🇸", result: "0–0", contribution: 99.9, base: 85.2, bonus: 14.7, place: "Top 2%" },
];

const opposition: Record<Position, { name: string; rating: number }> = {
  ATT: { name: "Kylian Mbappe", rating: 8.3 },
  MID: { name: "Aurelien Tchouameni", rating: 7.3 },
  DEF: { name: "William Saliba", rating: 7.7 },
};

function shortWallet(value: string) {
  return `${value.slice(0, 4)}…${value.slice(-3)}`;
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("home");
  const [selected, setSelected] = useState<Partial<Record<Position, Player>>>({});
  const [activePosition, setActivePosition] = useState<Position>("ATT");
  const [activeTeam, setActiveTeam] = useState<TeamCareer>(careers[0]);
  const [viewPlayer, setViewPlayer] = useState<Player | null>(null);
  const [wallet, setWallet] = useState("");
  const [connectionState, setConnectionState] = useState<"idle" | "connecting" | "active" | "error">("idle");
  const [connectionMessage, setConnectionMessage] = useState("Connect a devnet wallet to load live TxLINE data.");

  const selectedCount = Object.keys(selected).length;
  const yourTotal = useMemo(() => positions.reduce((sum, pos) => sum + (selected[pos]?.rating ?? 0), 0), [selected]);
  const oppositionTotal = Object.values(opposition).reduce((sum, player) => sum + player.rating, 0);

  const choosePlayer = (player: Player) => {
    setSelected((current) => ({ ...current, [player.position]: player }));
    const next = positions.find((position) => position !== player.position && !selected[position]);
    if (next) setActivePosition(next);
  };

  const connectTxline = async () => {
    if (!window.solana) {
      setConnectionState("error");
      setConnectionMessage("Install Phantom or another injected Solana wallet, then try again.");
      return;
    }
    try {
      setConnectionState("connecting");
      setConnectionMessage("Preparing your free TxLINE devnet subscription…");
      const walletConnection = await window.solana.connect();
      const publicKey = walletConnection.publicKey.toString();
      setWallet(publicKey);
      const session = await fetch("/api/txline/session", { method: "POST" }).then((response) => response.json()) as { jwt?: string; error?: string };
      if (!session.jwt) throw new Error(session.error ?? "Could not start TxLINE session");
      const prepared = await fetch("/api/txline/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicKey }),
      }).then((response) => response.json()) as { transaction?: string; error?: string };
      if (!prepared.transaction) throw new Error(prepared.error ?? "Could not prepare subscription");
      const transaction = Transaction.from(Uint8Array.from(atob(prepared.transaction), (character) => character.charCodeAt(0)));
      const sent = await window.solana.signAndSendTransaction(transaction);
      const message = new TextEncoder().encode(`${sent.signature}::${session.jwt}`);
      const signed = await window.solana.signMessage(message, "utf8");
      const walletSignature = btoa(String.fromCharCode(...signed.signature));
      const activation = await fetch("/api/txline/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ txSig: sent.signature, walletSignature }),
      });
      if (!activation.ok) throw new Error((await activation.json()).error ?? "TxLINE activation failed");
      setConnectionState("active");
      setConnectionMessage("TxLINE devnet is active. Live fixtures, scores, lineups and odds are available.");
    } catch (error) {
      setConnectionState("error");
      setConnectionMessage(error instanceof Error ? error.message : "Could not connect TxLINE devnet.");
    }
  };

  const openTeam = (team: TeamCareer) => { setActiveTeam(team); setScreen("team"); };

  return (
    <main className="stage">
      <section className="phone-shell" aria-label="One Nation supporter app">
        <header className="topbar">
          <button className="brand" onClick={() => setScreen("home")}><span className="brand-mark">1N</span><span>ONE NATION</span></button>
          <span className="network-badge">DEVNET</span>
          <button className={`wallet ${connectionState}`} onClick={connectTxline} disabled={connectionState === "connecting"}>
            <span className="wallet-dot" />{wallet ? shortWallet(wallet) : connectionState === "connecting" ? "Connecting" : "Connect"}
          </button>
        </header>

        <div className="content">
          {screen === "home" && (
            <div className="screen enter home-screen">
              <div className="home-intro"><span className="eyebrow">YOUR WORLD CUP</span><h1>Follow your teams.</h1><p>Choose three when official squads drop. Build a separate supporter career for every team.</p></div>

              <div className="rail-heading"><div><h2>Matches</h2><span>Lineups, live and recent</span></div><button>See all</button></div>
              <div className="horizontal-rail match-rail">
                <button className="match-card open-card" onClick={() => setScreen("select")}>
                  <div><span className="pill open">LINEUPS IN</span><time>Locks in 08:42</time></div>
                  <section><span>🇦🇷<b>ARG</b></span><i>VS</i><span>🇫🇷<b>FRA</b></span></section>
                  <footer><span>Semi-final · Tonight</span><b>Choose three →</b></footer>
                </button>
                <button className="match-card live-card" onClick={() => setScreen("live")}>
                  <div><span className="pill live-pill">LIVE 67′</span><time>Semi-final</time></div>
                  <section><span>🏴<b>ENG</b></span><i>1–1</i><span>🇪🇸<b>ESP</b></span></section>
                  <footer><span>Your Spain trio</span><b>101.4 →</b></footer>
                </button>
                <button className="match-card final-card">
                  <div><span className="pill final-pill">FINAL</span><time>Yesterday</time></div>
                  <section><span>🇯🇵<b>JPN</b></span><i>2–0</i><span>🇲🇦<b>MAR</b></span></section>
                  <footer><span>Match contribution</span><b>104.8</b></footer>
                </button>
              </div>

              <div className="rail-heading team-heading"><div><h2>Your teams</h2><span>Sorted by matches supported</span></div><button onClick={() => openTeam(careers[0])}>View history</button></div>
              <div className="horizontal-rail team-rail">
                {careers.map((team) => (
                  <button key={team.id} className={`team-career-card ${team.primary ? "primary" : ""}`} onClick={() => openTeam(team)}>
                    {team.primary && <span className="primary-label">◆ PRIMARY FAN · LOCKED</span>}
                    <div className="team-card-title"><span>{team.flag}</span><div><b>{team.name}</b><small>{team.matches} matches supported</small></div></div>
                    <div className="team-card-score"><strong>{team.score.toFixed(1)}</strong><span>career score</span></div>
                    <div className="team-card-rank"><span>#{team.rank}</span><b>Top {Math.max(1, 100 - team.percentile)}%</b></div>
                  </button>
                ))}
              </div>

              <div className={`devnet-status ${connectionState}`}><span>●</span><div><b>TxLINE · Solana devnet</b><small>{connectionMessage}</small></div></div>
            </div>
          )}

          {screen === "select" && (
            <div className="screen enter">
              <button className="back" onClick={() => setScreen("home")}>← Matches</button>
              <div className="select-header"><div><span className="pill open">OFFICIAL MATCHDAY SQUAD</span><h1>Choose Argentina&apos;s three</h1></div><span className="flag large">🇦🇷</span></div>
              <p className="lead compact">Pick one attacker, midfielder and defender. Starters and official substitutes are eligible.</p>
              <div className="position-tabs">
                {positions.map((position) => <button key={position} className={activePosition === position ? "active" : ""} onClick={() => setActivePosition(position)}><span>{selected[position] ? "✓" : position}</span>{positionNames[position]}</button>)}
              </div>
              <div className="player-list">
                {(["Starting", "Substitute"] as const).map((status) => <div key={status}>
                  <div className="list-label">{status === "Starting" ? "STARTING XI" : "OFFICIAL SUBSTITUTES"}<span>{status === "Substitute" ? "Must enter to earn a rating" : ""}</span></div>
                  {players.filter((player) => player.position === activePosition && player.status === status).map((player) => {
                    const picked = selected[activePosition]?.id === player.id;
                    return <button key={player.id} className={`player-row ${picked ? "picked" : ""}`} onClick={() => choosePlayer(player)}><span className="shirt-number">{player.number}</span><span className="player-name"><b>{player.name}</b><small>{player.status} · Tournament {player.rating.toFixed(1)}</small></span><span className="select-circle">{picked ? "✓" : "+"}</span></button>;
                  })}
                </div>)}
              </div>
              <div className="selection-dock"><div className="mini-picks">{positions.map((position) => <span key={position} className={selected[position] ? "filled" : ""}>{selected[position]?.number ?? position}</span>)}<div><b>{selectedCount}/3 selected</b><small>Locks at kickoff</small></div></div><button disabled={selectedCount !== 3} onClick={() => setScreen("live")}>Lock my three</button></div>
            </div>
          )}

          {screen === "live" && (
            <div className="screen enter">
              <button className="back" onClick={() => setScreen("home")}>← Matches</button>
              <div className="scoreboard"><span className="flag">🇦🇷</span><div><small>LIVE · 67′</small><b>1 <i>—</i> 0</b><span>ARGENTINA · FRANCE</span></div><span className="flag">🇫🇷</span></div>
              <div className="live-summary"><div><span>YOUR THREE</span><b>{yourTotal ? yourTotal.toFixed(1) : "23.2"}</b></div><div className="index-ring"><b>{yourTotal ? ((yourTotal / oppositionTotal) * 100).toFixed(1) : "100.9"}</b><small>MATCH INDEX</small></div><div><span>BEST OF FRA</span><b>{oppositionTotal.toFixed(1)}</b></div></div>
              <p className="status-line">Ratings use only confirmed TxLINE-supported player events.</p>
              <div className="compare-label"><span>YOUR ARGENTINA THREE</span><span>LIVE RATING</span></div>
              <div className="rating-stack">{(selectedCount ? positions.map((position) => selected[position]!) : [players[0], players[3], players[6]]).map((player) => <button key={player.id} className="rating-row" onClick={() => setViewPlayer(player)}><span className={`position-tag ${player.position.toLowerCase()}`}>{player.position}</span><span><b>{player.name}</b><small>{player.goals} goals · {player.shots} shots · {player.minutes} min</small></span><strong>{player.rating.toFixed(1)}</strong><i>›</i></button>)}</div>
              <div className="compare-label opposition-label"><span>BEST OF THE OPPOSITION</span><span>AUTO-UPDATES</span></div>
              <div className="opposition-row">{positions.map((position) => <div key={position}><span>{position}</span><b>{opposition[position].name.split(" ").at(-1)}</b><strong>{opposition[position].rating.toFixed(1)}</strong></div>)}</div>
            </div>
          )}

          {screen === "team" && (
            <div className="screen enter team-history-screen">
              <button className="back" onClick={() => setScreen("home")}>← Your teams</button>
              <div className="team-history-title"><span className="flag large">{activeTeam.flag}</span><div>{activeTeam.primary && <span className="primary-label dark">◆ PRIMARY FAN · LOCKED</span>}<h1>{activeTeam.name}</h1><p>Your supporter career and the team&apos;s World Cup journey.</p></div></div>
              <div className="rank-hero"><div><small>TEAM RANK</small><b>#{activeTeam.rank}</b><span>Top {Math.max(1, 100 - activeTeam.percentile)}% of supporters</span></div><strong>{activeTeam.score.toFixed(1)}<small>CUMULATIVE</small></strong></div>
              <div className="score-explainer"><b>How top fan is decided</b><p>Every match adds your normalized trio score plus up to 15 placement points. This rewards excellent picks even when the match itself produces few rating events.</p><code>career = Σ (75% accuracy + 25% matchup + placement bonus)</code></div>
              <div className="section-heading"><h2>World Cup history</h2><span className="muted">User + team</span></div>
              <div className="team-match-history">{matchHistory.slice(0, activeTeam.matches).map((match) => <button key={match.opponent}><span className="history-opponent">{match.flag}<i><b>vs {match.opponent}</b><small>{activeTeam.code} {match.result} · {match.place}</small></i></span><span className="history-score"><b>+{match.contribution.toFixed(1)}</b><small>{match.base.toFixed(1)} + {match.bonus.toFixed(1)} bonus</small></span></button>)}</div>
              <div className="section-heading"><h2>Players followed</h2><span className="muted">Tap for history</span></div>
              <div className="squad-grid">{players.slice(0, 6).map((player) => <button key={player.id} onClick={() => setViewPlayer(player)}><span className="shirt-number">{player.number}</span><b>{player.name.split(" ").at(-1)}</b><small>{positionNames[player.position]}</small><strong>{player.rating.toFixed(1)}</strong></button>)}</div>
            </div>
          )}

          {screen === "profile" && <div className="screen enter profile-screen"><div className="avatar">NS</div><span className="eyebrow">SUPPORTER PROFILE</span><h1>Nitin</h1><p>Four team careers. Eleven matches supported.</p><div className="profile-list">{careers.map((team) => <button key={team.id} onClick={() => openTeam(team)}><span>{team.flag} {team.name}{team.primary ? " · Primary" : ""}</span><b>#{team.rank} ›</b></button>)}</div></div>}
        </div>

        {screen !== "select" && <nav className="bottom-nav"><button className={screen === "home" || screen === "live" ? "active" : ""} onClick={() => setScreen("home")}><span>▣</span>Home</button><button className={screen === "team" ? "active" : ""} onClick={() => openTeam(careers[0])}><span>◉</span>Teams</button><button className={screen === "profile" ? "active" : ""} onClick={() => setScreen("profile")}><span>●</span>Profile</button></nav>}

        {viewPlayer && <div className="modal-backdrop" onClick={() => setViewPlayer(null)}><article className="player-sheet" onClick={(event) => event.stopPropagation()}><button className="sheet-close" onClick={() => setViewPlayer(null)}>×</button><div className="player-hero"><span className="shirt-number big">{viewPlayer.number}</span><div><span className="eyebrow">ARGENTINA · {positionNames[viewPlayer.position].toUpperCase()}</span><h2>{viewPlayer.name}</h2></div><strong>{viewPlayer.rating.toFixed(1)}</strong></div><div className="player-stat-grid"><div><b>{viewPlayer.minutes}</b><span>Minutes</span></div><div><b>{viewPlayer.goals}</b><span>Goals</span></div><div><b>{viewPlayer.shots}</b><span>Shots</span></div><div><b>{viewPlayer.cards}</b><span>Cards</span></div></div><div className="section-heading"><h2>Match history</h2><span className="muted">TxLINE impact</span></div><div className="history"><div><span>🇫🇷 <b>vs France</b></span><small>{viewPlayer.goals} goal · 90 min</small><strong>8.1</strong></div><div><span>🇩🇰 <b>vs Denmark</b></span><small>84 min · 2 shots</small><strong>7.6</strong></div><div><span>🇯🇵 <b>vs Japan</b></span><small>76 min · no cards</small><strong>7.4</strong></div></div><p className="data-note"><i /> Goals, shots, cards, penalties, substitutions and minutes are supported. TxLINE does not document assists, tackles, passing, chances or saves.</p></article></div>}
      </section>
    </main>
  );
}

