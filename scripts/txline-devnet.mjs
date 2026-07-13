import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import nacl from "tweetnacl";

const RPC = "https://api.devnet.solana.com";
const API_ORIGIN = "https://txline-dev.txodds.com";
const PROGRAM_ID = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
const TOKEN_MINT = new PublicKey("4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG");
const SERVICE_LEVEL_ID = 1;
const DURATION_WEEKS = 4;
const LEAGUES = [];
const FIXTURE_WINDOWS = [20615, 20645];
const KEYPAIR_PATH = resolve(process.env.TXLINE_KEYPAIR_PATH || "work/txline-devnet-keypair.json");
const SESSION_PATH = resolve(process.env.TXLINE_SESSION_PATH || "work/txline-devnet-session.json");
const INGEST_SECRET_PATH = resolve(process.env.TXLINE_INGEST_SECRET_PATH || "work/txline-ingest-secret.txt");
const EXPECTED_WALLET = process.env.TXLINE_EXPECTED_WALLET || "";
const connection = new Connection(RPC, "confirmed");

function fail(message) {
  throw new Error(message);
}

async function privateWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600 });
}

async function loadOrCreateKeypair() {
  let keypair;
  if (existsSync(KEYPAIR_PATH)) {
    const bytes = JSON.parse(await readFile(KEYPAIR_PATH, "utf8"));
    keypair = Keypair.fromSecretKey(Uint8Array.from(bytes));
  } else {
    keypair = Keypair.generate();
    await privateWrite(KEYPAIR_PATH, [...keypair.secretKey]);
    console.log(`Created local devnet service wallet: ${keypair.publicKey.toBase58()}`);
  }
  const address = keypair.publicKey.toBase58();
  if (EXPECTED_WALLET && EXPECTED_WALLET !== address) {
    fail(`Keypair mismatch: expected ${EXPECTED_WALLET}, found ${address}.`);
  }
  return keypair;
}

async function readSession() {
  if (!existsSync(SESSION_PATH)) return {};
  return JSON.parse(await readFile(SESSION_PATH, "utf8"));
}

async function ingestSecret() {
  if (process.env.TXLINE_INGEST_SECRET) return process.env.TXLINE_INGEST_SECRET;
  if (existsSync(INGEST_SECRET_PATH)) return (await readFile(INGEST_SECRET_PATH, "utf8")).trim();
  const secret = randomBytes(32).toString("hex");
  await mkdir(dirname(INGEST_SECRET_PATH), { recursive: true });
  await writeFile(INGEST_SECRET_PATH, secret, { mode: 0o600 });
  console.log(`Created private ingestion secret at ${INGEST_SECRET_PATH}`);
  return secret;
}

async function ensureBalance(keypair) {
  let balance = await connection.getBalance(keypair.publicKey, "confirmed");
  if (balance >= 0.02 * LAMPORTS_PER_SOL) return balance;
  console.log("Requesting devnet SOL from the faucet…");
  try {
    const signature = await connection.requestAirdrop(keypair.publicKey, 0.1 * LAMPORTS_PER_SOL);
    const latest = await connection.getLatestBlockhash("confirmed");
    await connection.confirmTransaction({ signature, ...latest }, "confirmed");
    balance = await connection.getBalance(keypair.publicKey, "confirmed");
  } catch (error) {
    fail(`Devnet faucet failed. Send at least 0.02 devnet SOL to ${keypair.publicKey.toBase58()}, then run this command again. ${error instanceof Error ? error.message : ""}`);
  }
  return balance;
}

async function subscribe(keypair) {
  const user = keypair.publicKey;
  const userTokenAccount = getAssociatedTokenAddressSync(TOKEN_MINT, user, false, TOKEN_2022_PROGRAM_ID);
  const [pricingMatrix] = PublicKey.findProgramAddressSync([Buffer.from("pricing_matrix")], PROGRAM_ID);
  const [treasuryPda] = PublicKey.findProgramAddressSync([Buffer.from("token_treasury_v2")], PROGRAM_ID);
  const treasuryVault = getAssociatedTokenAddressSync(TOKEN_MINT, treasuryPda, true, TOKEN_2022_PROGRAM_ID);
  const transaction = new Transaction();

  if (!(await connection.getAccountInfo(userTokenAccount, "confirmed"))) {
    transaction.add(createAssociatedTokenAccountInstruction(
      user,
      userTokenAccount,
      user,
      TOKEN_MINT,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ));
  }

  transaction.add(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: pricingMatrix, isSigner: false, isWritable: false },
      { pubkey: TOKEN_MINT, isSigner: false, isWritable: false },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: treasuryVault, isSigner: false, isWritable: true },
      { pubkey: treasuryPda, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([254, 28, 191, 138, 156, 179, 183, 53, 1, 0, DURATION_WEEKS]),
  }));

  return sendAndConfirmTransaction(connection, transaction, [keypair], {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
}

async function responseText(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  const body = await response.text();
  if (!response.ok) fail(`${url} returned ${response.status}: ${body.slice(0, 500)}`);
  return body;
}

async function activate(keypair, txSig) {
  const guestBody = await responseText(`${API_ORIGIN}/auth/guest/start`, { method: "POST" });
  const jwt = JSON.parse(guestBody).token;
  if (!jwt) fail("TxLINE guest authentication returned no token.");

  const message = new TextEncoder().encode(`${txSig}:${LEAGUES.join(",")}:${jwt}`);
  const walletSignature = Buffer.from(nacl.sign.detached(message, keypair.secretKey)).toString("base64");
  const activationBody = await responseText(`${API_ORIGIN}/api/token/activate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ txSig, walletSignature, leagues: LEAGUES }),
  });
  let apiToken = activationBody;
  try { apiToken = JSON.parse(activationBody).token || JSON.parse(activationBody); } catch { /* plain token */ }
  if (typeof apiToken !== "string" || !apiToken) fail("TxLINE activation returned no API token.");
  return { jwt, apiToken: apiToken.replace(/^"|"$/g, "") };
}

function authHeaders(session) {
  if (!session.jwt || !session.apiToken) fail(`No active credentials at ${SESSION_PATH}. Run "npm run txline:activate" first.`);
  return { Authorization: `Bearer ${session.jwt}`, "X-Api-Token": session.apiToken };
}

function field(source, name) {
  if (!source || typeof source !== "object") return undefined;
  const key = Object.keys(source).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? source[key] : undefined;
}

async function apiJson(path, session) {
  const body = await responseText(`${API_ORIGIN}/api${path}`, { headers: authHeaders(session) });
  try {
    return JSON.parse(body);
  } catch (error) {
    const dataRows = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => JSON.parse(line.slice(5).trim()));
    if (dataRows.length) return dataRows.flatMap((row) => Array.isArray(row) ? row : [row]);
    throw error;
  }
}

async function optionalApi(path, session, label) {
  try {
    const payload = await apiJson(path, session);
    const count = Array.isArray(payload) ? payload.length : 1;
    console.log(`${label}: OK (${count} record${count === 1 ? "" : "s"})`);
    return payload;
  } catch (error) {
    console.log(`${label}: unavailable (${error instanceof Error ? error.message.slice(0, 240) : error})`);
    return null;
  }
}

async function streamProbe(path, session, label) {
  try {
    const response = await fetch(`${API_ORIGIN}/api${path}`, {
      headers: { ...authHeaders(session), Accept: "text/event-stream" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) fail(`${response.status} ${await response.text()}`);
    console.log(`${label}: OK (${response.headers.get("content-type") || "stream opened"})`);
    await response.body?.cancel();
  } catch (error) {
    console.log(`${label}: unavailable (${error instanceof Error ? error.message.slice(0, 240) : error})`);
  }
}

async function fixtureCheck(session) {
  const batches = await Promise.all(FIXTURE_WINDOWS.map((day) => apiJson(`/fixtures/snapshot?startEpochDay=${day}`, session)));
  const fixtures = [...new Map(batches.flat().map((fixture) => [String(fixture.FixtureId), fixture])).values()];
  const competitions = [...new Set(fixtures.map((fixture) => fixture.Competition).filter(Boolean))];
  console.log(`Fixtures API: OK (${fixtures.length} fixtures)`);
  console.log(`Competitions: ${competitions.join(", ") || "not supplied"}`);

  const nowSeconds = Date.now() / 1000;
  const startSeconds = (fixture) => {
    const value = Number(fixture.StartTime);
    return value > 10_000_000_000 ? value / 1000 : value;
  };
  const historicalFixtures = fixtures
    .filter((fixture) => nowSeconds - startSeconds(fixture) >= 6 * 60 * 60 && nowSeconds - startSeconds(fixture) <= 14 * 24 * 60 * 60)
    .sort((a, b) => startSeconds(b) - startSeconds(a));
  const historicalFixture = historicalFixtures[0];
  if (!historicalFixture) {
    console.log("Historical API: no fixture currently falls inside TxLINE's 6-hour-to-2-week per-fixture window.");
    return;
  }
  const events = await apiJson(`/scores/historical/${historicalFixture.FixtureId}`, session);
  const rows = Array.isArray(events) ? events : [];
  const lineupRow = [...rows].reverse().find((row) => Array.isArray(field(row, "lineups")) && field(row, "lineups").length);
  const statsRow = [...rows].reverse().find((row) => field(row, "playerStatsSoccer"));
  const lineups = field(lineupRow, "lineups") || [];
  const playerCount = lineups.reduce((sum, team) => {
    const players = field(team, "lineups");
    return sum + (Array.isArray(players) ? players.length : 0);
  }, 0);
  const playerStats = field(statsRow, "playerStatsSoccer");
  const statKeys = playerStats
    ? Object.values(playerStats).reduce((sum, team) => sum + Object.keys(team || {}).length, 0)
    : 0;
  const actionCounts = new Map();
  for (const row of rows) {
    const action = String(field(row, "action") || "unknown");
    actionCounts.set(action, (actionCounts.get(action) || 0) + 1);
  }
  const commonActions = [...actionCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([action, count]) => `${action}:${count}`).join(", ");
  const playerEventCounts = new Map();
  for (const row of rows) {
    const action = String(field(row, "action") || "unknown");
    const soccer = field(row, "dataSoccer");
    const attributed = ["playerId", "playerInId", "playerOutId"].some((key) => Number(field(soccer, key)) > 0);
    if (attributed) playerEventCounts.set(action, (playerEventCounts.get(action) || 0) + 1);
  }
  const attributedActions = [...playerEventCounts.entries()].sort((a, b) => b[1] - a[1]).map(([action, count]) => `${action}:${count}`).join(", ");
  const relevantActions = [...actionCounts.entries()]
    .filter(([action]) => /goal|shot|card|penalty|substitution|game_finalised|lineup/i.test(action))
    .sort((a, b) => b[1] - a[1])
    .map(([action, count]) => `${action}:${count}`).join(", ");
  console.log(`Historical API: OK (fixture ${historicalFixture.FixtureId}, ${rows.length} events)`);
  console.log(`Historical payload: ${playerCount} lineup players, ${statKeys} player-stat records`);
  console.log(`Historical actions: ${commonActions}`);
  console.log(`Relevant actions: ${relevantActions || "none"}`);
  console.log(`Player-attributed actions: ${attributedActions || "none"}`);
  const shotRow = rows.find((row) => String(field(row, "action")) === "shot");
  const shotSoccer = field(shotRow, "dataSoccer");
  const shotData = field(shotRow, "data");
  console.log(`Historical event fields: ${Object.keys(shotRow || rows[0] || {}).join(", ")}`);
  console.log(`Shot data fields: ${Object.keys(shotSoccer || shotData || {}).join(", ") || "none"}`);
  console.log(`Shot data sample: ${JSON.stringify(shotSoccer ?? shotData ?? null).slice(0, 500)}`);

  for (const candidate of historicalFixtures.slice(1, 5)) {
    const candidateEvents = await apiJson(`/scores/historical/${candidate.FixtureId}`, session);
    const candidateRows = Array.isArray(candidateEvents) ? candidateEvents : [];
    const candidateStats = [...candidateRows].reverse().map((row) => field(row, "playerStatsSoccer")).find((value) => value && Object.values(value).some((team) => Object.keys(team || {}).length));
    const attributed = candidateRows.filter((row) => {
      const data = field(row, "dataSoccer") || field(row, "data");
      return data && typeof data === "object" && Object.keys(data).length > 0;
    }).length;
    const secondary = candidateRows.some((row) => field(row, "coverageSecondaryData") === true);
    const statCount = candidateStats ? Object.values(candidateStats).reduce((sum, team) => sum + Object.keys(team || {}).length, 0) : 0;
    console.log(`Coverage sample ${candidate.FixtureId}: ${candidateRows.length} events, ${statCount} player-stat records, ${attributed} non-empty action-data records, secondary=${secondary}`);
    if (candidate === historicalFixtures[1]) {
      for (const actionName of ["shot", "goal", "yellow_card", "red_card", "substitution"]) {
        const sample = candidateRows.find((row) => String(field(row, "action")) === actionName && Object.keys(field(row, "data") || {}).length);
        console.log(`${actionName} data sample: ${JSON.stringify(field(sample, "data") || null).slice(0, 500)}`);
      }
    }
  }

  await optionalApi(`/scores/snapshot/${historicalFixture.FixtureId}`, session, "Scores snapshot API");
  const upcomingFixture = fixtures.filter((fixture) => startSeconds(fixture) > nowSeconds).sort((a, b) => startSeconds(a) - startSeconds(b))[0];
  if (upcomingFixture) await optionalApi(`/odds/snapshot/${upcomingFixture.FixtureId}`, session, "Odds snapshot API");
  const finalRow = [...rows].reverse().find((row) => String(field(row, "action")) === "game_finalised" && Number(field(row, "seq")) > 0);
  if (finalRow) {
    await optionalApi(`/scores/stat-validation?fixtureId=${historicalFixture.FixtureId}&seq=${field(finalRow, "seq")}&statKeys=1,2`, session, "Stat-validation API");
  } else {
    console.log("Stat-validation API: no game_finalised sequence found in this history");
  }
  await streamProbe("/scores/stream", session, "Scores stream");
  await streamProbe("/odds/stream", session, "Odds stream");
}

async function syncHistorical(session, fixtureId, endpointArgument, metadataOnly = false) {
  const endpoint = (endpointArgument || process.env.TXLINE_INGEST_URL || "").replace(/\/$/, "");
  if (!endpoint) fail("Set TXLINE_INGEST_URL to the app origin, for example http://localhost:3000 or the deployed site URL.");
  const batches = await Promise.all(FIXTURE_WINDOWS.map((day) => apiJson(`/fixtures/snapshot?startEpochDay=${day}`, session)));
  const fixtures = [...new Map(batches.flat().map((fixture) => [String(fixture.FixtureId), fixture])).values()];
  const nowSeconds = Date.now() / 1000;
  const startSeconds = (fixture) => {
    const value = Number(fixture.StartTime);
    return value > 10_000_000_000 ? value / 1000 : value;
  };
  const selected = metadataOnly
    ? fixtures
    : fixtureId
    ? fixtures.filter((fixture) => String(fixture.FixtureId) === fixtureId)
    : fixtures.filter((fixture) => nowSeconds - startSeconds(fixture) >= 6 * 60 * 60);
  if (!selected.length) fail(fixtureId ? `Fixture ${fixtureId} was not returned by the configured World Cup windows.` : "No historical fixtures are currently eligible.");
  const secret = await ingestSecret();
  let imported = 0;
  const failures = [];
  console.log(`Importing ${selected.length} ${metadataOnly ? "current/upcoming" : "historical"} fixture${selected.length === 1 ? "" : "s"} into ${endpoint}...`);
  let nextIndex = 0;
  const importOne = async () => {
    while (nextIndex < selected.length) {
      const index = nextIndex;
      nextIndex += 1;
      const fixture = selected[index];
    const id = String(fixture.FixtureId);
    try {
      const history = metadataOnly ? [] : await apiJson(`/scores/historical/${id}`, session);
      const headers = { "content-type": "application/json", Authorization: `Bearer ${secret}` };
      if (process.env.TXLINE_SITES_BYPASS_TOKEN) headers["OAI-Sites-Authorization"] = `Bearer ${process.env.TXLINE_SITES_BYPASS_TOKEN}`;
      const response = await fetch(`${endpoint}/api/data/ingest/txline`, {
        method: "POST",
        headers,
        body: JSON.stringify({ fixture, history, metadataOnly }),
        signal: AbortSignal.timeout(120_000),
      });
      const result = await response.text();
      if (!response.ok) fail(`${response.status}: ${result.slice(0, 2_000)}`);
      imported += 1;
      console.log(`[${index + 1}/${selected.length}] ${id}: ${result}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ fixtureId: id, error: message });
      console.log(`[${index + 1}/${selected.length}] ${id}: skipped (${message.slice(0, 2_000)})`);
    }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, selected.length) }, () => importOne()));
  console.log(`${metadataOnly ? "Fixture index" : "Historical sync"} finished: ${imported} imported, ${failures.length} unavailable.`);
  if (failures.length) console.log(`Unavailable fixtures: ${failures.map((failure) => failure.fixtureId).join(", ")}`);
  if (!imported) process.exitCode = 1;
}

async function run() {
  const command = process.argv[2] || "check";
  if (command === "secret") {
    const secret = await ingestSecret();
    const devVarsPath = resolve(".dev.vars");
    await writeFile(devVarsPath, `TXLINE_INGEST_SECRET=${secret}\n`, { mode: 0o600 });
    console.log(`Ingestion secret is ready at ${INGEST_SECRET_PATH}.`);
    console.log(`Local development binding is ready at ${devVarsPath}.`);
    return;
  }
  if (command === "activate") {
    const keypair = await loadOrCreateKeypair();
    const balance = await ensureBalance(keypair);
    console.log(`Wallet: ${keypair.publicKey.toBase58()} (${(balance / LAMPORTS_PER_SOL).toFixed(4)} devnet SOL)`);
    let session = await readSession();
    if (!session.txSig) {
      console.log(`Subscribing to TxLINE devnet service level ${SERVICE_LEVEL_ID} for ${DURATION_WEEKS} weeks…`);
      session = { wallet: keypair.publicKey.toBase58(), txSig: await subscribe(keypair) };
      await privateWrite(SESSION_PATH, session);
      console.log(`Subscription confirmed: ${session.txSig}`);
    }
    if (!session.apiToken || !session.jwt) {
      console.log("Activating TxLINE API credentials…");
      const credentials = await activate(keypair, session.txSig);
      session = { ...session, ...credentials, activatedAt: new Date().toISOString() };
      await privateWrite(SESSION_PATH, session);
    }
    console.log(`TxLINE activation: OK (credentials stored privately at ${SESSION_PATH})`);
    await fixtureCheck(session);
    return;
  }

  const session = await readSession();
  if (command === "index") {
    await syncHistorical(session, undefined, process.argv[3], true);
    return;
  }
  if (command === "sync") {
    const fixtureId = process.argv[3] === "all" ? undefined : process.argv[3];
    if (fixtureId && !/^\d+$/.test(fixtureId)) fail("Usage: npm run txline:sync -- [fixtureId]");
    await syncHistorical(session, fixtureId, process.argv[4]);
    return;
  }
  if (command === "historical") {
    const fixtureId = process.argv[3];
    if (!/^\d+$/.test(fixtureId || "")) fail("Usage: npm run txline:historical -- <fixtureId>");
    const events = await apiJson(`/scores/historical/${fixtureId}`, session);
    console.log(JSON.stringify(events, null, 2));
    return;
  }
  if (command === "inspect") {
    const fixtureId = process.argv[3];
    if (!/^\d+$/.test(fixtureId || "")) fail("Usage: node scripts/txline-devnet.mjs inspect <fixtureId>");
    const events = await apiJson(`/scores/historical/${fixtureId}`, session);
    const rows = Array.isArray(events) ? events : [];
    const lineupRow = [...rows].reverse().find((row) => Array.isArray(field(row, "lineups")) && field(row, "lineups").length);
    const sides = field(lineupRow, "lineups") || [];
    const firstSide = sides[0] || {};
    const lineup = field(firstSide, "lineups") || [];
    console.log(`Lineup side sample: ${JSON.stringify(firstSide).slice(0, 4_000)}`);
    console.log(`Lineup player sample: ${JSON.stringify(lineup[0] || null).slice(0, 2_000)}`);
    const actionSamples = rows.filter((row) => Object.keys(field(row, "data") || {}).length).slice(0, 12);
    console.log(`Attributed action samples: ${JSON.stringify(actionSamples, null, 2).slice(0, 12_000)}`);
    return;
  }
  if (command !== "check") fail("Commands: activate, check, historical <fixtureId>, inspect <fixtureId>, sync [fixtureId], index [endpoint], secret");
  await fixtureCheck(session);
}

run().catch((error) => {
  console.error(`TxLINE CLI failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
