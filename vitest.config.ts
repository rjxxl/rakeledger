import { defineConfig } from "vitest/config";
import path from "node:path";
import { config as loadDotenv } from "dotenv";

// Load test-specific env BEFORE Vitest spawns workers
loadDotenv({ path: ".env.test" });

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    globals: true,
    fileParallelism: false,
    server: {
      // Inline next-auth so Vite's resolver (and our alias for "next/server")
      // applies to its internal imports. Otherwise next-auth runs as raw Node
      // ESM where Next 16's missing `exports` field breaks `import "next/server"`.
      deps: {
        inline: ["next-auth", "@auth/core"],
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // next-auth's internals (e.g. lib/env.js) import from "next/server" without
      // the `.js` extension. Next 16 doesn't ship an `exports` field, so under
      // Vitest's strict ESM resolver this fails. Map it to the actual file.
      "next/server": path.resolve(__dirname, "node_modules/next/server.js"),
    },
  },
});
