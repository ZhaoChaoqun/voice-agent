/** Real GPU/REST validation; the single mocked transport test is explicitly labeled. */
import { writeFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import * as THREE from "three";

import { ROOM_SCALE } from "../../src/scene/math";

const TEST_ORIGIN = process.env.HAIER_HABITAT_URL ?? "http://127.0.0.1:5184";

test.beforeEach(async ({ page }) => {
  const reset = await page.request.post("/api/reset", {
    headers: { Origin: TEST_ORIGIN },
    data: {},
  });

  expect(reset.ok()).toBe(true);
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__habitat?.snapshot().ready))
    .toBe(true);
});

test.afterAll(async ({ request }) => {
  const reset = await request.post("/api/reset", {
    headers: { Origin: TEST_ORIGIN },
    data: {},
  });
  expect(reset.ok()).toBe(true);
});

test("renders a saved movie title in the device status", async ({ page }) => {
  const response = await page.request.post("/api/devices/control", {
    headers: { Origin: TEST_ORIGIN },
    data: {
      deviceId: "tv",
      power: true,
      settings: { channel: "movie", mediaTitle: "星际穿越" },
    },
  });
  expect(response.ok()).toBe(true);
  await page.reload();
  await expect(
    page.locator(".device-row").filter({ hasText: "Seeker 智慧屏" }),
  ).toContainText("星际穿越");
});

test("original render pipeline really allocates PBR, GTAO and room reflections", async ({
  page,
}, info) => {
  const snapshot = await page.evaluate(() => window.__habitat?.snapshot());
  expect(snapshot?.pipeline.toneMapping).toBe("AgX");
  expect(snapshot?.pipeline.passes).toEqual([
    "RenderPass",
    "GTAOPass",
    "UnrealBloomPass",
    "OutputPass",
    "SMAAPass",
  ]);
  expect(snapshot?.pipeline.reflection.captures).toBeGreaterThan(0);
  expect(snapshot?.pipeline.reflection.source).toBe("room CubeCamera + PMREM");
  expect(snapshot?.pipeline.reflection.pmremWidth).toBeGreaterThan(0);
  expect(snapshot?.pipeline.reflection.pmremHeight).toBeGreaterThan(0);
  expect(snapshot?.pipeline.shadow.enabled).toBe(true);
  expect(snapshot?.pipeline.shadow.width).toBe(snapshot?.quality.shadowSize);
  expect(snapshot?.pipeline.shadow.height).toBe(snapshot?.quality.shadowSize);
  for (const material of snapshot?.pipeline.pbr ?? [])
    expect(material).toMatchObject({
      albedo: true,
      normal: true,
      roughness: true,
    });
  expect(snapshot?.pipeline.pbr).toHaveLength(4);
  expect(snapshot?.pipeline.volumetricRays).toBe(false);
  expect(snapshot?.calls).toBeGreaterThan(10);
  expect(snapshot?.triangles).toBeGreaterThan(1000);
  expect(snapshot?.triangles).toBeLessThan(2_000_000);
  expect(snapshot?.quality.name).toBe(
    info.project.name === "mobile" ? "compact" : "balanced",
  );
  const bounds = await page.locator("canvas").boundingBox();
  if (!bounds || !snapshot) throw new Error("Missing rendered scene");
  expect(snapshot.pipeline.ao.width).toBe(
    Math.round(bounds.width * snapshot.quality.pixelRatio * 0.5),
  );
  expect(snapshot.pipeline.ao.height).toBe(
    Math.round(bounds.height * snapshot.quality.pixelRatio * 0.5),
  );
});

test("title stays separate, text is readable and all layouts remain within the viewport", async ({
  page,
}) => {
  const heading = await page.locator(".habitat-title h1").boundingBox();
  const canvas = await page.locator("canvas").boundingBox();
  if (!heading || !canvas) throw new Error("Missing presentation bounds");
  expect(heading.y + heading.height).toBeLessThan(canvas.y);
  await expect(page.locator(".habitat-brand > strong")).toHaveCSS(
    "color",
    "rgb(0, 90, 170)",
  );
  for (const [selector, minimum] of [
    [".device-select strong", 14],
    [".device-select small", 12],
    ["#atelier-model", 14],
    ["#atelier-message", 16],
    [".habitat-metric-labels", 12],
  ] as const) {
    const sizes = await page
      .locator(selector)
      .evaluateAll((elements) =>
        elements.map((element) =>
          Number.parseFloat(getComputedStyle(element).fontSize),
        ),
      );
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(minimum);
  }
  for (const viewport of [
    { width: 360, height: 740 },
    { width: 844, height: 390 },
    { width: 1512, height: 982 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("fixed human eye-height camera and picking", async ({ page }) => {
  const before = await page.evaluate(() => window.__habitat?.snapshot().camera);
  expect(before?.position[1]).toBe(1.68);
  expect(Math.abs(before?.direction[1] ?? 1)).toBeLessThan(1e-10);
  await expect(page.locator(".habitat-room-tools")).toHaveCount(0);
  await page
    .locator(".device-select")
    .filter({ hasText: "舒适风空调" })
    .click();
  await expect(page.getByTestId("device-detail")).toContainText("KFR-35GW/Z6A");
  await expect
    .poll(() => page.evaluate(() => window.__habitat?.snapshot().selected))
    .toBe("ac");
  expect(
    await page.evaluate(() => window.__habitat?.snapshot().camera),
  ).toEqual(before);
  await page.getByRole("button", { name: "关闭控制", exact: true }).click();
  await expect(page.locator(".device-row")).toHaveCount(6);
  await expect(page.locator(".habitat-footer a")).toHaveCount(0);
});

test("real backend controls, presets and foreign-origin rejection", async ({
  page,
}) => {
  const toggle = page
    .locator(".device-row")
    .filter({ hasText: "Seeker 智慧屏" })
    .getByRole("switch");
  const power = await toggle.getAttribute("aria-checked");
  await toggle.click();
  await expect(toggle).toHaveAttribute(
    "aria-checked",
    power === "true" ? "false" : "true",
  );
  const config = await (await page.request.get("/api/config")).json();
  expect(
    config.home.devices.find((device: { id: string }) => device.id === "tv")
      .power,
  ).toBe(power !== "true");
  await page
    .locator(".device-select")
    .filter({ hasText: "舒适风空调" })
    .click();
  await page.getByRole("button", { name: "目标温度 +", exact: true }).click();
  await expect(page.locator(".numeric-control output")).toContainText("25");
  await page.getByRole("button", { name: "关闭控制", exact: true }).click();
  await page.getByRole("button", { name: "沉浸观影", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__habitat?.snapshot().atmosphere))
    .toBe("cinema");
  const foreign = await page.request.post("/api/reset", {
    headers: { Origin: "http://127.0.0.1:5180" },
    data: {},
  });
  expect(foreign.status()).toBe(403);
  const absent = await page.request.post("/api/reset", { data: {} });
  expect(absent.status()).toBe(403);
});

test("curtains ease between open and closed positions instead of snapping", async ({
  page,
}) => {
  const curtains = page.locator(".device-row").filter({ hasText: "智能窗帘" });
  await curtains.locator(".device-select").click();
  const before = await page.evaluate(
    () => window.__habitat?.snapshot().curtains,
  );
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => window.__habitat?.snapshot().curtains.targetScale),
    )
    .toBe(2.55);
  const immediate = await page.evaluate(
    () => window.__habitat?.snapshot().curtains,
  );
  expect(immediate?.targetScale).toBe(2.55);
  expect(immediate?.scales[0]).toBeLessThan(2.55);
  expect(immediate?.scales[0]).toBeGreaterThan(0.65);
  expect(before?.scales[0]).toBeLessThan(2.55);
  await expect
    .poll(
      () =>
        page.evaluate(() => window.__habitat?.snapshot().curtains.scales[0]),
      { timeout: 3_000 },
    )
    .toBeGreaterThan(2.5);
  await page.getByRole("button", { name: "打开", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => window.__habitat?.snapshot().curtains.targetScale),
    )
    .toBe(0.65);
  const reopening = await page.evaluate(
    () => window.__habitat?.snapshot().curtains,
  );
  expect(reopening?.targetScale).toBe(0.65);
  expect(reopening?.scales[0]).toBeGreaterThan(0.65);
  await expect
    .poll(
      () =>
        page.evaluate(() => window.__habitat?.snapshot().curtains.scales[0]),
      { timeout: 3_000 },
    )
    .toBeLessThan(0.7);
});

test("bilingual UI, both available real engines and clearly unavailable gpt-live", async ({
  page,
}) => {
  await expect(page.locator("#atelier-model")).toHaveValue(
    "gpt-realtime-2.1-mini",
  );
  await expect(
    page.locator("#atelier-model option[value='gpt-live']"),
  ).toBeDisabled();
  await expect(
    page.locator("#atelier-model option[value='gpt-live']"),
  ).toContainText("暂不可用");
  await page.locator("#atelier-model").selectOption("gpt-realtime-2.1-mini");
  await expect(page.locator("#atelier-model")).toHaveValue(
    "gpt-realtime-2.1-mini",
  );
  await page.locator("#atelier-model").selectOption("gpt-realtime-2.1");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Live in the light. Feel at home." }),
  ).toBeVisible();
  await expect(
    page.getByText("EN / 中文 · Auto detect", { exact: true }),
  ).toBeVisible();
  expect(await page.locator("html").getAttribute("lang")).toBe("en");
  await expect(page.locator(".device-row")).toHaveCount(6);
});

test("real product sources and explicitly mocked import avoid modifying the shared knowledge store", async ({
  page,
}) => {
  await page.route("**/api/knowledge", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 201,
      json: {
        id: "habitat-test-import",
        title: "Habitat test guide",
        model: "HABITAT-TEST",
        kind: "uploaded",
      },
    });
  });
  await page.getByRole("button", { name: "产品知识库", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("BCD-480WGHTDEDXMU1");
  await expect(dialog.locator(".source-card a").first()).toHaveAttribute(
    "href",
    /^https:\/\//,
  );
  await dialog
    .locator(".knowledge-import input")
    .nth(0)
    .fill("Habitat test guide");
  await dialog.locator(".knowledge-import input").nth(1).fill("HABITAT-TEST");
  await dialog
    .locator("textarea")
    .fill(
      "Independent simulated test appliance guide. No official capability claim.",
    );
  await dialog.locator("button[type='submit']").click();
  await expect(dialog.locator(".inline-success")).toBeVisible();
  await expect(dialog).toContainText("Habitat test guide");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("actual mesh raycasting selects the television without moving the camera", async ({
  page,
}) => {
  const view = await page.evaluate(() => window.__habitat?.snapshot().camera);
  const bounds = await page.locator("canvas").boundingBox();
  if (!view || !bounds) throw new Error("Missing scene projection");
  const camera = new THREE.PerspectiveCamera(
    view.fov,
    bounds.width / bounds.height,
    0.1,
    40,
  );
  camera.position.fromArray(view.position);
  camera.lookAt(
    camera.position.clone().add(new THREE.Vector3().fromArray(view.direction)),
  );
  camera.updateMatrixWorld();
  const screen = new THREE.Vector3(-2.7, 2.17, -4.44)
    .multiplyScalar(ROOM_SCALE)
    .project(camera);
  await page.locator("canvas").scrollIntoViewIfNeeded();
  const visibleBounds = await page.locator("canvas").boundingBox();
  if (!visibleBounds) throw new Error("Missing visible canvas");
  await page.mouse.click(
    visibleBounds.x + (screen.x * 0.5 + 0.5) * visibleBounds.width,
    visibleBounds.y + (-screen.y * 0.5 + 0.5) * visibleBounds.height,
  );
  await expect
    .poll(() => page.evaluate(() => window.__habitat?.snapshot().selected))
    .toBe("tv");
  await expect(page.getByTestId("device-detail")).toContainText("75V80D");
  expect(
    await page.evaluate(() => window.__habitat?.snapshot().camera),
  ).toEqual(view);
});

test("explicitly mocked voice transport preserves transcripts, sources and tool audit", async ({
  page,
}) => {
  await page.evaluate(() => {
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(options?: AudioContextOptions) {
        super({ ...options, sinkId: { type: "none" } } as AudioContextOptions);
      }
    };
  });
  await page.routeWebSocket("**/api/voice?**", (socket) => {
    socket.send(JSON.stringify({ type: "demo.ready" }));
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type !== "response.create") return;
      socket.send(
        JSON.stringify({
          type: "response.audio_transcript.done",
          item_id: "habitat-test",
          transcript:
            "冰箱型号为 BCD-480WGHTDEDXMU1。This is a mocked transport test.",
        }),
      );
      socket.send(
        JSON.stringify({
          type: "demo.tool",
          activity: {
            id: "habitat-tool",
            name: "search_product_manual",
            summary: "BCD-480WGHTDEDXMU1",
            status: "success",
          },
        }),
      );
      socket.send(
        JSON.stringify({
          type: "demo.sources",
          sources: [
            {
              id: "habitat-source",
              title: "BCD-480WGHTDEDXMU1 guide",
              model: "BCD-480WGHTDEDXMU1",
              kind: "manufacturer",
              url: "https://www.haier.com/",
            },
          ],
        }),
      );
      socket.send(
        JSON.stringify({
          type: "response.done",
          response: { status: "completed" },
        }),
      );
    });
  });
  await page.locator("#atelier-message").fill("冰箱是什么型号");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.locator(".chat-message.assistant")).toContainText(
    "BCD-480WGHTDEDXMU1",
  );
  await expect(page.locator(".citation")).toContainText("BCD-480WGHTDEDXMU1");
  await page.getByRole("button", { name: /设备动态/ }).click();
  await expect(page.locator(".tool-entry.success")).toContainText(
    "BCD-480WGHTDEDXMU1",
  );
});

test("reduced motion stops animation, and atmosphere recaptures actual room lighting", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => window.__habitat?.snapshot().ready))
    .toBe(true);
  expect(await page.evaluate(() => window.__habitat?.snapshot().paused)).toBe(
    true,
  );
  const before = await page.evaluate(() => window.__habitat?.snapshot());
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__habitat?.snapshot().time)).toBe(
    before?.time,
  );
  await page.getByRole("button", { name: "蓝调时刻", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__habitat?.snapshot().pipeline.reflection.captures ?? 0,
      ),
    )
    .toBeGreaterThan(before?.pipeline.reflection.captures ?? 0);
  expect(
    await page.evaluate(() => window.__habitat?.snapshot().atmosphere),
  ).toBe("dusk");
});

test("real context loss is visible and does not disable REST controls", async ({
  page,
}) => {
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const gl = canvas?.getContext("webgl2");
    const extension = gl?.getExtension("WEBGL_lose_context");
    if (!extension) throw new Error("Cannot test actual WebGL context loss");
    extension.loseContext();
  });
  await expect(page.locator(".habitat-webgl-error")).toContainText(
    "3D 渲染暂不可用",
  );
  expect(await page.evaluate(() => window.__habitat?.snapshot().ready)).toBe(
    false,
  );
  const toggle = page
    .locator(".device-row")
    .filter({ hasText: "Seeker 智慧屏" })
    .getByRole("switch");
  const power = await toggle.getAttribute("aria-checked");
  await toggle.click();
  await expect(toggle).toHaveAttribute(
    "aria-checked",
    power === "true" ? "false" : "true",
  );
});

test("unavailable WebGL initialization shows an honest error instead of a fake ready scene", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const native = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof native>
    ): ReturnType<typeof native> {
      if (String(args[0]).startsWith("webgl")) return null;
      return Reflect.apply(native, this, args);
    } as typeof native;
  });
  await page.reload();
  await expect(page.locator(".habitat-webgl-error")).toContainText(
    "3D 渲染暂不可用",
  );
  expect(
    await page.evaluate(() => window.__habitat?.snapshot().ready ?? false),
  ).toBe(false);
  await expect(page.locator(".device-row")).toHaveCount(6);
  await expect(page.locator("#atelier-message")).toBeEnabled();
});

test("explicitly mocked backend failure stays actionable instead of hiding the error", async ({
  page,
}) => {
  await page.route("**/api/config", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Habitat test: backend unavailable" },
    }),
  );
  await page.reload();
  await expect(page.locator(".habitat-notice")).toContainText(
    "backend unavailable",
  );
  await expect(page.getByRole("button", { name: "重新连接" })).toBeVisible();
  expect(
    await page.evaluate(() => window.__habitat?.snapshot().ready ?? false),
  ).toBe(false);
});

test("clean daylight and dusk screenshots with no page or shader errors", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => window.__habitat?.snapshot().ready))
    .toBe(true);
  const initialCaptures = await page.evaluate(
    () => window.__habitat?.snapshot().pipeline.reflection.captures ?? 0,
  );
  const television = page
    .locator(".device-row")
    .filter({ hasText: "Seeker 智慧屏" })
    .getByRole("switch");
  await television.click();
  await expect(television).toHaveAttribute("aria-checked", "true");
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__habitat?.snapshot().pipeline.reflection.captures ?? 0,
      ),
    )
    .toBeGreaterThan(initialCaptures);
  await expect
    .poll(() => page.evaluate(() => window.__habitat?.snapshot().fps ?? 0))
    .toBeGreaterThan(0);
  const diagnostic = await page.evaluate(() => window.__habitat?.snapshot());
  await writeFile(
    `test-results/haier-habitat-${info.project.name}-diagnostics.json`,
    JSON.stringify(diagnostic, null, 2),
  );
  await page.screenshot({
    path: `test-results/haier-habitat-${info.project.name}-day.png`,
    fullPage: true,
  });
  await page.locator(".habitat-room").screenshot({
    path: `test-results/haier-habitat-${info.project.name}-room.png`,
  });
  const dayCaptures = await page.evaluate(
    () => window.__habitat?.snapshot().pipeline.reflection.captures ?? 0,
  );
  await page.getByRole("button", { name: "蓝调时刻", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__habitat?.snapshot().atmosphere))
    .toBe("dusk");
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__habitat?.snapshot().pipeline.reflection.captures ?? 0,
      ),
    )
    .toBeGreaterThan(dayCaptures);
  await page.screenshot({
    path: `test-results/haier-habitat-${info.project.name}-dusk.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
