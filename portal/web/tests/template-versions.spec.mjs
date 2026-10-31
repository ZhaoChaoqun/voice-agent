// Copyright (c) Microsoft. All rights reserved.
import { test, expect } from "@playwright/test";
import { openTemplatePicker } from "./template-picker-helpers.mjs";

const templateId = "customer-support-example";
const version = "backups/20261020/original";
const instructions = "Browser regression: selected backup version.";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("voice-agent-playground-welcome-v1", "dismissed"));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" ? route.continue() : route.abort();
  });
});

async function installVersions(page) {
  const catalog = await (await page.request.get("/api/templates")).json();
  const detail = await (await page.request.get(`/api/templates/${templateId}`)).json();
  const versions = [
    { id: ".", name: "Default (agent.json)" },
    { id: version, name: version },
  ];
  catalog.templates.find((item) => item.id === templateId).versions = versions;
  await page.route("**/api/templates", (route) => route.fulfill({ json: catalog }));
  await page.route(`**/api/templates/${templateId}/mcp/probe?*`, (route) => route.fulfill({
    json: { ok: true, tools: ["mock_tool_call"] },
  }));
  await page.route(`**/api/templates/${templateId}?*`, async (route) => {
    const selected = new URL(route.request().url()).searchParams.get("version") || ".";
    const result = structuredClone(detail);
    result.versions = versions;
    result.version = selected;
    if (selected === version) {
      result.definition.instructions = instructions;
      result.yaml = JSON.stringify({ definition: result.definition });
    }
    await route.fulfill({ json: result });
  });
  return detail;
}

for (const width of [1440, 390]) {
  test(`Template versions load the selected backup into Editor at ${width}px`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    const detail = await installVersions(page);
    await page.goto("/editor/");
    await openTemplatePicker(page);
    const select = page.getByRole("combobox", { name: `Version for ${detail.name}`, exact: true });
    await expect(select).toHaveValue(".");
    await select.selectOption(version);
    const loaded = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === `/api/templates/${templateId}` && url.searchParams.get("version") === version;
    });
    await page.locator(`[data-template-id="${templateId}"]`).click();
    await loaded;
    await expect(page.locator("#template-picker")).toBeHidden();
    await page.locator("#view-agent-yaml").click();
    await expect(page.locator("#definition-output")).toContainText(instructions);
    await page.getByRole("button", { name: "Close definition drawer", exact: true }).click();
    await openTemplatePicker(page);
    await expect(select).toHaveValue(version);
    await select.selectOption(".");
    await page.locator(`[data-template-id="${templateId}"]`).click();
    await page.locator("#view-agent-yaml").click();
    await expect(page.locator("#definition-output")).not.toContainText(instructions);
    expect(errors).toEqual([]);
  });
}

test("Template versions preview and publish the same selected backup", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installVersions(page);
  await page.goto("/templates/");
  await page.locator(`[data-template-id="${templateId}"]`).click();
  await page.getByLabel("Version", { exact: true }).selectOption(version);
  await page.getByRole("button", { name: "definition.json", exact: true }).click();
  await expect(page.locator("#yaml-body")).toContainText(instructions);
  let publishedVersion;
  await page.route(`**/api/templates/${templateId}/publish?*`, async (route) => {
    publishedVersion = new URL(route.request().url()).searchParams.get("version");
    await route.fulfill({
      status: 201,
      json: { agent_name: "local-only-backup", version: "1", backend: "fixture" },
    });
  });
  await page.getByRole("button", { name: /Publish my Agent from this template/ }).click();
  await expect(page.locator("#tpl-result")).toContainText("local-only-backup");
  expect(publishedVersion).toBe(version);
  expect(errors).toEqual([]);
});

test("Template versions retain the source version when Editor publishes a working copy", async ({ page }) => {
  const detail = await installVersions(page);
  let configuredVersion;
  await page.route(`**/api/templates/${templateId}/mcp/configure?*`, async (route) => {
    configuredVersion = new URL(route.request().url()).searchParams.get("version");
    await route.fulfill({ json: { configured: true } });
  });
  await page.goto("/editor/");
  await openTemplatePicker(page);
  await page.getByRole("combobox", { name: `Version for ${detail.name}`, exact: true }).selectOption(version);
  await page.locator(`[data-template-id="${templateId}"]`).click();
  await expect(page.locator("#template-picker")).toBeHidden();
  const publication = page.waitForRequest((request) =>
    request.method() === "POST" && new URL(request.url()).pathname.endsWith("/versions"));
  await page.locator("#publish-run-action").click();
  await page.getByRole("button", { name: "Publish and try it", exact: true }).click();
  const body = (await publication).postDataJSON();
  expect(configuredVersion).toBe(version);
  expect(body.metadata.source_template_version).toBe(version);
  expect(body.definition.instructions).toBe(instructions);
  await expect(page).toHaveURL(/agent=local-only-/);
});

test("Template versions match the real catalog and load discovered sample files", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const catalog = await (await page.request.get("/api/templates")).json();
  await page.goto("/editor/");
  await openTemplatePicker(page);
  await expect(page.locator(".template-choice")).toHaveCount(catalog.templates.length);
  for (const template of catalog.templates) {
    const select = page.getByRole("combobox", { name: `Version for ${template.name}`, exact: true });
    expect(await select.locator("option").evaluateAll((options) => options.map((option) => option.value)))
      .toEqual(template.versions.map((item) => item.id));
    if (template.versions.length === 1) {
      await expect(select).toBeDisabled();
    } else {
      await expect(select).toBeEnabled();
    }
  }
  const template = catalog.templates.find((item) => item.versions.length > 1) || catalog.templates[0];
  const selected = template.versions.at(-1).id;
  const detail = await (await page.request.get(
    `/api/templates/${encodeURIComponent(template.id)}?version=${encodeURIComponent(selected)}`,
  )).json();
  if (template.versions.length > 1) {
    await page.getByRole("combobox", { name: `Version for ${template.name}`, exact: true }).selectOption(selected);
  }
  await page.locator(`[data-template-id="${template.id}"]`).click();
  await expect(page.locator("#template-picker")).toBeHidden();
  await page.locator("#view-agent-yaml").click();
  await page.getByRole("tab", { name: "JSON", exact: true }).click();
  const exported = JSON.parse(await page.locator("#definition-output").innerText());
  expect(exported.instructions).toBe(detail.definition.instructions);
  expect(exported.model).toBe(detail.definition.model);
  expect(exported.audio.input.turn_detection).toEqual(detail.definition.audio.input.turn_detection);
  expect(exported.handoff).toEqual(detail.definition.handoff);
  expect(errors).toEqual([]);
});
