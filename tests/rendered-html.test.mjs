import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("stores TxLINE history with coverage and reconciliation metadata", async () => {
  const [schema, archive, ingest] = await Promise.all([
    source("db/schema.ts"),
    source("lib/txline/archive.ts"),
    source("app/api/data/ingest/txline/route.ts"),
  ]);

  assert.match(schema, /fixtureSyncState/);
  assert.match(schema, /dataCoverage/);
  assert.match(schema, /performanceScore/);
  assert.match(schema, /formulaVersion/);
  assert.match(archive, /createTxlineArchive/);
  assert.match(archive, /"complete" \| "partial" \| "unavailable"/);
  assert.match(ingest, /TXLINE_INGEST_SECRET/);
  assert.match(ingest, /historicalFetchedAt/);
  assert.match(ingest, /reconciledAt/);
});

test("uses position-weighted scoring and real stored data in the mobile app", async () => {
  const [scoring, page, cli] = await Promise.all([
    source("lib/scoring.ts"),
    source("app/page.tsx"),
    source("scripts/txline-devnet.mjs"),
  ]);

  assert.match(scoring, /PLAYER_SCORE_FORMULA_VERSION = "position-v1"/);
  assert.match(scoring, /ATT: \{ goals: 8/);
  assert.match(scoring, /MID: \{ goals: 7/);
  assert.match(scoring, /DEF: \{ goals: 10/);
  assert.match(page, /\/api\/data\/fixtures/);
  assert.match(page, /storedFeed/);
  assert.match(cli, /syncHistorical/);
  assert.match(cli, /metadataOnly/);
  assert.match(cli, /Historical sync/);
});
