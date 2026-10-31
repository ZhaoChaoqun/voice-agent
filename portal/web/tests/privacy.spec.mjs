// Copyright (c) Microsoft. All rights reserved.
// All service, socket, and WebRTC boundaries below are synthetic/local only.
import { test, expect } from "@playwright/test";
import { CONFIG, mockWebRtcPeer, mountStudio, resource, selectSessionAgent, voiceCatalogFixture } from "./studio-fixtures.mjs";

for (const store of [false, true]) {
  test(`Runtime preserves published conversation storage ${store ? "on" : "off"} without an override`, async ({ page }) => {
    const api = await mountStudio(page, {}, "/runtime/?agent=storage-agent", {
      extraAgents: [resource("storage-agent", {
        kind: "voice", model: "gpt-realtime", store,
        audio: { output: { voice: "en-US-AvaNeural", voice_type: "azure-standard" } },
      })],
    });
    await expect(page.locator(".agent-configuration-preview")).toContainText(`Storage: ${store ? "On" : "Off"}`);
    await page.getByText("Agent configuration", { exact: true }).click();
    await expect(page.locator(".agent-facts > div").filter({ hasText: "Conversation storage" }).locator("dd"))
      .toHaveText(store ? "Save transcript & audio" : "Do not save");
    await expect(page.getByRole("combobox", { name: "Conversation storage override", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Connect & start session" }).click();
    await expect.poll(() => api.sockets.length).toBe(1);
    expect(new URL(api.sockets[0].url()).searchParams.has("store")).toBe(false);
    expect(api.versions).toEqual([]);
    await page.getByRole("button", { name: "Stop session" }).click();
  });
}

test("Runtime storage display follows the selected published Agent after refresh", async ({ page }) => {
  const api = await mountStudio(page, {}, "/runtime/", {
    extraAgents: [resource("storage-off-agent", {
      kind: "voice", model: "gpt-realtime", store: false,
      audio: { output: { voice: "en-US-AvaNeural" } },
    })],
  });
  await page.getByRole("button", { name: "Refresh agents", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refresh agents", exact: true })).toBeEnabled();
  await selectSessionAgent(page, "realtime-agent");
  await expect(page.locator(".agent-configuration-preview")).toContainText("Storage: On");
  await selectSessionAgent(page, "storage-off-agent");
  await expect(page.locator(".agent-configuration-preview")).toContainText("Storage: Off");
  expect(api.sockets).toEqual([]);
  expect(api.versions).toEqual([]);
});

const agentName = "shared-privacy-agent";
const base = `/agents/${agentName}/endpoint/protocols/voice/conversations`;
const ownId = "synthetic-own-older";
const otherId = "synthetic-other-newer";

async function reviewFixture(page, { capturedId = null, failList = false } = {}) {
  const calls = [];
  const sockets = [];
  await mockWebRtcPeer(page);
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    const json = (data, status = 200) => route.fulfill({
      status, contentType: "application/json", body: JSON.stringify(data),
    });
    if (url.pathname === "/config") return json({ ...CONFIG, defaultStore: false });
    if (url.pathname === "/api/voices") return json(voiceCatalogFixture());
    if (url.pathname === "/agents") return json({ data: [resource(agentName, {
      kind: "voice", model: "gpt-realtime", store: true,
      audio: { output: { voice: "en-US-AvaNeural", voice_type: "azure-standard" } },
    })], has_more: false });
    if (url.pathname.startsWith(base)) {
      calls.push(url.pathname);
      if (url.pathname === base) {
        if (failList) return json({ error: "Synthetic list unavailable" }, 503);
        return json({ data: [
          { id: ownId, created_at: "2026-09-15T00:00:00Z" },
          { id: otherId, created_at: "2026-09-16T00:00:00Z" },
        ], has_more: false });
      }
      const id = url.pathname.slice(base.length + 1).split("/")[0];
      if (url.pathname.endsWith("/items")) return json({ data: [
        { id: "user-item", type: "message", role: "user",
          content: [{ type: "input_text", text: `SYNTHETIC_TRANSCRIPT_${id}` }] },
        { id: "agent-item", type: "message", role: "assistant",
          voice_metrics: { stt_ms: 180, ttft_ms: 240, ttfa_ms: 340, duration_ms: 1100, cost: 0.25 },
          content: [{ type: "output_text", text: "Synthetic response" }] },
      ], has_more: false });
      if (url.pathname.endsWith("/audio")) return json({
        duration_ms: 1000, format: "wav", channels: 2, channel_layout: { left: "user", right: "agent" },
      });
      if (url.pathname.endsWith("/audio/content")) return route.fulfill({
        contentType: "audio/wav", body: Buffer.from("RIFF-synthetic-review-audio"),
      });
      return json({ id, status: "completed" });
    }
    return route.continue();
  });
  await page.routeWebSocket("**/agents/**/endpoint/protocols/voice?*", (socket) => {
    sockets.push(socket);
    if (capturedId) socket.send(JSON.stringify({
      type: "session.created", conversation_id: capturedId, session: { id: "synthetic-session" },
    }));
  });
  return { calls, sockets };
}

test("persisted HTML requires an explicit ID selection and keeps audio downloads available", async ({ page }) => {
  const api = await reviewFixture(page);
  await page.goto(`/static/demo/persisted.html?agent=${agentName}`);
  await expect(page.locator("#conversationChoiceStatus")).toContainText("Choose a recent ID");
  expect(api.calls).toEqual([base]);
  await expect(page.locator("#turns")).toBeEmpty();
  await expect(page.getByRole("button", { name: /Merged recording/ })).toBeDisabled();
  await page.getByRole("combobox", { name: "Conversation ID", exact: true }).fill(ownId);
  await page.getByRole("button", { name: "Open conversation", exact: true }).click();
  await expect(page.locator("#turns")).toContainText(`SYNTHETIC_TRANSCRIPT_${ownId}`);
  expect(api.calls).not.toContain(`${base}/${otherId}/items`);
  await page.getByRole("button", { name: /Merged recording/ }).click();
  await expect(page.getByRole("link", { name: /Download WAV/ })).toHaveAttribute("href", `${base}/${ownId}/audio/content?api-version=v1`);
  await page.getByRole("button", { name: "Choose conversation", exact: true }).click();
  await expect(page.locator("#turns")).toBeEmpty();
  await expect(page.locator("#recording")).toBeHidden();
});

test("persisted HTML opens a captured ID directly without listing other sessions", async ({ page }) => {
  const api = await reviewFixture(page);
  await page.goto(`/static/demo/persisted.html?agent=${agentName}&conversation=${ownId}`);
  await expect(page.locator("#turns")).toContainText(`SYNTHETIC_TRANSCRIPT_${ownId}`);
  expect(api.calls).toEqual([`${base}/${ownId}/items`]);
  await expect(page.getByRole("region", { name: "Choose a saved conversation" })).toBeHidden();
});

test("known historical IDs can still be opened when listing is unavailable", async ({ page }) => {
  await reviewFixture(page, { failList: true });
  await page.goto(`/static/demo/persisted.html?agent=${agentName}`);
  await expect(page.locator("#conversationChoiceStatus")).toContainText("still paste a known ID");
  await page.getByRole("combobox", { name: "Conversation ID", exact: true }).fill(ownId);
  await page.getByRole("button", { name: "Open conversation", exact: true }).click();
  await expect(page.locator("#turns")).toContainText(`SYNTHETIC_TRANSCRIPT_${ownId}`);
});

async function endWebRtc(page, api, capturedId = null, path = "/static/demo/webrtc.html") {
  await page.goto(path);
  await page.getByLabel("Agent", { exact: true }).fill(agentName);
  await page.getByRole("button", { name: "Start WebRTC session" }).click();
  await expect.poll(() => api.sockets.length).toBe(1);
  if (capturedId) await expect(page.locator(".wrtc-stage")).toContainText(capturedId);
  await page.getByRole("button", { name: "End & review" }).click();
}

test("WebRTC review requires selection when no live conversation ID was captured", async ({ page }) => {
  const api = await reviewFixture(page);
  await endWebRtc(page, api);
  const picker = page.getByRole("region", { name: "Choose a saved conversation" });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("status")).toContainText("Choose a recent ID");
  expect(api.calls).toEqual([base]);
  await picker.getByRole("combobox", { name: "Conversation ID", exact: true }).fill(ownId);
  await picker.getByRole("button", { name: "Open conversation", exact: true }).click();
  await expect(page.locator(".mp-conv")).toHaveText(ownId);
  await expect(page.locator(".mp-tabs, .mp-detail")).toHaveCount(0);
  await expect(page.locator(".mp")).toContainText(`SYNTHETIC_TRANSCRIPT_${ownId}`);
  expect(api.calls).not.toContain(`${base}/${otherId}/items`);
  await page.getByRole("button", { name: "Choose conversation", exact: true }).click();
  await expect(picker).toBeVisible();
  await expect(page.locator(".mp")).toHaveCount(0);
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Start a voice session" })).toBeVisible();
});

test("WebRTC captured conversation and recording controls still work directly", async ({ page }) => {
  const api = await reviewFixture(page, { capturedId: ownId });
  await endWebRtc(page, api, ownId);
  await expect(page.locator(".mp-conv")).toHaveText(ownId);
  expect(api.calls).not.toContain(base);
  await page.getByRole("button", { name: "Load recording", exact: true }).click();
  await expect(page.locator(".wrtc-recording audio")).toHaveAttribute("src", `${base}/${ownId}/audio/content?api-version=v1`);
});

test("WebRTC review hides latency and raw cost metadata without Debug mode", async ({ page }) => {
  const api = await reviewFixture(page, { capturedId: ownId });
  await endWebRtc(page, api, ownId);
  await expect(page.getByRole("checkbox", { name: "Debug mode", exact: true })).toHaveCount(0);
  await expect(page.locator(".mp-chat")).toContainText(`SYNTHETIC_TRANSCRIPT_${ownId}`);
  await expect(page.locator(".mp-tabs, .mp-row, .mp-detail")).toHaveCount(0);
  await expect(page.locator(".mp-topbar")).not.toContainText("1.10s");
  expect(api.calls).not.toContain(base);
});

test("WebRTC review shows latency and cost metadata with ?debug=1", async ({ page }) => {
  const api = await reviewFixture(page, { capturedId: ownId });
  await endWebRtc(page, api, ownId, "/static/demo/webrtc.html?debug=1");
  await expect(page.getByRole("button", { name: "Trajectories", exact: true })).toBeVisible();
  await page.locator(".mp-row").filter({ hasText: "Speech_to_text" }).click();
  await expect(page.locator(".mp-detail")).toContainText("STT latency");
  await expect(page.locator(".mp-detail")).toContainText("180ms");
  await page.getByRole("button", { name: "User view", exact: true }).click();
  await page.locator(".mp-bubble.assistant").click();
  await expect(page.locator(".mp-json")).toContainText('"cost": 0.25');
  expect(api.calls).not.toContain(base);
});
