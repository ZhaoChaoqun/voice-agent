/** Mocked socket/audio regressions for connection, interruption, and replacement. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VoiceClient } from "../src/lib/voice-client";

const audio = vi.hoisted(() => ({
  initialize: vi.fn(async () => {}),
  startCapture: vi.fn(async (_send: (value: string) => void) => {}),
  close: vi.fn(),
  interrupt: vi.fn((): { itemId: string; audioMs: number } | null => null),
  play: vi.fn(),
  setMuted: vi.fn(),
  playing: false,
}));

vi.mock("@/lib/audio", () => ({
  BrowserAudio: class {
    initialize = audio.initialize;
    startCapture = audio.startCapture;
    close = audio.close;
    interrupt = audio.interrupt;
    play = audio.play;
    setMuted = audio.setMuted;
    get isPlaying() {
      return audio.playing;
    }
  },
}));

class MockSocket {
  static OPEN = 1;
  static instances: MockSocket[] = [];
  readyState = MockSocket.OPEN;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: Record<string, unknown>[] = [];

  constructor(readonly url: string) {
    MockSocket.instances.push(this);
  }
  send(raw: string): void {
    this.sent.push(JSON.parse(raw));
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
  emit(event: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

async function connected(client: VoiceClient): Promise<MockSocket> {
  const pending = client.connect(false);
  await Promise.resolve();
  const socket = MockSocket.instances.at(-1);
  if (!socket) throw new Error("No mocked socket created");
  socket.emit({ type: "demo.ready" });
  expect(await pending).toBe(true);
  return socket;
}

describe("browser voice lifecycle", () => {
  let client: VoiceClient;

  beforeEach(() => {
    vi.clearAllMocks();
    audio.playing = false;
    MockSocket.instances = [];
    vi.stubGlobal("WebSocket", MockSocket);
    vi.stubGlobal("location", { protocol: "http:", host: "127.0.0.1:5178" });
    client = new VoiceClient({
      model: "gpt-realtime-2.1",
      language: "zh",
      onHome: vi.fn(),
    });
  });

  afterEach(() => {
    client.stop();
    vi.unstubAllGlobals();
  });

  it("waits for actual demo.ready and reuses the same connection for text", async () => {
    const socket = await connected(client);
    await client.sendText("把空调调到 25 度");
    expect(MockSocket.instances).toHaveLength(1);
    expect(socket.sent.map((event) => event.type)).toEqual([
      "conversation.item.create",
      "response.create",
    ]);
    const item = socket.sent[0]?.item as { id: string };
    expect(item.id).toMatch(/^[a-f0-9]{32}$/);
    expect(client.getSnapshot().messages[0]?.text).toBe("把空调调到 25 度");
    expect(client.getSnapshot().status).toBe("thinking");
  });

  it("enables a microphone after a text-only conversation and releases it on stop", async () => {
    await connected(client);
    expect(await client.connect(true)).toBe(true);
    expect(audio.startCapture).toHaveBeenCalledOnce();
    expect(client.getSnapshot().hasMicrophone).toBe(true);
    client.toggleMute();
    expect(audio.setMuted).toHaveBeenCalledWith(true);
    client.stop();
    expect(audio.close).toHaveBeenCalledOnce();
    expect(client.getSnapshot().hasMicrophone).toBe(false);
  });

  it("clears old context when the model changes instead of suggesting history is shared", async () => {
    const socket = await connected(client);
    await client.sendText("Hello");
    client.configure({
      model: "microsoft-realtime-flash-1",
      language: "en",
      onHome: vi.fn(),
    });
    expect(socket.readyState).toBe(3);
    expect(client.getSnapshot().messages).toEqual([]);
    expect(client.getSnapshot().status).toBe("idle");
  });

  it("queues a new turn until the cancelled response actually completes", async () => {
    const socket = await connected(client);
    socket.emit({ type: "response.created" });
    await client.sendText("Actually, turn the TV off.");
    expect(socket.sent.map((event) => event.type)).toEqual(["response.cancel"]);
    socket.emit({ type: "response.done", response: { status: "cancelled" } });
    expect(socket.sent.map((event) => event.type)).toEqual([
      "response.cancel",
      "conversation.item.create",
      "response.create",
    ]);
  });

  it("does not claim listening while buffered speech is still playing", async () => {
    const socket = await connected(client);
    audio.playing = true;
    socket.emit({ type: "response.created" });
    socket.emit({ type: "response.audio.delta", item_id: "a1", delta: "AAAA" });
    socket.emit({ type: "response.done", response: { status: "completed" } });
    expect(client.getSnapshot().status).toBe("speaking");
    expect(audio.play).toHaveBeenCalledWith("AAAA", "a1");
  });

  it("surfaces failed responses and unexpected socket closure", async () => {
    const socket = await connected(client);
    socket.emit({
      type: "response.done",
      response: {
        status: "failed",
        status_details: { error: { message: "Model capacity unavailable" } },
      },
    });
    expect(client.getSnapshot().error).toBe("Model capacity unavailable");
    socket.close();
    expect(client.getSnapshot().error).toContain("Voice connection ended");
    expect(client.getSnapshot().status).toBe("error");
  });

  it("cannot reconnect after a delayed audio initialization was cancelled", async () => {
    let resume!: () => void;
    audio.initialize.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resume = resolve;
        }),
    );
    const pending = client.connect(true);
    client.stop();
    resume();
    expect(await pending).toBe(false);
    expect(MockSocket.instances).toHaveLength(0);
    expect(audio.startCapture).not.toHaveBeenCalled();
  });
});
