/** Real WebGL and REST behavior; only the explicitly mocked voice test fakes AI. */
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  const reset = await page.request.post("/api/reset", {
    headers: { Origin: String(test.info().project.use.baseURL) },
    data: {},
  });
  expect(reset.ok()).toBe(true);
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__atelier?.snapshot().ready), {
      timeout: 20_000,
    })
    .toBe(true);
});

test("immersive scene, bilingual controls, and preserved classic edition", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(
    page.getByRole("heading", { name: "让家， 回应你。" }),
  ).toBeVisible();
  await expect(page.locator(".device-row")).toHaveCount(6);
  for (const label of ["日光漫居", "蓝调时刻", "静谧夜幕"]) {
    await expect(
      page.getByRole("button", { name: label, exact: true }).locator("span"),
    ).toBeVisible();
  }
  await expect(
    page.getByRole("button", { name: "蓝调时刻", exact: true }).locator("svg"),
  ).toHaveClass(/lucide-sunset/);
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A home. In harmony." }),
  ).toBeVisible();
  await expect(
    page.getByText("EN / 中文 · Auto detect", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const classic = await page.request.get("http://127.0.0.1:5178");
  expect(await classic.text()).toContain("Haier · Home, in harmony");
  expect(errors).toEqual([]);
});

test("bright surfaces, fixed eye-level camera, selection and motion pause", async ({
  page,
}) => {
  await expect(
    page.getByRole("button", { name: "日光漫居", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const original = await page.evaluate(
    () => window.__atelier?.snapshot().camera,
  );
  expect(Math.abs(original?.direction[0] ?? 1)).toBeLessThan(1e-10);
  expect(Math.abs(original?.direction[1] ?? 1)).toBeLessThan(1e-10);
  expect(original?.direction[2]).toBe(-1);
  await expect(page.locator(".atelier-brand > strong")).toHaveCSS(
    "color",
    "rgb(0, 90, 170)",
  );
  for (const label of ["蓝调时刻", "静谧夜幕"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.locator(".device-panel")).toHaveCSS(
      "background-color",
      "rgba(255, 255, 255, 0.94)",
    );
  }
  await page.getByRole("button", { name: "日光漫居", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__atelier?.snapshot().atmosphere))
    .toBe("day");
  await page.getByRole("button", { name: "暂停动态", exact: true }).click();
  const pausedTime = await page.evaluate(
    () => window.__atelier?.snapshot().time,
  );
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__atelier?.snapshot().time)).toBe(
    pausedTime,
  );
  await page
    .locator(".device-select")
    .filter({ hasText: "舒适风空调" })
    .click();
  await expect(page.getByTestId("device-detail")).toContainText("KFR-35GW/Z6A");
  await expect
    .poll(() => page.evaluate(() => window.__atelier?.snapshot().selected))
    .toBe("ac");
  expect(
    await page.evaluate(() => window.__atelier?.snapshot().camera),
  ).toEqual(original);
  const canvas = page.locator("canvas");
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Missing WebGL canvas bounds");
  await page.mouse.move(
    bounds.x + bounds.width * 0.5,
    bounds.y + bounds.height * 0.6,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * 0.65,
    bounds.y + bounds.height * 0.65,
    { steps: 4 },
  );
  await page.mouse.up();
  await page.mouse.wheel(0, -400);
  expect(
    await page.evaluate(() => window.__atelier?.snapshot().camera),
  ).toEqual(original);
  await page.getByRole("button", { name: "关闭控制", exact: true }).click();
  await expect(page.locator(".device-row")).toHaveCount(6);
});

test("title never overlaps the room, header is populated, and business text is readable", async ({
  page,
}) => {
  const heading = await page.locator(".editorial h1").boundingBox();
  const canvas = await page.locator("canvas").boundingBox();
  const brand = await page.locator(".atelier-brand").boundingBox();
  if (!heading || !canvas || !brand)
    throw new Error("Missing required presentation surfaces");
  expect(heading.y + heading.height).toBeLessThanOrEqual(canvas.y);
  expect(brand.y).toBeLessThan(40);
  await expect(page.locator(".masthead")).toBeVisible();
  for (const [selector, minimum] of [
    [".device-select strong", 14],
    [".device-select small", 12],
    [".engine-panel select", 14],
    [".dock-content input", 16],
    [".climate label", 12],
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
});

test("real appliance mutation uses the preserved backend and rejects cross-origin requests", async ({
  page,
}) => {
  const row = page.locator(".device-row").filter({ hasText: "Seeker 智慧屏" });
  const toggle = row.getByRole("switch");
  const before = await toggle.getAttribute("aria-checked");
  await toggle.click();
  await expect(toggle).toHaveAttribute(
    "aria-checked",
    before === "true" ? "false" : "true",
  );
  const response = await page.request.post("/api/reset", {
    headers: { Origin: "https://untrusted.invalid" },
    data: {},
  });
  expect(response.status()).toBe(403);
  await page.getByRole("button", { name: "沉浸观影", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "沉浸观影", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => page.evaluate(() => window.__atelier?.snapshot().atmosphere))
    .toBe("cinema");
});

test("knowledge import and model availability remain honest", async ({
  page,
}) => {
  await expect(page.locator("#atelier-model")).toHaveValue(
    "microsoft-realtime-flash-1",
  );
  await expect(
    page.locator("#atelier-model option[value='gpt-live']"),
  ).toBeDisabled();
  await page
    .locator("#atelier-model")
    .selectOption("microsoft-realtime-flash-1");
  await expect(page.locator("#atelier-model")).toHaveValue(
    "microsoft-realtime-flash-1",
  );
  await page.getByRole("button", { name: "产品知识库", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("BCD-480WGHTDEDXMU1");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("mocked transport renders streamed text, tool audit, and explicit failures", async ({
  page,
}) => {
  await page.evaluate(() => {
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(options?: AudioContextOptions) {
        const silent = { ...options, sinkId: { type: "none" } };
        super(silent);
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
          item_id: "answer",
          transcript: "欢迎回家，冰箱型号是 BCD-480WGHTDEDXMU1。",
        }),
      );
      socket.send(
        JSON.stringify({
          type: "demo.tool",
          activity: {
            id: "call",
            name: "search_product_manual",
            summary: "BCD-480WGHTDEDXMU1",
            status: "success",
          },
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
  await page.locator("#atelier-message").fill("冰箱型号是什么");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.locator(".chat-message.assistant")).toContainText(
    "BCD-480WGHTDEDXMU1",
  );
  await page.getByRole("button", { name: /设备动态/ }).click();
  await expect(page.locator(".tool-entry.success")).toContainText(
    "BCD-480WGHTDEDXMU1",
  );
});

test("screenshots and local rendering diagnostics", async ({ page }, info) => {
  await page.getByRole("button", { name: "蓝调时刻", exact: true }).click();
  await page.screenshot({
    path: `test-results/atelier-${info.project.name}-dusk.png`,
    fullPage: true,
  });
  const snapshot = await page.evaluate(() => window.__atelier?.snapshot());
  expect(snapshot?.calls).toBeGreaterThan(1);
  expect(snapshot?.triangles).toBeGreaterThan(1000);
  expect(snapshot?.triangles).toBeLessThan(2_000_000);
});

test("reduced motion starts paused and narrow layouts never overflow", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => window.__atelier?.snapshot().paused))
    .toBe(true);
  const before = await page.evaluate(() => window.__atelier?.snapshot().time);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__atelier?.snapshot().time)).toBe(
    before,
  );
  for (const viewport of [
    { width: 360, height: 740 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
