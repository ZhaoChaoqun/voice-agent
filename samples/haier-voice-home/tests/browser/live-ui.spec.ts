/** Opt-in real Foundry + local UI checks, with no mocked replies or appliance state. */
import { expect, test, type Page } from "@playwright/test";

import { installSilentSink } from "./audio-helper";

const LIVE_TIMEOUT_MS = 180_000; // Bound actual managed model/tool/voice turn latency.
const TURN_TIMEOUT_MS = 75_000; // Allow managed model startup and a tool continuation.

test.skip(
  !process.env.HAIER_LIVE_BROWSER,
  "Explicit opt-in required; uses the real configured Azure service.",
);
test.describe.configure({ mode: "serial" });

async function say(page: Page, value: string): Promise<void> {
  await page.locator("#message").fill(value);
  const send = page.getByRole("button", { name: "发送消息", exact: true });
  await expect(send).toBeEnabled({ timeout: TURN_TIMEOUT_MS });
  await send.click();
}

for (const model of ["gpt-realtime-2.1", "gpt-realtime-2.1-mini"]) {
  test(`real ${model}: Chinese control, English product grounding, and spoken output`, async ({
    page,
  }) => {
    test.setTimeout(LIVE_TIMEOUT_MS);
    const audio = { chunks: 0 };
    const errors: string[] = [];
    await page.routeWebSocket("**/api/voice?**", (browser) => {
      const upstream = browser.connectToServer();
      upstream.onMessage((raw) => {
        const event = JSON.parse(String(raw));
        if (
          event.type === "response.audio.delta" ||
          event.type === "response.output_audio.delta"
        )
          audio.chunks += 1;
        if (event.type === "demo.error" || event.type === "error")
          errors.push(JSON.stringify(event));
        browser.send(raw);
      });
      browser.onMessage((raw) => upstream.send(raw));
    });
    await page.goto("/");
    await page.evaluate(async () => {
      const response = await fetch("/api/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok)
        throw new Error("Could not reset the simulated test household");
    });
    await page.reload();
    await installSilentSink(page);
    await page.locator("#voice-model").selectOption(model);
    await say(page, "请打开空调，把温度调到二十五度。");
    await expect(
      page.locator(".device-card-main").filter({ hasText: "舒适风空调" }),
    ).toContainText("25°C", { timeout: TURN_TIMEOUT_MS });
    await expect(
      page.getByRole("switch", { name: "舒适风空调 · 关闭", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(() => audio.chunks, { timeout: TURN_TIMEOUT_MS })
      .toBeGreaterThan(0);
    await expect(page.locator(".message-assistant").last()).toContainText(
      /25|二十五/,
      { timeout: TURN_TIMEOUT_MS },
    );
    await say(
      page,
      "Please answer in English. What is the exact refrigerator model, and what is its variable-temperature zone for?",
    );
    await expect(page.locator(".message-assistant").last()).toContainText(
      "BCD-480WGHTDEDXMU1",
      { timeout: TURN_TIMEOUT_MS },
    );
    await expect(page.locator(".conversation-sources")).toContainText(
      "BCD-480WGHTDEDXMU1",
      { timeout: TURN_TIMEOUT_MS },
    );
    await expect(page.locator(".message-assistant").last()).toContainText(
      /humidity|fresh|vegetable/i,
    );
    expect(errors).toEqual([]);
    await page.screenshot({
      path: `test-results/live-${model}-${test.info().project.name}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "结束对话", exact: true }).click();
  });
}
