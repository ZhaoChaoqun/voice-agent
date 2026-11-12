/** Opt-in real-Agent regression for silent tools and concise device confirmations. */
import { expect, test } from "@playwright/test";

import { installSilentSink } from "./audio-helper";
import { homeGreeting } from "../../server/greeting";

const BASE_URL = process.env.HAIER_LIVE_URL ?? "http://127.0.0.1:5197";
const TURN_TIMEOUT_MS = 90_000; // Include managed-Agent setup and one real tool continuation.
const SECONDARY_MODEL =
  process.env.HAIER_SECONDARY_MODEL_ID ?? "gpt-realtime-2.1-mini";

test.skip(
  process.env.RUN_LIVE_TESTS !== "1",
  "Requires an explicit real Foundry Agent invocation.",
);
test.use({ trace: "off", screenshot: "off" });

for (const model of ["gpt-realtime-2.1", SECONDARY_MODEL]) {
  test(`${model} acknowledges, opens the TV, and gives one short confirmation`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.goto(BASE_URL);
    await expect(page.locator("#atelier-model")).toBeVisible({
      timeout: TURN_TIMEOUT_MS,
    });
    await installSilentSink(page);
    await page.evaluate(async () => {
      const response = await fetch("/api/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error("Household reset failed");
    });
    const events: Record<string, unknown>[] = [];
    await page.routeWebSocket("**/api/voice?**", (browserSocket) => {
      const backend = browserSocket.connectToServer();
      backend.onMessage((raw) => {
        events.push(JSON.parse(String(raw)) as Record<string, unknown>);
        browserSocket.send(raw);
      });
      browserSocket.onMessage((raw) => backend.send(raw));
    });
    await page.locator("#atelier-model").selectOption(model);
    await page.locator("#atelier-message").fill("请帮我打开电视。");
    const start = events.length;
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const config = await (await fetch("/api/config")).json();
            return config.home.devices.find(
              (device: { id: string }) => device.id === "tv",
            ).power;
          }),
        { timeout: TURN_TIMEOUT_MS },
      )
      .toBe(true);
    await expect
      .poll(
        () =>
          events
            .slice(start)
            .filter((event) =>
              [
                "response.audio_transcript.done",
                "response.output_audio_transcript.done",
              ].includes(String(event.type)),
            )
            .filter(
              (event) =>
                String(event.transcript ?? "") !== homeGreeting("zh").text,
            ).length,
        { timeout: TURN_TIMEOUT_MS },
      )
      .toBeGreaterThanOrEqual(2);
    const turn = events.slice(start);
    const successIndex = turn.findIndex(
      (event) =>
        event.type === "demo.tool" &&
        (event.activity as { name?: string; status?: string }).name ===
          "control_device" &&
        (event.activity as { name?: string; status?: string }).status ===
          "success",
    );
    expect(successIndex).toBeGreaterThanOrEqual(0);
    const transcripts = turn
      .map((event, index) => ({ event, index }))
      .filter(({ event }) =>
        [
          "response.audio_transcript.done",
          "response.output_audio_transcript.done",
        ].includes(String(event.type)),
      )
      .map(({ event, index }) => ({
        index,
        text: String(event.transcript ?? ""),
      }))
      .filter(({ text }) => text !== homeGreeting("zh").text);
    const acknowledgements = transcripts.filter(
      (transcript) => transcript.index < successIndex,
    );
    const completions = transcripts.filter(
      (transcript) => transcript.index > successIndex,
    );
    expect(acknowledgements).toHaveLength(1);
    expect(acknowledgements[0].text.length).toBeLessThanOrEqual(16);
    expect(acknowledgements[0].text).not.toMatch(
      /电视|打开|稍等|我先|然后|结果|状态|设置/,
    );
    expect(completions).toHaveLength(1);
    expect(completions[0].text).toMatch(/^电视(打开啦|已打开)/);
    expect(completions[0].text).toMatch(/小城良方|折月亮|尚公主|良陈美锦/);
    expect(completions[0].text).not.toMatch(
      /我先|然后.*结果|切到开机状态|稍等|马上|为你打开/,
    );
    expect(completions[0].text.length).toBeLessThanOrEqual(80);
    await page
      .getByRole("button", { name: "结束对话", exact: true })
      .last()
      .click();
  });
}
