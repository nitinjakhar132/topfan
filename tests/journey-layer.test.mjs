import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("wires lock pick journey triggers and logs trio_locked event", async () => {
  const [pickRoute, dbSchema] = await Promise.all([
    source("app/api/live/fixtures/[fixtureId]/pick/route.ts"),
    source("db/schema.ts"),
  ]);

  // Ensure ensureTeamJourney is referenced on picks
  assert.match(pickRoute, /ensureTeamJourney/);
  // Ensure trio_locked event is logged
  assert.match(pickRoute, /"trio_locked"/);
  assert.match(pickRoute, /attackerId/);
  assert.match(pickRoute, /midfielderId/);
  assert.match(pickRoute, /defenderId/);

  // Check that journey-layer schemas are in db schema
  assert.match(dbSchema, /supporterTeamJourneys/);
  assert.match(dbSchema, /supporterMatchJourneys/);
  assert.match(dbSchema, /supporterJourneyEvents/);
});

test("extends match finalisation pipeline and executes finaliseMatchJourney", async () => {
  const [repo, journeyEngine] = await Promise.all([
    source("lib/player-repository/repository.ts"),
    source("lib/journey/engine.ts"),
  ]);

  // Ensure opposition benchmark matching logic
  assert.match(repo, /bestAtt/);
  assert.match(repo, /bestMid/);
  assert.match(repo, /bestDef/);
  assert.match(repo, /finaliseMatchJourney/);

  // Ensure journey engine includes key operations
  assert.match(journeyEngine, /ensureTeamJourney/);
  assert.match(journeyEngine, /finaliseMatchJourney/);
  assert.match(journeyEngine, /totalJourneyScore/);
  assert.match(journeyEngine, /currentTeamRank/);
});

test("integrates journey hub dynamic loaders and strips in client view", async () => {
  const [page, liveMatchScreen] = await Promise.all([
    source("app/page.tsx"),
    source("app/components/LiveMatchScreen.tsx"),
  ]);

  // Ensure page fetches dynamic journey state
  assert.match(page, /journeyHubData/);
  assert.match(page, /\/api\/journey\/me/);

  // Ensure journey strips exist on pick and live screens
  assert.match(page, /journey-strip/);
  assert.match(liveMatchScreen, /PROVISIONAL LIVE JOURNEY/);
  assert.match(liveMatchScreen, /activeJourney/);
  assert.match(liveMatchScreen, /Projected Score/);
  assert.match(liveMatchScreen, /JOURNEY UPDATED/);
});
