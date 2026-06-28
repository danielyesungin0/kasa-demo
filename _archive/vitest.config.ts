import { defineConfig } from "vitest/config";

/**
 * Vitest config for the developer-only QA suite.
 *
 * - resolve.tsconfigPaths resolves the "@/..." alias the app uses (native in
 *   Vite/Vitest 4+, no plugin needed).
 * - Only qa/**\/*.test.ts are picked up, so app code is never treated as tests.
 * - Node environment (we test pure logic + decision functions, no DOM).
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["qa/**/*.test.ts"],
    environment: "node",
    globals: true,
  },
});
