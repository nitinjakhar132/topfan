/**
 * download-headshots.mjs
 * Downloads low-res player headshots from Sofascore for every player
 * found across all TxLINE match histories.
 *
 * Usage:
 *   node scripts/download-headshots.mjs
 *
 * Saves files to: public/players/{sofascoreId}.png
 * Skips players whose photo already exists on disk.
 */
import { readFile, writeFile, access, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PLAYERS_DIR = join(ROOT, "public", "players");
const SESSION_PATH = join(ROOT, "work", "txline-devnet-session.json");

// Sofascore image CDN — medium quality (96×96) player photos
const SOFASCORE_IMG = (id) =>
  `https://api.sofascore.com/api/v1/player/${id}/image`;

// Fallback: smaller thumbnail
const SOFASCORE_IMG_SMALL = (id) =>
  `https://api.sofascore.com/api/v1/player/${id}/image?type=small`;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
  Referer: "https://www.sofascore.com/",
  Accept: "image/webp,image/avif,image/png,*/*",
};

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function downloadImage(url, dest) {
  const resp = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
  if (!resp.ok) return false;
  const ct = resp.headers.get("content-type") ?? "";
  if (!ct.startsWith("image/")) return false;
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length < 1000) return false; // too small → placeholder / error
  await writeFile(dest, buf);
  return true;
}

async function loadSession() {
  try {
    return JSON.parse(await readFile(SESSION_PATH, "utf8"));
  } catch {
    throw new Error(
      `Session file not found at ${SESSION_PATH}. Run the devnet sync first.`
    );
  }
}

async function fetchFixtureIds(sess) {
  const h = {
    Authorization: `Bearer ${sess.jwt}`,
    "X-Api-Token": sess.apiToken,
  };
  const fixtureIds = new Set();
  // Fetch from two time windows (same as the sync script)
  for (const epochDay of [20615, 20645]) {
    const url = `https://txline-dev.txodds.com/api/fixtures/snapshot?startEpochDay=${epochDay}`;
    const resp = await fetch(url, { headers: h, signal: AbortSignal.timeout(30_000) });
    if (!resp.ok) continue;
    const data = await resp.json();
    const rows = Array.isArray(data) ? data : data?.fixtures ?? [];
    for (const row of rows) {
      if (row?.FixtureId) fixtureIds.add(String(row.FixtureId));
    }
  }
  return [...fixtureIds];
}

function parseSSE(text) {
  return text
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => {
      try { return JSON.parse(l.slice(5).trim()); } catch { return null; }
    })
    .filter(Boolean);
}

async function collectNormativeIds(sess, fixtureIds) {
  const headers = {
    Authorization: `Bearer ${sess.jwt}`,
    "X-Api-Token": sess.apiToken,
  };
  const idMap = new Map(); // normativeId -> player name
  let processed = 0;
  const CONCURRENCY = 5;

  async function processFixture(fid) {
    try {
      const resp = await fetch(
        `https://txline-dev.txodds.com/api/scores/historical/${fid}`,
        { headers, signal: AbortSignal.timeout(30_000) }
      );
      if (!resp.ok) return;
      const text = await resp.text();
      const rows = parseSSE(text);
      const lineupRows = rows.filter((r) => {
        const l = r.Lineups || r.lineups;
        return Array.isArray(l) && l.length;
      });
      if (!lineupRows.length) return;
      const lr = lineupRows[lineupRows.length - 1];
      const sides = lr.Lineups || lr.lineups || [];
      for (const side of sides) {
        const players = side?.lineups || side?.Lineups || [];
        for (const entry of players) {
          const playerObj = entry?.player || entry?.Player;
          const normId = playerObj?.normativeId || playerObj?.NormativeId || entry?.normativeId || entry?.NormativeId;
          const name = playerObj?.preferredName || playerObj?.PreferredName || playerObj?.name || playerObj?.Name || "";
          if (normId && !idMap.has(normId)) idMap.set(normId, name);
        }
      }
    } catch {
      // skip unreachable fixtures silently
    }
  }

  // Process in batches
  for (let i = 0; i < fixtureIds.length; i += CONCURRENCY) {
    const batch = fixtureIds.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(processFixture));
    processed += batch.length;
    process.stdout.write(`\rScanned ${processed}/${fixtureIds.length} fixtures, found ${idMap.size} unique players…`);
  }
  console.log();
  return idMap;
}

async function main() {
  console.log("🎽 TxLINE Player Headshot Downloader");
  console.log("─────────────────────────────────────");

  await mkdir(PLAYERS_DIR, { recursive: true });

  const sess = await loadSession();
  console.log("✓ Session loaded");

  console.log("Fetching fixture list from TxLINE devnet…");
  const fixtureIds = await fetchFixtureIds(sess);
  console.log(`✓ Found ${fixtureIds.length} fixtures`);

  console.log("Scanning match histories for player normative IDs…");
  const idMap = await collectNormativeIds(sess, fixtureIds);
  console.log(`✓ Found ${idMap.size} unique players with normative IDs`);

  // Count how many are already cached
  let existing = 0;
  let downloaded = 0;
  let failed = 0;
  const total = idMap.size;
  let done = 0;

  for (const [normId, name] of idMap) {
    done++;
    const dest = join(PLAYERS_DIR, `${normId}.png`);
    if (await fileExists(dest)) {
      existing++;
      process.stdout.write(`\r[${done}/${total}] ${existing} cached, ${downloaded} new, ${failed} failed`);
      continue;
    }

    // Try main then fallback URL
    let ok = await downloadImage(SOFASCORE_IMG(normId), dest);
    if (!ok) ok = await downloadImage(SOFASCORE_IMG_SMALL(normId), dest);

    if (ok) {
      downloaded++;
    } else {
      failed++;
      // Leave the SVG placeholder; don't create a broken file
    }
    process.stdout.write(
      `\r[${done}/${total}] ${existing} cached, ${downloaded} new, ${failed} no-photo  (${name.split(",")[1]?.trim() ?? name})`
    );

    // Polite rate-limit to avoid being blocked
    await new Promise((r) => setTimeout(r, 80));
  }

  console.log("\n");
  console.log("─────────────────────────────────────");
  console.log(`✅ Done! ${downloaded} downloaded, ${existing} already cached, ${failed} no photo available.`);
  console.log(`📁 Saved to: ${PLAYERS_DIR}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
