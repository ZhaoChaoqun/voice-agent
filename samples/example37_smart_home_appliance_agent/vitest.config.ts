/** Keep mocked unit tests separate from Playwright and opt-in live validation. */
import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";

import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({ test: { include: ["tests/**/*.test.ts"] } }),
);
