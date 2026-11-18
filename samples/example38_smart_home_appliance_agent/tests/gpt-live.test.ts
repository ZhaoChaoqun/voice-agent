/** Mocked-network tests of the GPT Live relay's event translation and delegated tool loop. */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { createDemoServer } from "../server/app";
import { runtimeConfig } from "../server/config";
import { GptLiveSession } from "../server/gpt-live";
import { homeGreeting } from "../server/greeting";
import { HomeStore } from "../server/home";
import { KnowledgeStore } from "../server/knowledge";

class MockSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  bufferedAmount = 0;
  events: Record<string, unknown>[] = [];

  send(payload: string): void {
    this.events.push(JSON.parse(payload) as Record<string, unknown>);
  }

  close(): void {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.emit("close");
  }

  terminate(): void {
    this.close();
  }

  receive(event: object): void {
    this.emit("message", Buffer.from(JSON.stringify(event)), false);
  }

  socket(): WebSocket {
    return this as unknown as WebSocket;
  }

  ofType(type: string): Record<string, unknown>[] {
    return this.events.filter((event) => event.type === type);
  }
}

const endpoint = "https://example.services.ai.azure.com/api/projects/test";
const liveEnv = {
  FOUNDRY_PROJECT_ENDPOINT: endpoint,
  SMART_HOME_GPT_LIVE_AGENT: "unit-live",
  SMART_HOME_VERIFIED_MODELS: "gpt-live-1",
};
const speech = Buffer.alloc(4_800, 1).toString("base64");
const silence = Buffer.alloc(4_800).toString("base64");
const browsers: MockSocket[] = [];

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  for (const browser of browsers.splice(0)) browser.close();
  vi.useRealTimers();
});

async function connected(language: "zh" | "en" = "zh"): Promise<{
  browser: MockSocket;
  upstream: MockSocket;
  home: HomeStore;
  url: URL;
  headers?: Record<string, string>;
}> {
  const browser = new MockSocket();
  const upstream = new MockSocket();
  const home = new HomeStore();
  browsers.push(browser);
  let url = new URL("about:blank");
  let headers: Record<string, string> | undefined;
  const session = new GptLiveSession(
    browser.socket(),
    home,
    new KnowledgeStore(),
    {
      getToken: async () => "mock-secret-token",
      connect: (target, token, extra) => {
        expect(token).toBe("mock-secret-token");
        url = new URL(target);
        headers = extra;
        return upstream.socket();
      },
    },
  );
  await session.start(runtimeConfig(liveEnv), { language });
  return { browser, upstream, home, url, headers };
}

/** Start the session and finish its spoken greeting so the microphone opens. */
async function ready(): Promise<Awaited<ReturnType<typeof connected>>> {
  const context = await connected();
  context.upstream.receive({ type: "session.started" });
  context.upstream.receive({
    type: "session.output_audio.delta",
    delta: speech,
  });
  for (let index = 0; index < 8; index += 1)
    context.upstream.receive({
      type: "session.output_audio.delta",
      delta: silence,
    });
  expect(context.browser.ofType("demo.ready")).toHaveLength(1);
  context.upstream.events = [];
  return context;
}

const backend = (event: object, delegation = "del_1") => ({
  type: "response.event",
  delegation_id: delegation,
  event,
});
const call = (callId: string, name: string, args: object) =>
  backend({
    type: "response.output_item.done",
    response_id: "resp_1",
    item: {
      type: "function_call",
      call_id: callId,
      name,
      arguments: JSON.stringify(args),
    },
  });

describe("GPT Live relay", () => {
  it("opens the native Live route with the preview header and greeting input", async () => {
    const { url, headers } = await connected("en");
    expect(url.origin).toBe("wss://example.services.ai.azure.com");
    expect(url.pathname).toBe(
      "/api/projects/test/agents/unit-live/endpoint/protocols/voice/live/sessions",
    );
    expect(url.searchParams.get("api-version")).toBe("v1");
    expect(
      JSON.parse(url.searchParams.get("structured_inputs")!).welcome_text,
    ).toBe(homeGreeting("en").text);
    expect(headers).toEqual({ "Foundry-Features": "VoiceAgents=V1Preview" });
  });

  it("refuses to start when GPT Live is not configured", async () => {
    const browser = new MockSocket();
    browsers.push(browser);
    const connect = vi.fn();
    const session = new GptLiveSession(
      browser.socket(),
      new HomeStore(),
      new KnowledgeStore(),
      { getToken: async () => "token", connect },
    );
    await session.start(runtimeConfig({ FOUNDRY_PROJECT_ENDPOINT: endpoint }));
    expect(connect).not.toHaveBeenCalled();
    expect(browser.ofType("demo.error")[0]?.message).toContain(
      "not configured",
    );
    expect(browser.readyState).toBe(WebSocket.CLOSED);
  });

  it("keeps the microphone closed until the greeting finishes, then forwards PCM", async () => {
    const { browser, upstream } = await connected();
    upstream.receive({ type: "session.started" });
    browser.receive({ type: "input_audio_buffer.append", audio: speech });
    expect(upstream.ofType("session.input_audio.append")).toHaveLength(0);
    upstream.receive({ type: "session.output_audio.delta", delta: speech });
    for (let index = 0; index < 8; index += 1)
      upstream.receive({ type: "session.output_audio.delta", delta: silence });
    expect(browser.ofType("demo.ready")).toHaveLength(1);
    // Paced silence after speech is not forwarded, so browser playback can finish.
    expect(browser.ofType("response.output_audio.delta")).toHaveLength(8);
    browser.receive({ type: "input_audio_buffer.append", audio: speech });
    expect(upstream.ofType("session.input_audio.append").at(-1)).toEqual({
      type: "session.input_audio.append",
      audio: speech,
    });
  });

  it("forwards only real microphone audio, never synthetic silence", async () => {
    const { upstream } = await connected();
    upstream.receive({ type: "session.started" });
    vi.advanceTimersByTime(60_000);
    expect(upstream.ofType("session.input_audio.append")).toHaveLength(0);
  });

  it("opens the microphone after a fallback when the greeting produces no speech", async () => {
    const { browser, upstream } = await connected();
    upstream.receive({ type: "session.started" });
    vi.advanceTimersByTime(11_999);
    expect(browser.ofType("demo.ready")).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(browser.ofType("demo.ready")).toHaveLength(1);
  });

  it("maps Live transcripts to the browser's realtime transcript events", async () => {
    const { browser, upstream } = await ready();
    browser.events = [];
    upstream.receive({ type: "session.input_transcript.delta", delta: "打开" });
    upstream.receive({ type: "session.input_transcript.delta", delta: "电视" });
    upstream.receive({
      type: "session.output_transcript.delta",
      delta: "好的。",
    });
    vi.advanceTimersByTime(1_200);
    expect(browser.events.map((event) => event.type)).toEqual([
      "input_audio_buffer.speech_started",
      "response.output_audio_transcript.delta",
      "conversation.item.input_audio_transcription.completed",
      "response.output_audio_transcript.done",
    ]);
    expect(browser.events[2]).toMatchObject({ transcript: "打开电视" });
    expect(browser.events[3]).toMatchObject({ transcript: "好的。" });
  });

  it("sends typed text to the delegation and ignores realtime-only controls", async () => {
    const { browser, upstream } = await ready();
    const text = [{ type: "input_text", text: "Turn on the TV" }];
    browser.receive({
      type: "conversation.item.create",
      item: { id: "typed1", type: "message", role: "user", content: text },
    });
    browser.receive({ type: "response.create" });
    browser.receive({ type: "response.cancel" });
    browser.receive({
      type: "conversation.item.truncate",
      item_id: "assistant_1",
      content_index: 0,
      audio_end_ms: 10,
    });
    expect(upstream.events).toEqual([
      {
        type: "response.item.create",
        event_id: expect.any(String),
        item: { type: "message", role: "user", content: text },
      },
      { type: "response.create", event_id: expect.any(String) },
    ]);
    expect(browser.ofType("demo.error")).toHaveLength(0);
  });

  it("rejects unsupported browser events without forwarding them", async () => {
    const { browser, upstream } = await ready();
    browser.receive({ type: "session.update", session: { tools: [] } });
    expect(upstream.events).toHaveLength(0);
    expect(browser.ofType("demo.error")).toHaveLength(1);
  });

  it("runs parallel delegated calls once, then requests one continuation", async () => {
    const { browser, upstream, home } = await ready();
    upstream.receive(
      backend({ type: "response.created", response: { id: "resp_1" } }),
    );
    upstream.receive(
      call("call_tv", "control_device", { deviceId: "tv", power: true }),
    );
    upstream.receive(
      call("call_lights", "control_device", {
        deviceId: "lights",
        settings: { brightness: 30 },
      }),
    );
    upstream.receive(
      call("call_tv", "control_device", { deviceId: "tv", power: true }),
    );
    expect(upstream.events).toHaveLength(0);
    upstream.receive(
      backend({ type: "response.completed", response: { id: "resp_1" } }),
    );
    upstream.receive(
      backend({ type: "response.completed", response: { id: "resp_1" } }),
    );
    expect(upstream.events.map((event) => event.type)).toEqual([
      "response.item.create",
      "response.item.create",
      "response.create",
    ]);
    expect(upstream.events[0]).toMatchObject({
      item: { type: "function_call_output", call_id: "call_tv" },
    });
    const output = JSON.parse(
      (upstream.events[1].item as { output: string }).output,
    );
    expect(output.ok).toBe(true);
    const devices = home.snapshot().devices;
    expect(devices.find((device) => device.id === "tv")?.power).toBe(true);
    expect(
      devices.find((device) => device.id === "lights")?.settings.brightness,
    ).toBe(30);
    expect(
      browser
        .ofType("demo.tool")
        .map((event) => (event.activity as { status: string }).status),
    ).toEqual(["running", "success", "running", "success"]);
  });

  it("ends the assistant transcript and signals barge-in on the first user transcript delta", async () => {
    const { browser, upstream } = await ready();
    upstream.receive({ type: "session.output_audio.delta", delta: speech });
    upstream.receive({
      type: "session.output_transcript.delta",
      delta: "电视已经",
    });
    browser.events = [];
    upstream.receive({ type: "session.input_transcript.delta", delta: "等" });
    expect(browser.events.map((event) => event.type)).toEqual([
      "response.output_audio_transcript.done",
      "input_audio_buffer.speech_started",
    ]);
    upstream.receive({ type: "session.output_audio.delta", delta: speech });
    expect(browser.events.at(-1)?.item_id).not.toBe(browser.events[0]?.item_id);
  });

  it("stops a delegation that keeps requesting tools after the round limit", async () => {
    const { browser, upstream, home } = await ready();
    const round = (index: number) => {
      const response = `resp_${index}`;
      upstream.receive(
        backend({ type: "response.created", response: { id: response } }),
      );
      upstream.receive(
        backend({
          type: "response.output_item.done",
          response_id: response,
          item: {
            type: "function_call",
            call_id: `call_${index}`,
            name: "control_device",
            arguments: JSON.stringify({
              deviceId: "tv",
              settings: { volume: index },
            }),
          },
        }),
      );
      upstream.receive(
        backend({ type: "response.completed", response: { id: response } }),
      );
    };
    for (let index = 1; index <= 4; index += 1) round(index);
    expect(upstream.ofType("response.create")).toHaveLength(4);
    const revision = home.snapshot().revision;
    upstream.events = [];
    round(5);
    expect(upstream.events).toHaveLength(0);
    expect(home.snapshot().revision).toBe(revision);
    expect(browser.ofType("demo.error").at(-1)?.message).toContain(
      "repeated household request",
    );
    round(6);
    expect(upstream.events).toHaveLength(0);
  });

  it("reports an incomplete response after a tool round but keeps a cancelled one silent", async () => {
    const { browser, upstream } = await ready();
    upstream.receive(
      backend({ type: "response.created", response: { id: "resp_1" } }),
    );
    upstream.receive(
      call("call_tv", "control_device", { deviceId: "tv", power: true }),
    );
    upstream.receive(
      backend({ type: "response.completed", response: { id: "resp_1" } }),
    );
    upstream.receive(
      backend({ type: "response.created", response: { id: "resp_2" } }),
    );
    upstream.receive(
      backend({ type: "response.incomplete", response: { id: "resp_2" } }),
    );
    expect(browser.ofType("demo.error")).toHaveLength(1);

    upstream.receive(
      backend(
        { type: "response.created", response: { id: "resp_3" } },
        "del_2",
      ),
    );
    upstream.receive(
      backend(
        {
          type: "response.output_item.done",
          response_id: "resp_3",
          item: {
            type: "function_call",
            call_id: "call_lights",
            name: "control_device",
            arguments: "{}",
          },
        },
        "del_2",
      ),
    );
    upstream.receive(
      backend(
        { type: "response.cancelled", response: { id: "resp_3" } },
        "del_2",
      ),
    );
    expect(browser.ofType("demo.error")).toHaveLength(1);
  });

  it("drops calls from a failed delegation response and tells the browser", async () => {
    const { browser, upstream, home } = await ready();
    upstream.receive(
      backend({ type: "response.created", response: { id: "resp_1" } }),
    );
    upstream.receive(
      call("call_tv", "control_device", { deviceId: "tv", power: true }),
    );
    upstream.receive(
      backend({ type: "response.failed", response: { id: "resp_1" } }),
    );
    upstream.receive(
      backend({ type: "response.completed", response: { id: "resp_1" } }),
    );
    expect(upstream.events).toHaveLength(0);
    expect(home.snapshot().revision).toBe(0);
    expect(browser.ofType("demo.error")).toHaveLength(1);
  });

  it("returns tool validation failures to the delegation instead of claiming success", async () => {
    const { upstream } = await ready();
    upstream.receive(
      backend({ type: "response.created", response: { id: "resp_1" } }),
    );
    upstream.receive(
      call("call_bad", "control_device", { deviceId: "fridge", power: false }),
    );
    upstream.receive(
      backend({ type: "response.completed", response: { id: "resp_1" } }),
    );
    const output = JSON.parse(
      (upstream.events[0].item as { output: string }).output,
    );
    expect(output.ok).toBe(false);
    expect(upstream.events.at(-1)?.type).toBe("response.create");
  });

  it("reports in-session errors without closing, but fails a rejected session", async () => {
    const started = await ready();
    started.upstream.receive({
      type: "error",
      error: { code: "typed_input_too_large" },
    });
    expect(started.browser.ofType("demo.error")).toHaveLength(1);
    expect(started.browser.readyState).toBe(WebSocket.OPEN);

    const rejected = await connected();
    rejected.upstream.receive({ type: "error", error: { code: "bad" } });
    expect(rejected.browser.readyState).toBe(WebSocket.CLOSED);
    expect(rejected.upstream.ofType("session.close")).toHaveLength(0);
  });

  it("closes the Live session when the browser leaves", async () => {
    const { browser, upstream } = await ready();
    browser.close();
    expect(upstream.events).toContainEqual({ type: "session.close" });
    expect(upstream.readyState).toBe(WebSocket.CLOSED);
  });
});

describe("GPT Live routing", () => {
  it("routes gpt-live-1 to the native Live relay and nothing else", async () => {
    vi.useRealTimers();
    const upstream = new MockSocket();
    const connect = vi.fn((..._args: unknown[]) => upstream.socket());
    const demo = createDemoServer({
      config: runtimeConfig(liveEnv),
      home: new HomeStore(),
      knowledge: new KnowledgeStore(),
      voice: { getToken: async () => "token", connect },
    });
    try {
      await new Promise<void>((resolve) =>
        demo.server.listen(0, "127.0.0.1", resolve),
      );
      const address = demo.server.address();
      if (!address || typeof address === "string") throw new Error("No port");
      const base = `http://127.0.0.1:${address.port}`;
      const socket = new WebSocket(
        `${base.replace("http:", "ws:")}/api/voice?model=gpt-live-1&language=zh`,
        { origin: base },
      );
      await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
      expect(connect.mock.calls[0]).toEqual([
        expect.stringContaining(
          "/agents/unit-live/endpoint/protocols/voice/live/sessions",
        ),
        "token",
        { "Foundry-Features": "VoiceAgents=V1Preview" },
      ]);
      socket.terminate();
    } finally {
      demo.close();
    }
  });
});
