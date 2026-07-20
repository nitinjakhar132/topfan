/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { ensureArchiveDatabase } from "@/db";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

// Paths that are purely static assets — skip DB init to avoid blocking
// concurrent asset requests which caused the "Worker hung" CPU timeout.
function isStaticAssetPath(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/static/") ||
    pathname === "/favicon.ico" ||
    pathname === "/favicon.svg" ||
    pathname === "/og.png" ||
    pathname === "/robots.txt" ||
    pathname === "/manifest.json"
  );
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    // For static asset requests, skip DB init entirely — they don't need it
    // and blocking them caused "Worker hung" CPU timeout errors because many
    // concurrent asset requests all waited on the same long-running init promise.
    if (!isStaticAssetPath(url.pathname)) {
      if (url.pathname.startsWith("/api/")) {
        // API routes: await DB init so the route handler always sees the tables
        try {
          await ensureArchiveDatabase();
        } catch (e) {
          console.error("[Worker] ensureArchiveDatabase failed:", e);
        }
      } else {
        // Page routes: fire-and-forget DB init in background so the page renders
        // immediately (it only queries DB client-side via fetch after hydration).
        ctx.waitUntil(ensureArchiveDatabase().catch((e) =>
          console.error("[Worker] ensureArchiveDatabase background init failed:", e)
        ));
      }
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
