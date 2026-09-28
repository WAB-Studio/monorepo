import { defineConfig, devices } from "@playwright/test";

import { sessionFile } from "./e2e/fixtures";

// Against `next build && next start`, never `next dev`: `tema.spec.ts` reads
// the `<html>` class at the very first commit, before React ever mounts, and
// StrictMode's double effect run in dev is exactly the kind of extra pass
// that would make a flaky read of that moment look like a real flash
// (docs/TRAPS.md "StrictMode doubles a Worker count in `next dev`, and only
// there"). `npm run build` then `PORT=3204 npm run start` first, kept
// running by hand — this file starts no server of its own.
const baseURL = process.env.PULSAR_BASE_URL ?? "http://localhost:3200";

export default defineConfig({
  testDir: "./e2e",
  // Opens the suite's harness run, mints and seeds the lane's person under it,
  // and drops them when the last spec ends.
  globalSetup: "./scripts/harness/e2e-run.ts",
  // Gitignored, so a run leaves the tree clean.
  outputDir: "./private/playwright-results",
  workers: 2,
  // A retry would hide a flake behind a green run, which is what this layer
  // exists to find.
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    // Module 20's storage state: a real, already-verified `/auth/confirm`
    // redemption. No spec opens `/entrar` or types an address (RNP-09).
    storageState: sessionFile(),
  },
  projects: [
    // RNP-07's own case: a phone, held one-handed, standing.
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 360, height: 740 },
        hasTouch: true,
      },
    },
  ],
});
