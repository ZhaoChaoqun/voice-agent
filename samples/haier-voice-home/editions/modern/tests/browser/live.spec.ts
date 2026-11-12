/** Opt-in acceptance: browser -> modern or Habitat proxy -> backend -> Foundry. */
import { expect, test } from "@playwright/test";

test.skip(
  !process.env.HAIER_LIVE_BROWSER,
  "Opt-in real service usage; no fake replies or state.",
);
test.describe.configure({ mode: "serial" });
const TURN_TIMEOUT_MS = 75_000; // Bound managed model startup plus local tool continuation.

for (const model of ["gpt-realtime-2.1", "gpt-realtime-2.1-mini"]) {
  test(`real ${model}: Chinese control and English source-grounded follow-up`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    let audioChunks = 0;
    const errors: string[] = [];
    await page.routeWebSocket("**/api/voice?**", (browser) => {
      const backend = browser.connectToServer();
      backend.onMessage((raw) => {
        const event = JSON.parse(String(raw));
        if (
          event.type === "response.audio.delta" ||
          event.type === "response.output_audio.delta"
        )
          audioChunks += 1;
        if (event.type === "error" || event.type === "demo.error")
          errors.push(JSON.stringify(event));
        browser.send(raw);
      });
      browser.onMessage((raw) => backend.send(raw));
    });
    await page.goto("/");
    await page.evaluate(async () => {
      const response = await fetch("/api/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error("Cannot reset test household");
    });
    await page.reload();
    await page.evaluate(() => {
      const Native = window.AudioContext;
      window.AudioContext = class extends Native {
        constructor(options?: AudioContextOptions) {
          const silent = { ...options, sinkId: { type: "none" } };
          super(silent);
        }
      };
    });
    await page.locator("#atelier-model").selectOption(model);
    await page
      .locator("#atelier-message")
      .fill("请打开空调，把温度调到二十五度。");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect(
      page.locator(".device-row").filter({ hasText: "舒适风空调" }),
    ).toContainText("25°C", { timeout: TURN_TIMEOUT_MS });
    await expect
      .poll(() => audioChunks, { timeout: TURN_TIMEOUT_MS })
      .toBeGreaterThan(0);
    await expect(page.locator(".chat-message.assistant").last()).toContainText(
      /25|二十五/,
      { timeout: TURN_TIMEOUT_MS },
    );
    await page
      .locator("#atelier-message")
      .fill(
        "Please answer in English. What is the refrigerator model and what is the variable-temperature zone for?",
      );
    const send = page.getByRole("button", { name: "发送消息", exact: true });
    await expect(send).toBeEnabled({ timeout: TURN_TIMEOUT_MS });
    await send.click();
    await expect(page.locator(".chat-message.assistant").last()).toContainText(
      "BCD-480WGHTDEDXMU1",
      { timeout: TURN_TIMEOUT_MS },
    );
    await expect(page.locator(".chat-message.assistant").last()).toContainText(
      /humidity|vegetable|fresh/i,
      { timeout: TURN_TIMEOUT_MS },
    );
    await expect(
      page
        .locator(".citation")
        .filter({ hasText: "BCD-480WGHTDEDXMU1" })
        .first(),
    ).toBeVisible({ timeout: TURN_TIMEOUT_MS });
    expect(errors).toEqual([]);
    await page
      .getByRole("button", { name: "结束对话", exact: true })
      .last()
      .click();
  });
}
