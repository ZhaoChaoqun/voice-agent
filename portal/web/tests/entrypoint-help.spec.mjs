// Copyright (c) Microsoft. All rights reserved.
import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("voice-agent-playground-welcome-v1", "dismissed"));
  await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1"
    ? route.continue() : route.abort());
});

async function openEntrypoint(page) {
  await page.goto("/editor/");
  await page.getByRole("button", { name: "Create blank", exact: true }).click();
  await page.locator("#node-outline button").first().click();
}

async function expectInViewport(page, element) {
  await expect.poll(async () => {
    const box = await element.boundingBox();
    const viewport = page.viewportSize();
    return box && box.x >= 11 && box.y >= 11
      && box.x + box.width <= viewport.width - 11
      && box.y + box.height <= viewport.height - 11;
  }).toBe(true);
  const box = await element.boundingBox();
  const viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(11);
  expect(box.y).toBeGreaterThanOrEqual(11);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 11);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 11);
  expect(await element.evaluate((popup) => {
    const rect = popup.getBoundingClientRect();
    return popup.contains(document.elementFromPoint(rect.right - 8, rect.top + 8));
  })).toBe(true);
}

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 768, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 640 },
]) {
  test(`Input language list and help escape cards and fit ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await openEntrypoint(page);
    const language = page.getByRole("combobox", { name: "Input language", exact: true });
    await language.click();
    const list = page.getByRole("listbox", { name: "Input languages", exact: true });
    const popup = page.locator(".input-language-options:visible");
    await expect(list).toBeVisible();
    expect(await popup.evaluate((element) => element.matches(":popover-open"))).toBe(true);
    await expectInViewport(page, popup);
    await expect(page.getByRole("searchbox", { name: "Search input language locales", exact: true })).toBeVisible();
    if (viewport.width === 1440) {
      const anchor = await language.boundingBox();
      const available = Math.max(anchor.y - 20, viewport.height - anchor.y - anchor.height - 20);
      expect((await popup.boundingBox()).height).toBeGreaterThanOrEqual(Math.min(560, available) - 1);
      await page.screenshot({ path: testInfo.outputPath("language-list.png") });
    }
    await list.getByRole("checkbox", { name: "hi-IN (Hindi (India))", exact: true }).check();
    await list.getByRole("checkbox", { name: "en-IN (English (India))", exact: true }).check();
    await expect(language).toHaveValue("hi-IN, en-IN");
    await language.press("Escape");
    const button = page.getByRole("button", { name: "Explain Input language", exact: true });
    await button.click();
    const help = page.locator("#component-stt-language-help");
    await expect(help).toBeVisible();
    await expect(help).toContainText("every graph node");
    await expect(help).toContainText("first selection is primary");
    await expect(help).toContainText("up to 10");
    await expect(help).toContainText("not the Agent's output voice");
    await expectInViewport(page, help);
    if (viewport.width === 1440) {
      expect((await help.boundingBox()).width).toBe(560);
      await page.screenshot({ path: testInfo.outputPath("input-language-help.png") });
    }
    if (viewport.width === 320) {
      await help.hover();
      await page.mouse.wheel(0, 400);
      await expect.poll(() => help.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    }
    await button.press("Escape");
    await expect(help).toBeHidden();
    await expect(page.locator("#node-editor")).toBeVisible();
    await expect(language).toHaveValue("hi-IN, en-IN");
  });
}

test("all visible node and edge help has detailed, unclipped explanations", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openEntrypoint(page);
  for (const button of await page.locator("#node-editor .field-help-toggle:visible").all()) {
    await button.scrollIntoViewIfNeeded();
    await button.focus();
    const help = page.locator(`#${await button.getAttribute("aria-describedby")}`);
    await expect(help).toBeVisible();
    expect((await help.innerText()).length).toBeGreaterThan(200);
    expect(await help.evaluate((element) => element.matches(":popover-open"))).toBe(true);
    await expectInViewport(page, help);
    await button.press("Escape");
  }
  await page.getByRole("button", { name: "Save node", exact: true }).click();
  await page.getByRole("tab", { name: /^Edges/ }).click();
  await page.locator("#edge-outline .outline-item").first().click();
  const edgeButtons = page.locator("#edge-editor .field-help-toggle");
  await expect(edgeButtons).toHaveCount(5);
  for (const button of await edgeButtons.all()) {
    await button.scrollIntoViewIfNeeded();
    await button.focus();
    const help = page.locator(`#${await button.getAttribute("aria-describedby")}`);
    await expect(help).toBeVisible();
    expect((await help.innerText()).length).toBeGreaterThan(200);
    await expectInViewport(page, help);
    await button.press("Escape");
    await expect(page.locator("#edge-editor")).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("help supports hover, keyboard toggle, scrolling, resize, and editor re-render", async ({ page }) => {
  await openEntrypoint(page);
  const button = page.getByRole("button", { name: "Explain Output modalities", exact: true });
  const help = page.locator("#runtime-definition-output_modalities-help");
  await button.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await button.hover();
  await expect(help).toBeVisible();
  await help.hover();
  await expect(help).toBeVisible();
  await page.getByRole("heading", { name: "Entrypoint / Overall settings", exact: true }).hover();
  await expect(help).toBeHidden();
  await button.focus();
  await expect(help).toBeVisible();
  await button.press("Escape");
  await expect(help).toBeHidden();
  await button.press("Enter");
  await expect(help).toBeVisible();
  await page.getByRole("button", { name: "Explain Model serving", exact: true }).hover();
  await expect(help).toBeVisible();
  await expect(page.locator("#runtime-definition-model_type-help")).toBeHidden();
  await page.locator("#node-editor-body").evaluate((element) => { element.scrollTop += 30; });
  await expectInViewport(page, help);
  await page.setViewportSize({ width: 768, height: 900 });
  await expectInViewport(page, help);
  await button.press("Enter");
  await expect(help).toBeHidden();
  await page.getByRole("combobox", { name: "Greeting mode", exact: true }).selectOption("llm_generated");
  await page.getByRole("button", { name: "Explain Greeting prompt", exact: true }).click();
  await expect(page.locator("#runtime-definition-greeting-prompt-help")).toContainText("wording may vary");
  await page.getByRole("combobox", { name: "Greeting mode", exact: true }).selectOption("template");
  await expect(page.locator("#runtime-definition-greeting-prompt-help")).toHaveCount(0);
  await page.getByRole("button", { name: "Explain Greeting text", exact: true }).click();
  await expect(page.locator("#runtime-definition-greeting-text-help")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#node-editor")).toBeVisible();
});

test("component comparison help uses the same top layer", async ({ page }) => {
  await page.goto("/editor/?debug=1");
  await page.getByRole("button", { name: "Create blank", exact: true }).click();
  await page.locator("#node-outline button").first().click();
  await page.locator('[data-node-component="stt"]').click();
  const button = page.getByRole("button", { name: "Explain Latency", exact: true });
  await button.click();
  const help = page.locator("#component-help-latency");
  await expect(help).toContainText("recordings and runtime traces");
  expect(await help.evaluate((element) => element.matches(":popover-open"))).toBe(true);
  await expectInViewport(page, help);
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
  await expect(page.locator("#node-component-panel")).toBeVisible();
});

test("help closes when its field scrolls out of the panel and can reopen", async ({ page }) => {
  await openEntrypoint(page);
  const button = page.getByRole("button", { name: "Explain Input language", exact: true });
  const help = page.locator("#component-stt-language-help");
  await button.click();
  await expect(help).toBeVisible();
  await page.locator("#node-editor-body").evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(help).toBeHidden();
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await button.scrollIntoViewIfNeeded();
  await button.hover();
  await expect(help).toBeVisible();
  await expectInViewport(page, help);
});
