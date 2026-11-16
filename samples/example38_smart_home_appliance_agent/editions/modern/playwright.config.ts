/** Desktop/mobile visual and behavior checks; real-AI acceptance is opt-in. */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env.SMART_HOME_ATELIER_URL ?? "http://127.0.0.1:5180",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: {
      args:
        process.platform === "darwin"
          ? ["--use-angle=metal", "--enable-gpu"]
          : [
              "--use-gl=angle",
              "--use-angle=swiftshader",
              "--enable-unsafe-swiftshader",
            ],
    },
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1512, height: 982 },
      },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
});
