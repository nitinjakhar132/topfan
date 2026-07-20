import { access, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

// Packages Sites metadata and migrations after Vite finishes compiling.
export function sites(): Plugin {
  let root = process.cwd();

  return {
    name: "sites",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    async closeBundle() {
      const outputDirectory = resolve(root, "dist", ".openai");
      const hostingConfig = resolve(root, ".openai", "hosting.json");
      const drizzleSource = resolve(root, "drizzle");

      await rm(outputDirectory, { recursive: true, force: true });
      await mkdir(outputDirectory, { recursive: true });

      if (await exists(hostingConfig)) {
        await cp(hostingConfig, resolve(outputDirectory, "hosting.json"));
      }
      if (await exists(drizzleSource)) {
        await cp(drizzleSource, resolve(outputDirectory, "drizzle"), {
          recursive: true,
        });
      }

      // Create the _worker.js entry point at the root of dist for Cloudflare Pages Advanced Mode.
      // This tells Cloudflare Pages to route incoming requests to our server worker.
      await writeFile(
        resolve(root, "dist", "_worker.js"),
        'import worker from "./server/index.js";\nexport default worker;\n'
      );

      // Delete the generated wrangler.json inside dist/server/ to prevent Cloudflare Pages
      // build configuration validation errors (Pages does not support "main", "rules", or "assets" fields).
      const serverWranglerJson = resolve(root, "dist", "server", "wrangler.json");
      await rm(serverWranglerJson, { force: true });
    },
  };
}


