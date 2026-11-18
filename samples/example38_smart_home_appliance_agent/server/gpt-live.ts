/** Relay the browser's realtime-style events to a native GPT Live Agent session. */
import type { RawData, WebSocket } from "ws";
import { z } from "zod";
import { GPT_LIVE_MODEL_ID, type Language } from "@shared/protocol";
import type { RuntimeConfig } from "#server/config";
import { homeGreeting } from "#server/greeting";
import { HomeStore } from "#server/home";
import { KnowledgeStore } from "#server/knowledge";
import { ToolRunner } from "#server/tools";
import { sendEvent, type VoiceDependencies } from "#server/voice";

const READY_TIMEOUT_MS = 20_000; // Bound token acquisition, Agent resolution and the Live handshake.
const MAX_SESSION_MS = 30 * 60 * 1000; // Avoid abandoned billable voice connections.
const MAX_AUDIO_LENGTH = 96_000; // About 1.5 seconds of 24 kHz mono PCM per browser frame.
const TRANSCRIPT_SETTLE_MS = 1_200; // Live has no transcript-done event; a pause ends the visible message.
const SPEECH_END_SILENT_CHUNKS = 8; // Consecutive all-zero Live audio chunks that end a spoken segment.
const GREETING_READY_FALLBACK_MS = 12_000; // Open the microphone even if the greeting produces no speech.
const MAX_TOOL_ROUNDS = 4; // Bound function-call rounds per delegation; Responses keeps tool_choice "auto".
export const GPT_LIVE_HEADERS = { "Foundry-Features": "VoiceAgents=V1Preview" }; // Voice Agents preview opt-in.

const audioEvent = z
  .object({
    type: z.literal("input_audio_buffer.append"),
    audio: z
      .string()
      .min(4)
      .max(MAX_AUDIO_LENGTH)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();
const textEvent = z
  .object({
    type: z.literal("conversation.item.create"),
    item: z
      .object({
        id: z
          .string()
          .min(1)
          .max(32)
          .regex(/^[A-Za-z0-9_-]+$/)
          .optional(),
        type: z.literal("message"),
        role: z.literal("user"),
        content: z
          .array(
            z
              .object({
                type: z.literal("input_text"),
                text: z.string().trim().min(1).max(4000),
              })
              .strict(),
          )
          .length(1),
      })
      .strict(),
  })
  .strict();
// GPT Live owns interruption natively; these realtime controls are accepted and ignored.
const ignoredEvent = z.union([
  z
    .object({
      type: z.enum([
        "input_audio_buffer.commit",
        "input_audio_buffer.clear",
        "response.create",
        "response.cancel",
      ]),
    })
    .strict(),
  z
    .object({
      type: z.literal("conversation.item.truncate"),
      item_id: z.string().min(1).max(200),
      content_index: z.literal(0),
      audio_end_ms: z.number().int().min(0).max(600_000),
    })
    .strict(),
]);
const browserEvent = z.union([audioEvent, textEvent, ignoredEvent]);
type BrowserEvent = z.infer<typeof browserEvent>;
type LiveEvent = Record<string, unknown> & { type: string };
interface BackendItem {
  type?: unknown;
  call_id?: unknown;
  name?: unknown;
  arguments?: unknown;
}
interface BackendEvent {
  type?: unknown;
  response?: { id?: unknown };
  response_id?: unknown;
  item?: BackendItem;
}
interface PendingCall {
  callId: string;
  name: string;
  arguments: string;
}

/**
 * One browser connection to one native GPT Live session, with server-owned tools.
 *
 * GPT Live speaks; its Responses delegation decides which household functions to call.
 * This relay runs those functions locally, returns each `function_call_output` and asks
 * the same delegation to continue with one `response.create`.
 */
export class GptLiveSession {
  private upstream?: WebSocket;
  private sessionStarted = false;
  private ready = false;
  private stopped = false;
  private heardSpeech = false;
  private silentChunks = 0;
  private sequence = 0;
  private assistantItem = "";
  private assistantText = "";
  private userItem = "";
  private userText = "";
  private responseIds = new Map<string, string>();
  private pendingCalls = new Map<string, PendingCall[]>();
  private finishedResponses = new Set<string>();
  private answeredCalls = new Set<string>();
  private toolRounds = new Map<string, number>();
  private stoppedDelegations = new Set<string>();
  private runner: ToolRunner;
  private greetingFallback?: ReturnType<typeof setTimeout>;
  private assistantTimer?: ReturnType<typeof setTimeout>;
  private userTimer?: ReturnType<typeof setTimeout>;
  private readyTimeout: ReturnType<typeof setTimeout>;
  private lifetime: ReturnType<typeof setTimeout>;
  private unsubscribe: () => void;

  constructor(
    private readonly browser: WebSocket,
    private readonly home: HomeStore,
    private readonly knowledge: KnowledgeStore,
    private readonly dependencies: VoiceDependencies,
  ) {
    this.runner = new ToolRunner(home, knowledge);
    this.readyTimeout = setTimeout(
      () => this.fail("GPT Live did not become ready in time. Reconnect."),
      READY_TIMEOUT_MS,
    );
    this.lifetime = setTimeout(
      () =>
        this.fail("This demo voice session has ended. Reconnect to continue."),
      MAX_SESSION_MS,
    );
    this.unsubscribe = home.subscribe((state) =>
      sendEvent(browser, { type: "demo.state", home: state }),
    );
    browser.on("message", (data, binary) => this.fromBrowser(data, binary));
    browser.on("close", () => this.close());
    browser.on("error", () => this.close());
  }

  /**
   * Authenticate server-side and open the configured native Live Agent session.
   *
   * Parameters
   * ----------
   * config : RuntimeConfig
   *     Server-only endpoint and allowlisted Agent selection.
   * options : { language?: Language }
   *     UI language for the opening greeting only.
   *
   * Returns
   * -------
   * Promise<void>
   *     Resolves after the upstream connection attempt has been started.
   */
  async start(
    config: RuntimeConfig,
    { language = "zh" }: { language?: Language } = {},
  ): Promise<void> {
    const model = config.models.find(
      (entry) => entry.id === GPT_LIVE_MODEL_ID && entry.available,
    );
    if (!config.liveProjectEndpoint || !model?.agentName)
      return this.fail("GPT Live is not configured for this deployment.");
    sendEvent(this.browser, { type: "demo.state", home: this.home.snapshot() });
    sendEvent(this.browser, {
      type: "demo.sources",
      sources: this.knowledge.sources(),
    });
    try {
      const token = await this.dependencies.getToken();
      if (this.stopped) return;
      const url = new URL(
        `${config.liveProjectEndpoint.replace("https:", "wss:")}/agents/${encodeURIComponent(model.agentName)}/endpoint/protocols/voice/live/sessions`,
      );
      url.searchParams.set("api-version", "v1");
      url.searchParams.set(
        "structured_inputs",
        JSON.stringify({ welcome_text: homeGreeting(language).text }),
      );
      this.upstream = this.dependencies.connect(
        url.toString(),
        token,
        GPT_LIVE_HEADERS,
      );
      this.upstream.on("message", (data) => this.fromLive(data));
      this.upstream.on("error", () =>
        this.fail(
          "Unable to connect to GPT Live. Check server Azure sign-in and the Agent.",
        ),
      );
      this.upstream.on("unexpected-response", (_request, response) => {
        console.error("GPT Live handshake rejected", {
          status: response.statusCode,
        });
        response.resume();
        this.fail(
          "GPT Live rejected the connection. Check the Agent and Azure permissions.",
        );
      });
      this.upstream.on("close", () =>
        this.fail("The GPT Live connection closed. Reconnect to continue."),
      );
      console.info("Connecting GPT Live Agent", { agent: model.agentName });
    } catch {
      this.fail(
        "Azure authentication failed. Sign in with Azure CLI on the server and retry.",
      );
    }
  }

  private fromBrowser(data: RawData, binary: boolean): void {
    if (binary || !this.upstream)
      return this.rejectInput(
        "Wait for the voice connection to be ready and send JSON events.",
      );
    let event: BrowserEvent;
    try {
      const parsed = browserEvent.safeParse(JSON.parse(data.toString()));
      if (!parsed.success)
        return this.rejectInput("Unsupported voice event or invalid payload.");
      event = parsed.data;
    } catch {
      return this.rejectInput("Voice events must contain valid JSON.");
    }
    if (event.type === "input_audio_buffer.append") {
      if (!this.ready) return;
      if (event.audio.length % 4 !== 0)
        return this.rejectInput("Invalid PCM audio encoding.");
      return this.toLive({
        type: "session.input_audio.append",
        audio: event.audio,
      });
    }
    if (event.type !== "conversation.item.create") return;
    if (!this.ready)
      return this.rejectInput("Wait for the opening greeting to finish.");
    // Typed input goes to the Responses delegation, which GPT Live then speaks.
    this.finishAssistantTranscript();
    this.toLive({
      type: "response.item.create",
      event_id: this.nextId("typed"),
      item: {
        type: "message",
        role: "user",
        content: event.item.content,
      },
    });
    this.toLive({ type: "response.create", event_id: this.nextId("run") });
  }

  private fromLive(data: RawData): void {
    let event: LiveEvent;
    try {
      event = JSON.parse(data.toString()) as LiveEvent;
    } catch {
      return this.fail("GPT Live returned an invalid event.");
    }
    if (typeof event.type !== "string") return;
    if (event.type === "session.started") return this.started();
    if (event.type === "session.output_audio.delta")
      return this.assistantAudio(event);
    if (event.type === "session.output_transcript.delta")
      return this.assistantTranscript(event);
    if (event.type === "session.input_transcript.delta")
      return this.userTranscript(event);
    if (event.type === "response.event") return this.backendEvent(event);
    if (event.type === "error") return this.liveError(event);
    if (event.type === "session.closed")
      this.fail("GPT Live ended this session. Reconnect to continue.");
  }

  private started(): void {
    if (this.sessionStarted) return;
    this.sessionStarted = true;
    clearTimeout(this.readyTimeout);
    // Like the realtime relay, open the microphone only after the greeting so it cannot interrupt it.
    this.greetingFallback = setTimeout(
      () => this.publishReady(),
      GREETING_READY_FALLBACK_MS,
    );
    console.info("GPT Live session started; waiting for its greeting");
  }

  private publishReady(): void {
    if (this.ready || this.stopped) return;
    this.ready = true;
    clearTimeout(this.greetingFallback);
    sendEvent(this.browser, { type: "demo.ready" });
    console.info("GPT Live greeting finished; voice input is ready");
  }

  private assistantAudio(event: LiveEvent): void {
    if (typeof event.delta !== "string") return;
    if (!isSilentPcm(event.delta)) {
      this.silentChunks = 0;
      this.heardSpeech = true;
    } else if (++this.silentChunks === SPEECH_END_SILENT_CHUNKS) {
      this.speechEnded();
    }
    // Live streams paced silence between turns; dropping it lets browser playback finish.
    if (this.silentChunks >= SPEECH_END_SILENT_CHUNKS) return;
    sendEvent(this.browser, {
      type: "response.output_audio.delta",
      item_id: this.ensureAssistantItem(),
      delta: event.delta,
    });
  }

  private assistantTranscript(event: LiveEvent): void {
    if (typeof event.delta !== "string") return;
    const itemId = this.ensureAssistantItem();
    this.assistantText += event.delta;
    sendEvent(this.browser, {
      type: "response.output_audio_transcript.delta",
      item_id: itemId,
      delta: event.delta,
    });
    clearTimeout(this.assistantTimer);
    this.assistantTimer = setTimeout(
      () => this.finishAssistantTranscript(),
      TRANSCRIPT_SETTLE_MS,
    );
  }

  private userTranscript(event: LiveEvent): void {
    if (typeof event.delta !== "string" || !event.delta) return;
    // The first input transcript delta is the earliest user-speech signal Live exposes;
    // speech_started makes the browser drop queued assistant audio.
    if (!this.userItem) {
      this.finishAssistantTranscript();
      this.userItem = this.nextId("user");
      sendEvent(this.browser, { type: "input_audio_buffer.speech_started" });
    }
    this.userText += event.delta;
    clearTimeout(this.userTimer);
    this.userTimer = setTimeout(
      () => this.finishUserTranscript(),
      TRANSCRIPT_SETTLE_MS,
    );
  }

  private speechEnded(): void {
    if (!this.heardSpeech) return;
    this.heardSpeech = false;
    this.finishAssistantTranscript();
    this.publishReady();
  }

  private ensureAssistantItem(): string {
    this.assistantItem ||= this.nextId("assistant");
    return this.assistantItem;
  }

  private finishAssistantTranscript(): void {
    clearTimeout(this.assistantTimer);
    if (!this.assistantItem) return;
    if (this.assistantText.trim())
      sendEvent(this.browser, {
        type: "response.output_audio_transcript.done",
        item_id: this.assistantItem,
        transcript: this.assistantText,
      });
    this.assistantItem = "";
    this.assistantText = "";
  }

  private finishUserTranscript(): void {
    clearTimeout(this.userTimer);
    if (!this.userItem) return;
    sendEvent(this.browser, {
      type: "conversation.item.input_audio_transcription.completed",
      item_id: this.userItem,
      transcript: this.userText.trim(),
    });
    this.userItem = "";
    this.userText = "";
  }

  /** Collect delegated function calls and answer them once their response completes. */
  private backendEvent(event: LiveEvent): void {
    const delegationId = event.delegation_id;
    if (
      typeof delegationId !== "string" ||
      !delegationId ||
      this.stoppedDelegations.has(delegationId)
    )
      return;
    const backend = (event.event ?? {}) as BackendEvent;
    const responseId =
      stringValue(backend.response?.id) ??
      stringValue(backend.response_id) ??
      this.responseIds.get(delegationId);
    if (!responseId) return;
    if (backend.type === "response.created")
      this.responseIds.set(delegationId, responseId);
    const key = `${delegationId}\n${responseId}`;
    if (this.finishedResponses.has(key)) return;
    if (backend.type === "response.output_item.done")
      return this.collectCall(key, backend.item);
    if (
      backend.type === "response.failed" ||
      backend.type === "response.incomplete" ||
      backend.type === "response.cancelled"
    ) {
      this.finishedResponses.add(key);
      const hadCalls = this.pendingCalls.delete(key);
      // A cancelled response is a barge-in; failures after a filler or tool round need feedback.
      if (
        backend.type !== "response.cancelled" &&
        (hadCalls || this.toolRounds.has(delegationId))
      ) {
        console.error("GPT Live delegated response ended early", {
          status: backend.type,
        });
        sendEvent(this.browser, {
          type: "demo.error",
          message:
            "GPT Live could not finish that household request. Please try again.",
        });
      }
      return;
    }
    if (backend.type === "response.completed") {
      this.finishedResponses.add(key);
      const calls = this.pendingCalls.get(key) ?? [];
      this.pendingCalls.delete(key);
      if (calls.length) this.answerCalls(delegationId, calls);
    }
  }

  private collectCall(key: string, item: BackendItem | undefined): void {
    if (
      item?.type !== "function_call" ||
      typeof item.call_id !== "string" ||
      !item.call_id ||
      typeof item.name !== "string" ||
      this.answeredCalls.has(item.call_id)
    )
      return;
    const calls = this.pendingCalls.get(key) ?? [];
    if (calls.some((call) => call.callId === item.call_id)) return;
    calls.push({
      callId: item.call_id,
      name: item.name,
      arguments: typeof item.arguments === "string" ? item.arguments : "{}",
    });
    this.pendingCalls.set(key, calls);
  }

  private answerCalls(delegationId: string, calls: PendingCall[]): void {
    const round = (this.toolRounds.get(delegationId) ?? 0) + 1;
    this.toolRounds.set(delegationId, round);
    if (round > MAX_TOOL_ROUNDS) {
      // Each round has new call IDs, so call-ID deduplication alone cannot stop a loop.
      this.stoppedDelegations.add(delegationId);
      console.error("GPT Live delegation exceeded the tool-round limit", {
        rounds: MAX_TOOL_ROUNDS,
      });
      sendEvent(this.browser, {
        type: "demo.error",
        message:
          "GPT Live stopped a repeated household request. Please try again.",
      });
      return;
    }
    for (const call of calls) {
      this.answeredCalls.add(call.callId);
      this.toLive({
        type: "response.item.create",
        event_id: this.nextId("result"),
        item: {
          type: "function_call_output",
          call_id: call.callId,
          output: this.runTool(call),
        },
      });
    }
    console.info("GPT Live household functions completed", {
      count: calls.length,
    });
    // One continuation after every output, so parallel calls resume the delegation once.
    this.toLive({ type: "response.create", event_id: this.nextId("continue") });
  }

  private runTool(call: PendingCall): string {
    sendEvent(this.browser, {
      type: "demo.tool",
      activity: {
        id: call.callId,
        name: call.name,
        status: "running",
        summary: call.name,
      },
    });
    const result = this.runner.run(call.callId, call.name, call.arguments);
    sendEvent(this.browser, { type: "demo.tool", activity: result.activity });
    if (result.activity.sources)
      sendEvent(this.browser, {
        type: "demo.sources",
        sources: result.activity.sources,
      });
    return result.output;
  }

  private liveError(event: LiveEvent): void {
    const error = event.error as { code?: unknown } | undefined;
    const code =
      typeof error?.code === "string" &&
      /^[a-zA-Z0-9_.-]{1,100}$/.test(error.code)
        ? error.code
        : "upstream_error";
    console.error("GPT Live returned an error", { code });
    if (!this.sessionStarted)
      return this.fail("GPT Live rejected this session. Check the Agent.");
    sendEvent(this.browser, {
      type: "demo.error",
      message: "GPT Live could not complete that request. Please try again.",
    });
  }

  private toLive(event: LiveEvent): void {
    if (this.upstream) sendEvent(this.upstream, event);
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_${this.sequence}`;
  }

  private rejectInput(message: string): void {
    sendEvent(this.browser, { type: "demo.error", message });
  }

  private fail(message: string): void {
    if (this.stopped) return;
    sendEvent(this.browser, { type: "demo.error", message });
    console.error("GPT Live relay ended", { ready: this.ready });
    this.close();
    this.browser.close(1011, "Voice connection ended.");
  }

  private close(): void {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.readyTimeout);
    clearTimeout(this.lifetime);
    clearTimeout(this.assistantTimer);
    clearTimeout(this.userTimer);
    clearTimeout(this.greetingFallback);
    this.unsubscribe();
    if (this.sessionStarted) this.toLive({ type: "session.close" });
    if (this.upstream?.readyState === 0) this.upstream.terminate();
    else this.upstream?.close();
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function isSilentPcm(base64: string): boolean {
  return Buffer.from(base64, "base64").every((byte) => byte === 0);
}
