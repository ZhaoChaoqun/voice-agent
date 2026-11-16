/** Browser coverage explicitly mocks AI and never claims live voice acceptance. */
import { expect, test } from "@playwright/test";

import type { DemoConfig } from "../../shared/protocol";
import { installSilentSink } from "./audio-helper";

function fixture(): DemoConfig {
  return {
    models: [
      { id: "gpt-realtime-2.1", label: "GPT Realtime 2.1", available: true },
      {
        id: "microsoft-realtime-flash-1",
        label: "Microsoft Realtime Flash",
        available: true,
      },
      {
        id: "unsupported-model",
        label: "Unsupported model",
        available: false,
        reason: "Model not advertised by this endpoint.",
      },
    ],
    home: {
      revision: 1,
      activeScene: null,
      environment: {
        temperature: 26,
        humidity: 42,
        airQuality: 18,
        simulated: true,
      },
      devices: [
        {
          id: "tv",
          name: { zh: "智能电视", en: "Smart TV" },
          model: "DEMO-TV",
          power: false,
          settings: { volume: 20 },
        },
        {
          id: "fridge",
          name: { zh: "智能冰箱", en: "Refrigerator" },
          model: "SAMPLE-FRIDGE-01",
          power: true,
          settings: { fridgeTemp: 4, freezerTemp: -18 },
        },
        {
          id: "ac",
          name: { zh: "空调", en: "Air conditioner" },
          model: "DEMO-AC",
          power: true,
          settings: { temperature: 24, mode: "cool" },
        },
        {
          id: "humidifier",
          name: { zh: "加湿器", en: "Humidifier" },
          model: "DEMO-HUM",
          power: false,
          settings: { targetHumidity: 50 },
        },
        {
          id: "lights",
          name: { zh: "氛围灯", en: "Ambient light" },
          model: "DEMO-LIGHT",
          power: true,
          settings: { brightness: 65 },
        },
        {
          id: "curtains",
          name: { zh: "智能窗帘", en: "Curtains" },
          model: "DEMO-CURTAIN",
          power: true,
          settings: { position: "open" },
        },
      ],
    },
    knowledge: [
      {
        id: "fridge",
        title: "Fictional sample refrigerator guide",
        model: "SAMPLE-FRIDGE-01",
        kind: "demo",
        url: "https://example.org/sample-guide",
      },
    ],
    backend: { configured: true, mode: "test-boundary-only" },
  };
}

test.beforeEach(async ({ page }) => {
  const config = fixture();
  await page.route("**/api/config", (route) => route.fulfill({ json: config }));
  await page.route("**/api/devices/control", async (route) => {
    const command = route.request().postDataJSON();
    const device = config.home.devices.find(
      (item) => item.id === command.deviceId,
    );
    if (device) {
      if (command.power !== undefined) device.power = command.power;
      Object.assign(device.settings, command.settings);
      config.home.revision += 1;
    }
    await route.fulfill({ json: config.home });
  });
  await page.route("**/api/scenes", async (route) => {
    config.home.activeScene = route.request().postDataJSON().scene;
    config.home.revision += 1;
    await route.fulfill({ json: config.home });
  });
  await page.goto("/");
});

test("renders a real WebGL room and switches every major surface to English", async ({
  page,
}) => {
  await expect(
    page.getByRole("heading", { name: "家，懂你多一点。" }),
  ).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator(".device-card")).toHaveCount(6);
  await page.screenshot({
    path: `test-results/smart-home-${test.info().project.name}-zh.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A home that gets you." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Let's talk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("English & Chinese · Auto", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/smart-home-${test.info().project.name}-en.png`,
    fullPage: true,
  });
});

test("streams a mocked assistant turn, tool state, and an auditable action", async ({
  page,
}) => {
  const updated = fixture().home;
  updated.revision = 8;
  updated.devices.find((device) => device.id === "ac")!.settings.temperature =
    25;
  await page.routeWebSocket("**/api/voice?**", (socket) => {
    socket.send(JSON.stringify({ type: "demo.ready" }));
    socket.onMessage((raw) => {
      const event = JSON.parse(String(raw));
      if (event.type !== "response.create") return;
      socket.send(JSON.stringify({ type: "response.created" }));
      socket.send(
        JSON.stringify({
          type: "response.output_audio_transcript.done",
          item_id: "filler1",
          transcript: "好的。",
        }),
      );
      socket.send(
        JSON.stringify({
          type: "response.output_audio.delta",
          item_id: "filler1",
          delta: "AAAAAA==",
        }),
      );
      socket.send(
        JSON.stringify({
          type: "response.done",
          response: { status: "completed" },
        }),
      );
      socket.send(JSON.stringify({ type: "demo.state", home: updated }));
      socket.send(
        JSON.stringify({
          type: "demo.tool",
          activity: {
            id: "call1",
            name: "control_device",
            status: "success",
            summary: "ac temperature = 25",
          },
        }),
      );
      socket.send(
        JSON.stringify({
          type: "response.audio_transcript.delta",
          item_id: "answer1",
          delta: "[cheerful] 好呀，空调已经调到 25 度。",
        }),
      );
      socket.send(
        JSON.stringify({
          type: "response.audio_transcript.done",
          item_id: "answer1",
          transcript: "[cheerful] 好呀，空调已经调到 25 度。",
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
  await page
    .getByLabel("也可以打字告诉小家…", { exact: true })
    .fill("请把空调调到 25 度");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.locator(".message-assistant")).toHaveText([
    "好的。",
    "好呀，空调已经调到 25 度。",
  ]);
  await expect(page.locator(".message-assistant")).toHaveCount(2);
  await expect(
    page.locator(".device-card-main").filter({ hasText: "空调" }),
  ).toContainText("25°C");
  await page.getByRole("button", { name: /设备动态/ }).click();
  await expect(page.locator(".activity-item.success")).toContainText(
    "ac temperature = 25",
  );
  await page.getByRole("button", { name: "结束对话", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "开始语音对话", exact: true }),
  ).toBeVisible();
});

test("manual power, numeric controls, and scenes reflect server-acknowledged state", async ({
  page,
}) => {
  const tvSwitch = page.getByRole("switch", {
    name: "智能电视 · 开启",
    exact: true,
  });
  await tvSwitch.click();
  await expect(
    page.getByRole("switch", { name: "智能电视 · 关闭", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page.locator(".device-card-main").filter({ hasText: "空调" }).click();
  await page.getByRole("button", { name: "目标温度 +", exact: true }).click();
  await expect(
    page.getByTestId("device-inspector").locator("output"),
  ).toHaveText("25°C");
  await page.getByRole("button", { name: /观影时光/ }).click();
  await expect(page.getByRole("button", { name: /观影时光/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("knowledge shows sample provenance and imports an allowed plain-text guide", async ({
  page,
}) => {
  await page.getByRole("button", { name: "产品知识库", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }),
  ).toBeFocused();
  await expect(page.getByRole("link", { name: /查看资料/ })).toHaveAttribute(
    "href",
    "https://example.org/sample-guide",
  );
  await page.route("**/api/knowledge", (route) =>
    route.fulfill({
      json: {
        id: "upload-test",
        title: "Test guide",
        model: "DEMO-TEST",
        kind: "uploaded",
      },
    }),
  );
  await page.getByLabel("资料标题", { exact: true }).fill("Test guide");
  await page.getByLabel("适用型号", { exact: true }).fill("DEMO-TEST");
  await page
    .locator("textarea")
    .fill("A bounded fictional demonstration guide.");
  await page.getByRole("button", { name: "导入知识库", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("资料已导入");
  await expect(page.getByText("Test guide", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("requested unavailable models cannot masquerade as another model", async ({
  page,
}) => {
  const option = page.locator("#voice-model option[value='unsupported-model']");
  await expect(option).toBeDisabled();
  await page.locator("#voice-model").selectOption("microsoft-realtime-flash-1");
  await expect(page.locator("#voice-model")).toHaveValue(
    "microsoft-realtime-flash-1",
  );
  await expect(
    page.getByText("Model not advertised by this endpoint.", { exact: true }),
  ).toBeVisible();
});

test("keeps a failed message draft and does not mislabel a backend error as microphone permission", async ({
  page,
}) => {
  await installSilentSink(page);
  await page.routeWebSocket("**/api/voice?**", (socket) => {
    socket.send(
      JSON.stringify({
        type: "demo.error",
        message: "Agent not found in configured project",
      }),
    );
  });
  const input = page.locator("#message");
  await input.fill("请打开电视");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Agent not found in configured project",
  );
  await expect(input).toHaveValue("请打开电视");
});

test("captures synthetic microphone PCM through the AudioWorklet and releases tracks", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["microphone"]);
  await installSilentSink(page);
  await page.evaluate(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      (
        window as Window & { demoTestTracks?: MediaStreamTrack[] }
      ).demoTestTracks = stream.getTracks();
      return stream;
    };
  });
  let audioFrames = 0;
  await page.routeWebSocket("**/api/voice?**", (socket) => {
    socket.send(JSON.stringify({ type: "demo.ready" }));
    socket.onMessage((raw) => {
      const event = JSON.parse(String(raw));
      if (
        event.type === "input_audio_buffer.append" &&
        typeof event.audio === "string"
      )
        audioFrames += 1;
    });
  });
  await page.getByRole("button", { name: "开始语音对话", exact: true }).click();
  await expect
    .poll(async () => ({
      frames: audioFrames,
      audio: await page.evaluate(() => {
        const context = (window as Window & { demoTestContext?: AudioContext })
          .demoTestContext;
        return context
          ? {
              state: context.state,
              time: context.currentTime,
              rate: context.sampleRate,
            }
          : null;
      }),
    }))
    .toMatchObject({ frames: expect.any(Number), audio: { state: "running" } });
  await expect
    .poll(() => audioFrames, {
      message: JSON.stringify(
        await page.evaluate(() => {
          const context = (
            window as Window & { demoTestContext?: AudioContext }
          ).demoTestContext;
          return context
            ? {
                state: context.state,
                time: context.currentTime,
                rate: context.sampleRate,
              }
            : null;
        }),
      ),
    })
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "关闭麦克风", exact: true }).click();
  await expect(page.getByText("麦克风已关闭", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "结束对话", exact: true }).click();
  expect(
    await page.evaluate(() =>
      (
        window as Window & { demoTestTracks?: MediaStreamTrack[] }
      ).demoTestTracks?.every((track) => track.readyState === "ended"),
    ),
  ).toBe(true);
});
