// Copyright (c) Microsoft. All rights reserved.
import { test, expect } from "@playwright/test";
import { expandTemplateGroup } from "./template-picker-helpers.mjs";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("voice-agent-playground-welcome-v1", "dismissed"));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" ? route.continue() : route.abort();
  });
  await page.goto("/editor/");
  await page.getByRole("button", { name: "Load from templates", exact: true }).click();
});

for (const width of [1440, 390, 320]) {
  test(`Template accordion defaults to all groups expanded and keeps controls on the left at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const grouping = page.getByRole("group", { name: "Group templates", exact: true });
    await expect(grouping.getByRole("button")).toHaveText(["By locale", "By domain"]);
    await expect(grouping.getByRole("button", { name: "By locale", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#template-locale-filters")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /All locales/ })).toHaveCount(0);
    const hindi = page.locator('details[data-locale-group="hi-IN"]');
    const english = page.locator('details[data-locale-group="en-*"]');
    await expect(hindi).toHaveJSProperty("open", true);
    await expect(english).toHaveJSProperty("open", true);
    await expect(page.locator(".template-choice:visible")).toHaveCount(37);
    await expect(hindi.locator(".template-choice-locale")).toHaveText(["hi-IN", "hi-IN"]);
    const summary = hindi.locator(":scope > summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(hindi).toHaveJSProperty("open", false);
    await expect(page.locator(".template-choice:visible")).toHaveCount(35);
    await page.keyboard.press("Space");
    await expect(hindi).toHaveJSProperty("open", true);
    await english.locator(":scope > summary").click();
    await expect(english).toHaveJSProperty("open", false);
    await expect(page.locator(".template-choice:visible")).toHaveCount(2);
    await english.locator(":scope > summary").click();
    await expect(english).toHaveJSProperty("open", true);
    await expect(hindi).toHaveJSProperty("open", true);
    await expect(page.locator(".template-choice:visible")).toHaveCount(37);
    const bounds = await grouping.boundingBox();
    const shell = page.locator("#template-picker .template-picker-shell");
    const shellBounds = await shell.boundingBox();
    expect(bounds.x - shellBounds.x).toBeLessThan(32);
    expect(await shell.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
}

test("Template accordion search opens matching categories and clearing it restores the prior state", async ({ page }) => {
  await page.locator('details[data-locale-group="en-*"] > summary').click();
  const search = page.getByRole("searchbox", { name: "Search templates" });
  for (const [query, count] of [["Hindi", 2], ["hi-*", 2], ["English", 35], ["en-*", 35], ["en-IN", 2], ["en-US", 33]]) {
    await search.fill(query);
    await expect(page.locator(".template-choice:visible")).toHaveCount(count);
  }
  await search.fill("finance handoff");
  await expect(page.locator("details[open]")).toHaveCount(2);
  await expect(page.locator(".template-choice:visible")).toHaveCount(4);
  await search.fill("no-such-template");
  await expect(page.locator(".template-choice")).toHaveCount(0);
  await expect(page.locator(".template-picker-empty")).toContainText("No templates match");
  await search.clear();
  await expect(page.locator('details[data-locale-group="hi-IN"]')).toHaveJSProperty("open", true);
  await expect(page.locator('details[data-locale-group="en-*"]')).toHaveJSProperty("open", false);
});

test("Template accordion remembers independent expansion choices for locale and domain modes", async ({ page }) => {
  const grouping = page.getByRole("group", { name: "Group templates", exact: true });
  const hindi = page.locator('details[data-locale-group="hi-IN"]');
  await hindi.locator(":scope > summary").click();
  await expandTemplateGroup(page.locator('details[data-locale-group="en-*"]'));
  await grouping.getByRole("button", { name: "By domain", exact: true }).click();
  const domainCount = await page.locator("details[data-domain-group]").count();
  await expect(page.locator("details[data-domain-group][open]")).toHaveCount(domainCount);
  await expect(page.locator("[data-domain-group] h3").nth(0)).toHaveText("Customer support");
  await expect(page.locator("[data-domain-group] h3").nth(1)).toHaveText("Financial services");
  const remaining = (await page.locator("[data-domain-group] h3").allTextContents()).slice(2);
  expect(remaining).toEqual([...remaining].sort((left, right) => left.localeCompare(right)));
  await expect(page.locator(".template-choice:visible")).toHaveCount(37);
  const finance = page.locator('details[data-domain-group="Financial services"]');
  await expect(finance.locator(".template-choice")).toHaveCount(5);
  await finance.locator(":scope > summary").click();
  await expect(finance).toHaveJSProperty("open", false);
  await expect(page.locator('details[data-domain-group="Customer support"]')).toHaveJSProperty("open", true);
  await expect(page.locator("details[data-domain-group][open]")).toHaveCount(domainCount - 1);
  await grouping.getByRole("button", { name: "By locale", exact: true }).click();
  await expect(hindi).toHaveJSProperty("open", false);
  await expect(page.locator('details[data-locale-group="en-*"]')).toHaveJSProperty("open", true);
  await grouping.getByRole("button", { name: "By domain", exact: true }).click();
  await expect(finance).toHaveJSProperty("open", false);
  await expect(page.locator("details[data-domain-group][open]")).toHaveCount(domainCount - 1);
});

for (const [id, locale] of [
  ["finance-example-realtime-hi-in", "hi-IN"],
  ["finance-example-cascade-hi-in", "hi-IN"],
  ["finance-example-realtime", "en-IN"],
]) {
  test(`Template accordion loads ${id} with its original language settings`, async ({ page }) => {
    const detail = await (await page.request.get(`/api/templates/${id}`)).json();
    const group = page.locator(`details[data-locale-group="${locale === "hi-IN" ? "hi-IN" : "en-*"}"]`);
    await expandTemplateGroup(group);
    await page.locator(`[data-template-id="${id}"]`).click();
    await expect(page.locator("#template-picker")).toBeHidden();
    await page.locator("#view-agent-yaml").click();
    await page.getByRole("tab", { name: "JSON", exact: true }).click();
    const definition = JSON.parse(await page.locator("#definition-output").innerText());
    expect(definition.instructions).toBe(detail.definition.instructions);
    expect(definition.handoff).toEqual(detail.definition.handoff);
    expect(definition.audio.input.transcription).toEqual(detail.definition.audio.input.transcription);
    const voiceName = (voice) => typeof voice === "string" ? voice : voice.name;
    expect(voiceName(definition.audio.output.voice)).toBe(voiceName(detail.definition.audio.output.voice));
  });
}

test("Template accordion preserves selected versions but reopens in the default locale view", async ({ page }) => {
  const catalog = await (await page.request.get("/api/templates")).json();
  const template = catalog.templates.find((item) => item.id === "finance-example-realtime-hi-in");
  template.versions.push({ id: "backups/accordion-test", name: "Accordion regression" });
  await page.route("**/api/templates?reload=1", (route) => route.fulfill({ json: catalog }));
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  const version = page.getByRole("combobox", { name: `Version for ${template.name}`, exact: true });
  await version.selectOption("backups/accordion-test");
  const grouping = page.getByRole("group", { name: "Group templates", exact: true });
  await grouping.getByRole("button", { name: "By domain", exact: true }).click();
  await expandTemplateGroup(page.locator('details[data-domain-group="Financial services"]'));
  await expect(version).toHaveValue("backups/accordion-test");
  await page.getByRole("searchbox", { name: "Search templates" }).fill("Hindi");
  await page.getByRole("button", { name: "Close template picker", exact: true }).click();
  await page.getByRole("button", { name: "Load from templates", exact: true }).click();
  await expect(grouping.getByRole("button", { name: "By locale", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("searchbox", { name: "Search templates" })).toHaveValue("");
  await expect(page.locator('details[data-locale-group="hi-IN"]')).toHaveJSProperty("open", true);
  await expect(page.locator('details[data-locale-group="en-*"]')).toHaveJSProperty("open", true);
  await expect(version).toHaveValue("backups/accordion-test");
});

test("Template accordion shows missing metadata as a separate collapsible category", async ({ page }) => {
  const catalog = await (await page.request.get("/api/templates")).json();
  catalog.templates[0].target_locale = "";
  await page.route("**/api/templates?reload=1", (route) => route.fulfill({ json: catalog }));
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  const unknown = page.locator('details[data-locale-group="unspecified"]');
  await expect(unknown).toHaveJSProperty("open", true);
  await expect(unknown.locator("h3")).toHaveText("Locale not specified");
  await expandTemplateGroup(unknown);
  await expect(unknown.locator(".template-choice-locale")).toHaveText("Not specified");
});

test("Template accordion reload removes missing categories without hiding the remaining templates", async ({ page }) => {
  const catalog = await (await page.request.get("/api/templates")).json();
  catalog.templates = catalog.templates.filter((template) => template.target_locale !== "hi-IN");
  await page.route("**/api/templates?reload=1", (route) => route.fulfill({ json: catalog }));
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(page.locator("details[data-locale-group]")).toHaveCount(1);
  const english = page.locator('details[data-locale-group="en-*"]');
  await expandTemplateGroup(english);
  await expect(page.locator(".template-choice:visible")).toHaveCount(35);
});
