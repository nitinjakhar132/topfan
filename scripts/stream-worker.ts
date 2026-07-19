/**
 * ONE NATION — Standalone Stream Worker
 *
 * Maintains persistent SSE connections to TxLINE's scores and odds streams.
 * Parses events in real-time, logs updates, and forwards them to the Next.js app.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const SESSION_PATH = resolve("work/txline-devnet-session.json");
const INGEST_SECRET_PATH = resolve("work/txline-ingest-secret.txt");

type Session = {
  jwt?: string;
  apiToken?: string;
};

// SSE Parser
type SseMessage = {
  id?: string;
  event?: string;
  data: string;
  retry?: number;
};

function parseSseBlock(block: string): SseMessage | null {
  const message: SseMessage = { data: "" };

  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(":")) continue;

    const separatorIndex = rawLine.indexOf(":");
    const field = separatorIndex === -1 ? rawLine : rawLine.slice(0, separatorIndex);
    const value =
      separatorIndex === -1
        ? ""
        : rawLine.slice(separatorIndex + 1).replace(/^ /, "");

    if (field === "data") message.data += `${value}\n`;
    if (field === "event") message.event = value;
    if (field === "id") message.id = value;
    if (field === "retry") message.retry = Number(value);
  }

  message.data = message.data.replace(/\n$/, "");
  return message.data || message.event || message.id ? message : null;
}

async function* readSseMessages(response: Response): AsyncGenerator<SseMessage> {
  if (!response.body) throw new Error("Stream response has no body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let separator = buffer.match(/\r?\n\r?\n/);
      while (separator?.index !== undefined) {
        const block = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);

        const message = parseSseBlock(block);
        if (message) yield message;

        separator = buffer.match(/\r?\n\r?\n/);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function run() {
  console.log("[Stream Worker] Starting TxLINE stream listener...");

  if (!existsSync(SESSION_PATH)) {
    console.error(`[Stream Worker] Session file not found at ${SESSION_PATH}. Run 'npm run txline:activate' first.`);
    process.exit(1);
  }

  const sessionContent = await readFile(SESSION_PATH, "utf8");
  const session = JSON.parse(sessionContent) as Session;

  if (!session.jwt || !session.apiToken) {
    console.error("[Stream Worker] Session lacks JWT or API token.");
    process.exit(1);
  }

  const ingestSecret = existsSync(INGEST_SECRET_PATH)
    ? (await readFile(INGEST_SECRET_PATH, "utf8")).trim()
    : "";

  const endpoint = process.env.TXLINE_INGEST_URL || "http://localhost:3000";

  // Connect to scores stream
  const streamUrl = "https://txline-dev.txodds.com/api/scores/stream";
  console.log(`[Stream Worker] Connecting to scores stream: ${streamUrl}`);

  try {
    const res = await fetch(streamUrl, {
      headers: {
        Authorization: `Bearer ${session.jwt}`,
        "X-Api-Token": session.apiToken,
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });

    if (!res.ok) {
      throw new Error(`Connection failed with status ${res.status}: ${await res.text()}`);
    }

    console.log("[Stream Worker] Connected! Listening for real-time events...");

    for await (const message of readSseMessages(res)) {
      console.log(`[Stream Worker] Received SSE block:`, message.event ?? "message", message.data.slice(0, 100));

      if (ingestSecret) {
        try {
          const parsed = JSON.parse(message.data);
          const fixtureId = parsed.FixtureId ?? parsed.fixtureId;
          if (fixtureId) {
            console.log(`[Stream Worker] Forwarding event for fixture ${fixtureId} to app...`);
            // Forward to the app's ingest endpoint so database is updated
            await fetch(`${endpoint}/api/data/ingest/txline`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${ingestSecret}`,
              },
              body: JSON.stringify({
                fixture: parsed,
                history: [parsed],
                metadataOnly: false,
              }),
            });
          }
        } catch (err) {
          console.error(`[Stream Worker] Failed to forward event to app:`, err);
        }
      }
    }
  } catch (error) {
    console.error("[Stream Worker] Stream error occurred:", error);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("[Stream Worker] Fatal error:", err);
  process.exit(1);
});
