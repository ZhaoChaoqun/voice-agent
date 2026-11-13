/** Reuse modern's opt-in managed-model scenarios against Habitat's exact origin. */
import { defineConfig } from "@playwright/test";

import base from "./playwright.config";

export default defineConfig({
  ...base,
  testDir: "../modern/tests/browser",
  testMatch: "live.spec.ts",
});
