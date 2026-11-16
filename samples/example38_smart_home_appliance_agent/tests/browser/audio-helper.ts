/** Headless-only audio isolation; production playback keeps the user's speakers. */
import type { Page } from "@playwright/test";
import type { DemoConfig } from "../../shared/protocol";

/** Advertise a mock voice boundary without enabling or calling a real service. */
export async function installMockVoiceConfig(page: Page): Promise<void> {
  await page.route("**/api/config", async (route) => {
    const response = await route.fetch();
    const config: DemoConfig = await response.json();
    config.models = config.models.map((model) => ({
      ...model,
      available: model.id === "microsoft-realtime-flash-1",
    }));
    config.backend = {
      configured: true,
      mode: "explicitly-mocked-test",
      message: "Voice transport is mocked; no Azure service is called.",
    };
    await route.fulfill({ json: config });
  });
  await page.reload();
}

/** Advance a real Web Audio graph without touching the workstation's audio output. */
export async function installSilentSink(page: Page): Promise<void> {
  await page.evaluate(() => {
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(options?: AudioContextOptions) {
        const testOptions = { ...options, sinkId: { type: "none" } };
        super(testOptions);
        (
          window as Window & { demoTestContext?: AudioContext }
        ).demoTestContext = this;
      }
    };
  });
}
