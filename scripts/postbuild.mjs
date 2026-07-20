/**
 * Post-build script for Cloudflare Pages deployment.
 *
 * 1. Copies dist/client/* → dist/ so static assets are at the output root
 *    (Cloudflare Pages ASSETS binding needs them there).
 * 2. Rewrites dist/_worker.js to intercept /assets/* and static file requests
 *    via env.ASSETS.fetch() BEFORE hitting the vinext server router — because
 *    vinext's __publicFiles set only contains public/ dir entries, not built
 *    CSS/JS assets.
 * 3. Deletes .wrangler/deploy/config.json so wrangler falls back to
 *    wrangler.toml (which carries nodejs_compat).
 */

import { readdirSync, statSync, copyFileSync, mkdirSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";

// --- 1. Copy dist/client/* → dist/ ---
function copyRecursive(src, dst) {
  if (!existsSync(dst)) mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dst, entry);
    if (statSync(s).isDirectory()) {
      copyRecursive(s, d);
    } else {
      copyFileSync(s, d);
    }
  }
}
copyRecursive("dist/client", "dist");
console.log("[postbuild] Copied dist/client → dist");

// --- 2. Rewrite _worker.js to serve static assets via env.ASSETS ---
const workerContent = `import worker from "./server/index.js";

// Static-asset extensions that should bypass the vinext router entirely
const STATIC_EXT = /\\.(css|js|mjs|json|svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot|map|txt)$/i;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Serve built assets and public files directly via Pages ASSETS binding
    if (
      url.pathname.startsWith("/assets/") ||
      url.pathname.startsWith("/flags/") ||
      url.pathname.startsWith("/players/") ||
      STATIC_EXT.test(url.pathname)
    ) {
      try {
        const assetResponse = await env.ASSETS.fetch(request);
        if (assetResponse.status !== 404) return assetResponse;
      } catch (_) { /* fall through to worker */ }
    }

    // Everything else goes to the vinext worker
    return worker.fetch(request, env, ctx);
  }
};
`;
writeFileSync("dist/_worker.js", workerContent);
console.log("[postbuild] Rewrote dist/_worker.js with static-asset passthrough");

// --- 3. Remove vinext's redirect config so wrangler.toml is used ---
try {
  unlinkSync(".wrangler/deploy/config.json");
  console.log("[postbuild] Deleted .wrangler/deploy/config.json");
} catch (_) {
  // Doesn't exist in CI — that's fine
}
