// Copyright (c) Microsoft. All rights reserved.
import { test, expect } from "@playwright/test";

const welcomeTitle = "Welcome to the Azure Voice Agent Playground";
const foundryUrl = "https://learn.microsoft.com/en-us/azure/foundry/tutorials/quickstart-create-foundry-resources?tabs=portal";
const voiceAgentUrl = "https://learn.microsoft.com/en-us/azure/foundry/agents/quickstarts/prompt-voice-agent?pivots=portal";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1"
    ? route.continue() : route.abort());
});

for (const width of [1440, 768, 390, 320]) {
  test(`Playground welcome is visible before editing and fits ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/editor/");
    const welcome = page.getByRole("dialog", { name: welcomeTitle, exact: true });
    await expect(welcome).toBeVisible();
    expect(await welcome.evaluate((element) => element.matches(":modal"))).toBe(true);
    await expect(welcome).toContainText("limited set of capabilities");
    await expect(welcome).toContainText("full development experience");
    await expect(welcome).toContainText("Do not enter sensitive or confidential information.");
    await expect(welcome.getByRole("link")).toHaveText(["Set up Microsoft Foundry", "Voice Agent quickstart"]);
    await expect(welcome).toContainText("to create and test your first voice agent.");
    for (const [name, url] of [
      ["Set up Microsoft Foundry", foundryUrl],
      ["Voice Agent quickstart", voiceAgentUrl],
    ]) {
      const link = welcome.getByRole("link", { name, exact: true });
      await expect(link).toHaveAttribute("href", url);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
      await expect(link.locator("..")).toHaveJSProperty("tagName", "P");
      expect(await link.evaluate((element) => {
        const style = getComputedStyle(element);
        return style.color === "rgb(8, 121, 92)"
          && style.display === "inline"
          && style.backgroundColor === "rgba(0, 0, 0, 0)"
          && style.borderTopWidth === "0px";
      })).toBe(true);
    }
    await expect(welcome.getByRole("button")).toHaveCount(1);
    const bounds = await welcome.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(8);
    expect(bounds.y).toBeGreaterThanOrEqual(8);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 8);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(892);
    expect(await welcome.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("welcome.png") });
    await welcome.getByRole("button", { name: "Try the playground", exact: true }).click();
    await expect(welcome).toBeHidden();
    await expect(page.locator("#overall-settings-action")).toHaveCount(0);
    await page.getByRole("button", { name: "Create blank", exact: true }).click();
    const settings = page.getByRole("button", { name: "Overall settings", exact: true });
    await expect(settings).toBeVisible();
    await expect(settings).toContainText("Click to configure the entire Agent");
    await expect(page.locator("#node-editor")).toBeHidden();
    await expect(settings).toBeInViewport();
    await expect(settings).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath("graph-settings.png") });
    await settings.click();
    await expect(page.getByRole("heading", { name: "Entrypoint / Overall settings", exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Input language", exact: true })).toBeVisible();
    expect(errors).toEqual([]);
    await page.reload();
    await expect(welcome).toBeHidden();
    await expect(page.getByRole("button", { name: "Create blank", exact: true })).toBeEnabled();
  });
}

test("Escape dismisses welcome without editing and the settings action supports the keyboard", async ({ page }) => {
  await page.goto("/editor/");
  const welcome = page.getByRole("dialog", { name: welcomeTitle, exact: true });
  await expect(welcome).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(welcome).toBeHidden();
  await expect(page.getByRole("button", { name: "Create blank", exact: true })).toBeFocused();
  await expect(page.locator(".node-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Create blank", exact: true }).click();
  const settings = page.getByRole("button", { name: "Overall settings", exact: true });
  await settings.focus();
  await settings.press("Enter");
  await expect(page.getByRole("heading", { name: "Entrypoint / Overall settings", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to graph", exact: true }).click();
  await settings.focus();
  await settings.press("Space");
  await expect(page.getByRole("heading", { name: "Entrypoint / Overall settings", exact: true })).toBeVisible();
});

for (const playground of [false, true]) {
  test(`Graph settings remains obvious after loading a template in ${playground ? "playground" : "local"} mode`, async ({ page }) => {
    await page.route("**/config", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...await response.json(), playground } });
    });
    await page.goto("/editor/");
    await page.getByRole("button", { name: "Try the playground", exact: true }).click();
    await page.getByRole("button", { name: "Load from templates", exact: true }).click();
    await page.locator('details[data-locale-group="en-*"]').evaluate((element) => { element.open = true; });
    await page.locator('[data-template-id="finance-example-realtime"]').click();
    await expect(page.locator("#template-picker")).toBeHidden();
    await expect(page.locator("#node-editor")).toBeHidden();
    await expect(page.locator(".node-overall-settings")).toHaveCount(1);
    await expect(page.locator("#overall-settings-action")).toHaveCount(0);
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    const settings = page.getByRole("button", { name: "Overall settings", exact: true });
    await expect(settings).toBeInViewport();
    await expect(settings).toContainText("Click to configure the entire Agent");
    await settings.click();
    await expect(page.getByRole("heading", { name: "Entrypoint / Overall settings", exact: true })).toBeVisible();
  });
}
