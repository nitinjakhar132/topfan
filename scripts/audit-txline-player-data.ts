import { existsSync, mkdirSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { dirname, resolve } from "path";

/**
 * TxLINE Capability Audit Script
 *
 * Calls the server's capability audit endpoint to analyze raw stored events
 * and generates the tournament-wide capability registry `data/txline-capabilities.json`.
 */

const INGEST_SECRET_PATH = resolve("work/txline-ingest-secret.txt");

async function getIngestSecret(): Promise<string> {
  if (process.env.TXLINE_INGEST_SECRET) {
    return process.env.TXLINE_INGEST_SECRET;
  }
  if (existsSync(INGEST_SECRET_PATH)) {
    return (await readFile(INGEST_SECRET_PATH, "utf8")).trim();
  }
  throw new Error(`Ingestion secret not found. Run 'npm run txline:secret' or set TXLINE_INGEST_SECRET first.`);
}

async function runAudit() {
  const secret = await getIngestSecret();
  const origin = process.env.TXLINE_INGEST_URL || "http://localhost:3000";

  console.log(`[Audit] Fetching capability audit from ${origin}/api/data/audit...`);

  const response = await fetch(`${origin}/api/data/audit`, {
    headers: {
      Authorization: `Bearer ${secret}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Audit endpoint returned status ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json() as any;

  // Persist the capability registry
  const capPath = resolve("data/txline-capabilities.json");
  mkdirSync(dirname(capPath), { recursive: true });
  await writeFile(capPath, JSON.stringify(payload.metrics, null, 2), "utf8");

  console.log(`[Audit] Persisted data/txline-capabilities.json successfully.`);
  console.log("\n=================== TxLINE CAPABILITY REPORT ===================");
  console.log(`Surveyed Fixtures : ${payload.fixturesSurveyed}`);
  console.log(`Finalised Fixtures: ${payload.fixturesFinalised}`);
  console.log(`Total Events      : ${payload.totalEventsAnalysed}`);
  console.log(`Total Players     : ${payload.totalPlayersInDb}`);
  console.log("----------------------------------------------------------------");
  
  console.log("Metric Coverage Rates (Attribution / Presence):");
  for (const [key, metric] of Object.entries(payload.metrics) as any[]) {
    const check = metric.reliable ? "✓ RELIABLE" : "✗ UNRELIABLE/MISSING";
    console.log(
      ` - ${key.padEnd(16)}: ${check.padEnd(20)} (Attribution: ${String(metric.playerAttributionRate).padEnd(4)}, Presence: ${metric.fixturePresenceRate})`
    );
  }

  console.log("----------------------------------------------------------------");
  console.log("Stable Identity Metrics:");
  console.log(` - Total normative players resolved: ${payload.playerIdentity.withNormativeId}`);
  console.log(` - Multi-fixture player entries    : ${payload.playerIdentity.multiFixturePlayers}`);
  console.log(` - Conflict name variants          : ${payload.playerIdentity.nameConflicts}`);
  console.log("================================================================");
}

runAudit().catch((error) => {
  console.error("Capability audit script failed:", error);
  process.exitCode = 1;
});
