// Copyright (c) Microsoft. All rights reserved.
import { test as base, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createBlankDefinition } from "../../static/handoff/handoff-core.mjs";

const config = JSON.parse(await readFile(new URL("../../templates.config.json", import.meta.url), "utf8"));
const templates = config.templates.filter((template) => template.enabled !== false);
const reply = "Fixture response from the simulated Foundry service.";
const test = base.extend({
  browserErrors: [async ({ page }, use) => {
    const errors = [];
    const voicePrechecks = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/voices/resolve") voicePrechecks.push(request.url());
    });
    await use(errors);
    expect(errors).toEqual([]);
    expect(voicePrechecks, "Publishing and connecting must not prevalidate regional voice availability").toEqual([]);
  }, { auto: true }],
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("voice-agent-playground-welcome-v1", "dismissed"));
  await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1"
    ? route.continue() : route.abort());
});

async function configureMode(page, playground) {
  await page.route("**/config", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: {
      ...await response.json(),
      playground,
      ...(playground ? { realtimeTranscriptionModels: ["azure-speech"], defaultStore: false } : {}),
    } });
  });
}

async function publishWorkingCopy(page) {
  const publication = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/versions"));
  await page.getByRole("button", { name: "Try it now", exact: true }).click();
  await page.getByRole("button", { name: "Publish and try it", exact: true }).click();
  const response = await publication;
  expect(response.ok(), await response.text()).toBe(true);
  const body = response.request().postDataJSON();
  expect(body.draft).toBe(false);
  expect(body.definition.model_type).toBe("managed");
  if (body.definition.handoff) {
    expect(body.definition.handoff.edges.length).toBeGreaterThan(0);
    expect(body.definition.handoff.edges.length).toBeLessThanOrEqual(128);
  }
  await expect(page).toHaveURL(/\/runtime\/\?agent=[^&]+&view=handoff$/);
  const name = new URL(page.url()).searchParams.get("agent");
  const readback = await page.request.get(`/agents/${encodeURIComponent(name)}?api-version=v1`);
  expect(readback.ok()).toBe(true);
  expect((await readback.json()).versions.latest.definition).toEqual(body.definition);
  return { name, definition: body.definition };
}

async function expectConversation(page, { start = true } = {}) {
  if (start) {
    await page.getByRole("button", { name: "Connect & start session", exact: true }).click();
  }
  await expect(page.locator(".connection-status")).toContainText("listening");
  await page.getByRole("textbox", { name: "Message your agent", exact: true }).fill("Hello");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(reply, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop session", exact: true }).click();
  await expect(page.getByRole("button", { name: "Connect & start session", exact: true })).toBeEnabled();
}

test("Editor submits the exact selected voice even when all voice metadata requests fail", async ({ page }) => {
  await configureMode(page, false);
  await page.route("**/api/voices*", (route) => route.abort("failed"));
  await page.goto("/editor/");
  await page.getByRole("button", { name: "Create blank", exact: true }).click();
  await page.locator("#view-agent-yaml").click();
  await page.getByRole("tab", { name: "JSON", exact: true }).click();
  const original = JSON.parse(await page.locator("#definition-output").innerText());
  await page.getByRole("button", { name: "Close definition drawer", exact: true }).click();
  const published = await publishWorkingCopy(page);
  expect(published.definition.audio.output.voice).toEqual(original.audio.output.voice);
  expect(published.definition.handoff.nodes.map((node) => node.config.voice))
    .toEqual(original.handoff.nodes.map((node) => node.config.voice));
});

test("Editor displays a real service voice rejection instead of succeeding locally", async ({ page }) => {
  await configureMode(page, false);
  await page.route("**/api/voices*", (route) => route.abort("failed"));
  await page.route("**/agents/*/versions?*", (route) => route.fulfill({
    status: 400, json: { error: { message: "Selected voice is unavailable in this Project." } },
  }));
  await page.goto("/editor/");
  await page.getByRole("button", { name: "Create blank", exact: true }).click();
  await page.getByRole("button", { name: "Try it now", exact: true }).click();
  await page.getByRole("button", { name: "Publish and try it", exact: true }).click();
  await expect(page.locator('[data-publish-step="publish"]')).toHaveAttribute("data-status", "failed");
  await expect(page.locator("#publish-progress-error")).toContainText("Selected voice is unavailable in this Project.");
  await expect(page).toHaveURL(/\/editor\/$/);
  await expect(page.locator("#dirty-badge")).toHaveText("Unsaved");
});

for (const rejected of [false, true]) {
  test(`local validation is advisory and Foundry ${rejected ? "rejects" : "accepts"} the submission`, async ({ page }) => {
    const name = `advisory-${rejected ? "rejected" : "accepted"}`;
    const initial = await page.request.post(`/agents/${name}/versions?api-version=v1`, {
      data: { definition: createBlankDefinition(), draft: false },
    });
    expect(initial.ok()).toBe(true);
    await page.route(`**/agents/${name}?*`, async (route) => {
      const response = await route.fetch();
      const resource = await response.json();
      const definition = resource.versions.latest.definition;
      if (rejected) definition.handoff.edges = [];
      else definition.handoff.edges[0].target = "missing-node";
      await route.fulfill({ response, json: resource });
    }, { times: 1 });
    await page.goto(`/editor/?agent=${name}`, { waitUntil: "networkidle" });
    await page.locator("#node-outline button").first().click();
    await page.locator("#node-editor-instructions").fill("Submit despite advisory local errors.");
    await page.getByRole("button", { name: "Save node", exact: true }).click();
    await expect(page.locator("#valid-badge")).toContainText("error");
    const tryNow = page.getByRole("button", { name: "Try it now", exact: true });
    await expect(tryNow).toBeEnabled();
    const publication = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/versions"));
    await tryNow.click();
    expect((await publication).status()).toBe(rejected ? 400 : 200);
    if (rejected) {
      await expect(page.locator("#publish-progress-error")).toContainText("between 1 and 128 edges");
      await expect(page.locator("#dirty-badge")).toHaveText("Unsaved");
    } else {
      await expect(page).toHaveURL(/\/runtime\/\?agent=advisory-accepted&view=handoff$/);
    }
  });
}

test("a readback failure reports a successful publication separately", async ({ page }) => {
  await page.route("**/agents/*/versions/*?*", (route) =>
    route.fulfill({ status: 503, json: { error: "Readback unavailable" } }));
  await page.goto("/editor/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Create blank", exact: true }).click();
  const publication = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/versions"));
  await page.getByRole("button", { name: "Try it now", exact: true }).click();
  await page.getByRole("button", { name: "Publish and try it", exact: true }).click();
  expect((await publication).ok()).toBe(true);
  await expect(page.locator("#publish-progress-summary")).toHaveText("The version was published, but verification failed.");
  await expect(page.locator("#publish-progress-error")).toContainText("Readback unavailable");
  await expect(page.locator('[data-publish-step="publish"]')).toHaveAttribute("data-status", "complete");
});

for (const playground of [false, true]) {
  const mode = playground ? "playground" : "local";

  test(`default blank -> publish -> reply -> reopen without republishing (${mode})`, async ({ page }) => {
    await configureMode(page, playground);
    const publications = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/versions")) {
        publications.push(request.url());
      }
    });
    await page.goto("/editor/", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Create blank", exact: true }).click();
    const published = await publishWorkingCopy(page);
    if (playground) expect(published.definition.store).toBe(false);
    await expectConversation(page);
    await page.goto("/editor/", { waitUntil: "networkidle" });
    await page.getByRole("option", { name: published.name, exact: true }).click();
    await expect(page.locator("#agent-title")).toHaveText(published.name);
    await expect(page.locator("#dirty-badge")).toHaveText("Clean");
    await page.getByRole("button", { name: "Try it now", exact: true }).click();
    await expect(page).toHaveURL(/\/runtime\/\?agent=[^&]+&view=handoff$/);
    await expectConversation(page, { start: false });
    expect(publications).toHaveLength(1);
  });

  test(`default blank JSON export -> import -> publish without saving settings (${mode})`, async ({ page }) => {
    await configureMode(page, playground);
    await page.goto("/editor/", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Create blank", exact: true }).click();
    await page.locator("#view-agent-yaml").click();
    await page.getByRole("tab", { name: "JSON", exact: true }).click();
    const json = await page.locator("#definition-output").innerText();
    const exported = JSON.parse(json);
    await page.getByRole("button", { name: "Import from agent", exact: true }).click();
    await page.locator("#agent-import-file").setInputFiles({
      name: "exported-agent.json", mimeType: "application/json", buffer: Buffer.from(json),
    });
    await expect(page.locator("#agent-import-status")).toContainText("Local validation passed");
    await page.getByRole("checkbox", {
      name: "Replace my current working copy, including unsaved edits.", exact: true,
    }).check();
    await page.getByRole("button", { name: "Import working copy", exact: true }).click();
    const published = await publishWorkingCopy(page);
    expect(published.definition).toEqual(exported);
    await expectConversation(page);
  });

  test(`flat Agent JSON import publishes without an empty handoff graph (${mode})`, async ({ page }) => {
    await configureMode(page, playground);
    const definition = {
      kind: "voice",
      model_type: "managed",
      model: "gpt-realtime",
      instructions: "Greet the caller and answer briefly.",
      store: false,
      audio: {
        input: { transcription: { model: "azure-speech" } },
        output: { voice: "en-US-AvaNeural", voice_type: "azure-standard" },
      },
    };
    await page.goto("/editor/", { waitUntil: "networkidle" });
    await page.locator("#view-agent-yaml").click();
    await page.getByRole("button", { name: "Import from agent", exact: true }).click();
    await page.locator("#agent-import-file").setInputFiles({
      name: "flat-agent.json", mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(definition)),
    });
    await expect(page.locator("#agent-import-status")).toContainText("Local validation passed");
    await page.getByRole("button", { name: "Import working copy", exact: true }).click();
    const published = await publishWorkingCopy(page);
    expect(published.definition).toEqual(definition);
    expect(published.definition).not.toHaveProperty("handoff");
    await expectConversation(page);
  });

  for (const failure of ["permission denied", "network failure"]) {
    test(`default blank still publishes and replies when voice discovery has ${failure} (${mode})`, async ({ page }) => {
      await configureMode(page, playground);
      await page.route("**/api/voices*", (route) => failure === "permission denied"
        ? route.fulfill({ status: 403, json: { error: "Synthetic voice discovery permission denied" } })
        : route.abort("failed"));
      await page.goto("/editor/", { waitUntil: "networkidle" });
      await expect(page.locator("#voice-catalog-status")).not.toBeEmpty();
      await page.getByRole("button", { name: "Create blank", exact: true }).click();
      const published = await publishWorkingCopy(page);
      expect(published.definition.audio.output.voice).toBeTruthy();
      await expectConversation(page);
    });
  }

  test(`default publication failure is visible, preserves edits and can be retried (${mode})`, async ({ page }) => {
    await configureMode(page, playground);
    await page.goto("/editor/", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Create blank", exact: true }).click();
    const name = await page.locator("#agent-title").innerText();
    await page.route("**/agents/*/versions?*", (route) => {
      const body = route.request().postDataJSON();
      body.definition.handoff = { nodes: [], edges: [] };
      return route.continue({ postData: JSON.stringify(body) });
    }, { times: 1 });
    const failed = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/versions"));
    await page.getByRole("button", { name: "Try it now", exact: true }).click();
    await page.getByRole("button", { name: "Publish and try it", exact: true }).click();
    expect((await failed).status()).toBe(400);
    const progress = page.getByRole("dialog", { name: "Try it now", exact: true });
    await expect(progress.getByRole("alert")).toContainText("between 1 and 128 edges");
    await expect(page).toHaveURL(/\/editor\/$/);
    await expect(page.locator("#agent-title")).toHaveText(name);
    await expect(page.locator("#dirty-badge")).toHaveText("Unsaved");
    await progress.getByRole("button", { name: "Close", exact: true }).click();
    const published = await publishWorkingCopy(page);
    expect(published.definition.handoff.edges.length).toBeGreaterThan(0);
    await expectConversation(page);
  });
}

for (const template of templates) {
  test(`untouched default template publishes and replies: ${template.id}`, async ({ page }) => {
    await page.goto("/editor/", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load from templates", exact: true }).click();
    const card = page.locator(`[data-template-id="${template.id}"]`);
    const group = card.locator("xpath=ancestor::details[1]");
    if (!await group.evaluate((element) => element.open)) {
      await group.locator(":scope > summary").click();
    }
    const loaded = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === `/api/templates/${template.id}` && url.searchParams.get("version") === ".";
    });
    await card.click();
    const detailResponse = await loaded;
    expect(detailResponse.ok()).toBe(true);
    const detail = await detailResponse.json();
    await expect(page.locator("#template-picker")).toBeHidden();
    const published = await publishWorkingCopy(page);
    expect(published.definition).toEqual(detail.definition);
    await expectConversation(page);
  });
}
