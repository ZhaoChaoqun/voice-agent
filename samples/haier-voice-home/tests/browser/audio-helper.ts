/** Headless-only audio isolation; production playback keeps the user's speakers. */
import type { Page } from "@playwright/test";

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
