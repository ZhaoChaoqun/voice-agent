/** Keep mocked unit tests separate from Playwright and opt-in live validation. */
import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
