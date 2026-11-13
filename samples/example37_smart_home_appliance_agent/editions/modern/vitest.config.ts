/** Pure scene math tests never call Azure. */
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["tests/*.test.ts"] } });
