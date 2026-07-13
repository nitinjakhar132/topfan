import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
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

async function apiJson(path, session) {
  const body = await responseText(`${API_ORIGIN}/api${path}`, { headers: authHeaders(session) });
  return JSON.parse(body);
}

async function fixtureCheck(session) {
  const batches = await Promise.all(FIXTURE_WINDOWS.map((day) => apiJson(`/fixtures/snapshot?startEpochDay=${day}`, session)));
  const fixtures = [...new Map(batches.flat().map((fixture) => [String(fixture.FixtureId), fixture])).values()];
  const competitions = [...new Set(fixtures.map((fixture) => fixture.Competition).filter(Boolean))];
  console.log(`Fixtures API: OK (${fixtures.length} fixtures)`);
  console.log(`Competitions: ${competitions.join(", ") || "not supplied"}`);

  const nowSeconds = Date.now() / 1000;
  const historicalFixture = fixtures
    .filter((fixture) => nowSeconds - Number(fixture.StartTime) >= 6 * 60 * 60 && nowSeconds - Number(fixture.StartTime) <= 14 * 24 * 60 * 60)
    .sort((a, b) => Number(b.StartTime) - Number(a.StartTime))[0];
  if (!historicalFixture) {
    console.log("Historical API: no fixture currently falls inside TxLINE's 6-hour-to-2-week per-fixture window.");
    return;
  }
  const events = await apiJson(`/scores/historical/${historicalFixture.FixtureId}`, session);
  const rows = Array.isArray(events) ? events : [];
  const lineupRow = [...rows].reverse().find((row) => Array.isArray(row.lineups) && row.lineups.length);
  const statsRow = [...rows].reverse().find((row) => row.playerStatsSoccer);
  const playerCount = lineupRow?.lineups?.reduce((sum, team) => sum + (Array.isArray(team.lineups) ? team.lineups.length : 0), 0) || 0;
  const statKeys = statsRow?.playerStatsSoccer
    ? Object.values(statsRow.playerStatsSoccer).reduce((sum, team) => sum + Object.keys(team || {}).length, 0)
    : 0;
  console.log(`Historical API: OK (fixture ${historicalFixture.FixtureId}, ${rows.length} events)`);
  console.log(`Historical payload: ${playerCount} lineup players, ${statKeys} player-stat records`);
}

async function run() {
  const command = process.argv[2] || "check";
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
  if (command === "historical") {
    const fixtureId = process.argv[3];
    if (!/^\d+$/.test(fixtureId || "")) fail("Usage: npm run txline:historical -- <fixtureId>");
    const events = await apiJson(`/scores/historical/${fixtureId}`, session);
    console.log(JSON.stringify(events, null, 2));
    return;
  }
  if (command !== "check") fail("Commands: activate, check, historical <fixtureId>");
  await fixtureCheck(session);
}

run().catch((error) => {
  console.error(`TxLINE CLI failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
