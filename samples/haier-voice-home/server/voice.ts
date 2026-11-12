/** A constrained browser-to-Foundry relay with local, authoritative function tools. */
import { Agent as HttpsAgent } from "node:https";
import { AzureCliCredential, ManagedIdentityCredential } from "@azure/identity";
import { WebSocket, type RawData } from "ws";
import { z } from "zod";
import type { DemoEvent, Language } from "@shared/protocol";
import type { RuntimeConfig } from "#server/config";
import { HomeStore } from "#server/home";
import { KnowledgeStore } from "#server/knowledge";
import { ToolRunner, tools } from "#server/tools";
import { homeGreeting } from "#server/greeting";
import { HOME_VOICE_NAME } from "#server/voice-profile";
import { homeInstructions } from "#server/instructions";

const READY_TIMEOUT_MS = 45_000; // Bound token acquisition, handshake and session configuration.
const MAX_BACKPRESSURE = 2_000_000; // Close slow consumers instead of growing audio queues without bound.
const MAX_AUDIO_LENGTH = 96_000; // About 1.5 seconds of 24 kHz mono PCM per browser frame.
const MAX_SESSION_MS = 30 * 60 * 1000; // Avoid abandoned billable voice connections.
const MAX_ITEM_ID_LENGTH = 32; // Native realtime rejects longer client-created conversation item IDs.
const REQUIRED_TOOL_MODELS = new Set([
  "microsoft-realtime-flash-1",
  "gpt-realtime-2.1-mini",
]); // Economical realtime models need an explicit policy to use client tools reliably.
const instructions = homeInstructions();
const emptyEvent = z
  .object({
    type: z.enum([
      "input_audio_buffer.commit",
      "input_audio_buffer.clear",
      "response.create",
      "response.cancel",
    ]),
  })
  .strict();
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
          .max(MAX_ITEM_ID_LENGTH)
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
const truncateEvent = z
  .object({
    type: z.literal("conversation.item.truncate"),
    item_id: z.string().min(1).max(200),
    content_index: z.literal(0),
    audio_end_ms: z.number().int().min(0).max(600_000),
  })
  .strict();
const clientEvent = z.union([emptyEvent, audioEvent, textEvent, truncateEvent]);
type BackendEvent = Record<string, unknown> & { type: string };
type BackendResponse = Record<string, unknown> & {
  output?: Record<string, unknown>[];
  status?: string;
};
interface PendingToolCall {
  callId: string;
  name: string;
  arguments: string;
}

// These short confirmations are spoken before a local function is executed.
// The call ID selects a stable variant so repeated intents do not always sound identical.
const TOOL_ACKNOWLEDGEMENTS = ["好。", "收到。", "嗯，好。", "可以。"];

export interface VoiceDependencies {
  getToken: () => Promise<string>;
  connect: (url: string, token: string) => WebSocket;
}

/** Use managed identity in ACA and preserve Azure CLI identity for loopback development. */
export function voiceDependencies(config: RuntimeConfig): VoiceDependencies {
  const credential = process.env.HAIER_PUBLIC_ORIGIN
    ? new ManagedIdentityCredential({ clientId: process.env.AZURE_CLIENT_ID })
    : new AzureCliCredential(
        config.tenantId ? { tenantId: config.tenantId } : {},
      );
  const agent = new HttpsAgent({ proxyEnv: process.env });
  return {
    getToken: async () =>
      (await credential.getToken("https://ai.azure.com/.default")).token,
    connect: (url, token) =>
      new WebSocket(url, {
        headers: { Authorization: `Bearer ${token}` },
        maxPayload: MAX_BACKPRESSURE,
        handshakeTimeout: READY_TIMEOUT_MS,
        perMessageDeflate: false,
        agent,
      }),
  };
}

/** Send JSON only while open, with bounded output buffering. */
export function sendEvent(
  socket: WebSocket,
  event: DemoEvent | BackendEvent,
): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > MAX_BACKPRESSURE) {
    socket.close(1013, "Consumer is too slow.");
    return;
  }
  socket.send(JSON.stringify(event));
}

function sessionUpdate(modelId: string): BackendEvent {
  return {
    type: "session.update",
    session: {
      type: "realtime",
      instructions,
      tools,
      tool_choice: REQUIRED_TOOL_MODELS.has(modelId) ? "required" : "auto",
      output_modalities: ["audio", "text"],
      audio: {
        input: {
          format: { type: "audio/pcm", rate: 24000 },
        },
        output: {
          format: { type: "audio/pcm", rate: 24000 },
          voice: {
            type: "azure-standard",
            name: HOME_VOICE_NAME,
          },
        },
      },
    },
  };
}

/** Relay one session. Browser payloads cannot override instructions, tools or endpoints. */
export class VoiceSession {
  private upstream?: WebSocket;
  private ready = false;
  private configured = false;
  private greetingFinished = false;
  private stopped = false;
  private activeResponse = false;
  private toolAcknowledgementInProgress = false;
  private pendingContinuation = false;
  private continuationInstructions: string[] = [];
  private pendingToolCalls: PendingToolCall[] = [];
  private sentCalls = new Set<string>();
  private runner: ToolRunner;
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
      () =>
        this.fail(
          "The voice service did not become ready in time. Reconnect to retry.",
        ),
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

  /** Authenticate server-side and connect only to the selected allowlisted managed agent. */
  async start(
    config: RuntimeConfig,
    modelId: string,
    { language = "zh" }: { language?: Language } = {},
  ): Promise<void> {
    const model = config.models.find(
      (entry) => entry.id === modelId && entry.available,
    );
    if (!config.projectEndpoint || !model?.agentName)
      return this.fail(
        "The selected model is unavailable or has not passed live verification.",
      );
    sendEvent(this.browser, { type: "demo.state", home: this.home.snapshot() });
    sendEvent(this.browser, {
      type: "demo.sources",
      sources: this.knowledge.sources(),
    });
    try {
      const token = await this.dependencies.getToken();
      if (this.stopped) return;
      const url = new URL(
        `${config.projectEndpoint.replace("https:", "wss:")}/agents/${encodeURIComponent(model.agentName)}/endpoint/protocols/voice`,
      );
      url.searchParams.set("api-version", "v1");
      url.searchParams.set(
        "structured_inputs",
        JSON.stringify({ welcome_text: homeGreeting(language).text }),
      );
      this.upstream = this.dependencies.connect(url.toString(), token);
      this.upstream.on("open", () =>
        sendEvent(this.upstream!, sessionUpdate(modelId)),
      );
      this.upstream.on("message", (data) => this.fromBackend(data));
      this.upstream.on("error", (error: NodeJS.ErrnoException) => {
        console.error("Voice WebSocket transport failed", {
          code: /^[A-Z0-9_]{1,60}$/.test(error.code ?? "")
            ? error.code
            : "WS_ERROR",
        });
        this.fail(
          "Unable to connect to the managed voice service. Check server Azure sign-in and agent deployment.",
        );
      });
      this.upstream.on("unexpected-response", (_request, response) => {
        console.error("Voice WebSocket handshake rejected", {
          status: response.statusCode,
        });
        response.resume();
        this.fail(
          "The managed voice endpoint rejected the connection. Check deployment and Azure permissions.",
        );
      });
      this.upstream.on("close", () =>
        this.fail(
          "The managed voice connection closed. Reconnect to continue.",
        ),
      );
      console.info("Connecting managed Voice Agent", {
        model: modelId,
        agent: model.agentName,
      });
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
    try {
      const event = clientEvent.safeParse(JSON.parse(data.toString()));
      if (!event.success)
        return this.rejectInput("Unsupported voice event or invalid payload.");
      if (
        !this.ready &&
        !(this.configured && event.data.type === "response.cancel")
      )
        return this.rejectInput("Wait for the opening greeting to finish.");
      if (
        event.data.type === "input_audio_buffer.append" &&
        event.data.audio.length % 4 !== 0
      )
        return this.rejectInput("Invalid PCM audio encoding.");
      if (event.data.type === "response.create" && this.activeResponse) return;
      if (event.data.type === "response.cancel" && !this.activeResponse) return;
      if (event.data.type === "response.create") this.activeResponse = true;
      sendEvent(this.upstream, event.data);
    } catch {
      this.rejectInput("Voice events must contain valid JSON.");
    }
  }

  private fromBackend(data: RawData): void {
    try {
      const event = JSON.parse(data.toString()) as BackendEvent;
      if (typeof event.type !== "string") return;
      const suppressTranscript =
        this.toolAcknowledgementInProgress &&
        isAssistantTranscriptEvent(event.type);
      if (event.type === "error") {
        if (
          ["response_cancel_not_active", "response_cancel_not_found"].includes(
            this.errorCode(event),
          )
        ) {
          console.debug("Voice response was already stopped.");
          return;
        }
        console.error("Managed Voice Agent returned an error", {
          code: this.errorCode(event),
          parameter: this.errorParameter(event),
        });
        return this.fail(
          "The managed voice service rejected this session or request. Check server configuration and reconnect.",
        );
      }
      if (
        event.type === "session.updated" &&
        !this.ready &&
        this.isConfigured(event)
      ) {
        this.configured = true;
        this.publishReady();
        console.info(
          "Managed Voice Agent configured; waiting for its opening greeting",
        );
      }
      if (event.type === "response.created") this.activeResponse = true;
      if (event.type === "response.function_call_arguments.done")
        this.functionCall(event);
      if (event.type === "response.done") this.responseDone(event);
      // Session metadata contains server-controlled instructions and tool schemas; keep it private.
      if (!event.type.startsWith("session.") && !suppressTranscript)
        sendEvent(this.browser, event);
    } catch {
      this.fail("The managed voice service returned an invalid event.");
    }
  }

  private functionCall(event: Record<string, unknown>): void {
    const callId = event.call_id;
    if (
      typeof callId !== "string" ||
      typeof event.name !== "string" ||
      typeof event.arguments !== "string"
    )
      return;
    if (this.sentCalls.has(callId)) return;
    this.sentCalls.add(callId);
    this.pendingToolCalls.push({
      callId,
      name: event.name,
      arguments: event.arguments,
    });
  }

  private executePendingToolCalls(): void {
    const calls = this.pendingToolCalls.splice(0);
    for (const call of calls) this.executeToolCall(call);
  }

  private executeToolCall(call: PendingToolCall): void {
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
    sendEvent(this.upstream!, {
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: call.callId,
        output: result.output,
      },
    });
    this.continuationInstructions.push(
      toolContinuationInstruction(call.name, call.arguments, result.output),
    );
    this.pendingContinuation = true;
  }

  private responseDone(event: BackendEvent): void {
    this.activeResponse = false;
    const response = event.response as BackendResponse | undefined;
    if (!this.ready) {
      if (response?.status !== "completed" && response?.status !== "cancelled")
        return this.fail(
          "The opening greeting could not complete. Please reconnect.",
        );
      this.greetingFinished = true;
      this.publishReady();
    }
    if (response?.status === "failed") this.markFailedResponse(event, response);
    if (response?.status === "cancelled" || response?.status === "failed") {
      this.pendingToolCalls = [];
      this.toolAcknowledgementInProgress = false;
      this.pendingContinuation = false;
      return;
    }
    for (const output of response?.output ?? []) {
      if (output.type === "function_call") this.functionCall(output);
    }
    if (this.toolAcknowledgementInProgress) {
      this.toolAcknowledgementInProgress = false;
      this.executePendingToolCalls();
      this.requestToolContinuation();
      return;
    }
    if (this.pendingToolCalls.length > 0) {
      if (responseHasSpokenOutput(response)) {
        this.executePendingToolCalls();
        this.requestToolContinuation();
      } else {
        this.requestToolAcknowledgement();
      }
      return;
    }
    this.requestToolContinuation();
  }

  private requestToolAcknowledgement(): void {
    const phrase = toolAcknowledgement(this.pendingToolCalls[0].callId);
    sendEvent(this.upstream!, {
      type: "response.create",
      response: {
        tool_choice: "none",
        instructions: `If the latest user request is Chinese, repeat verbatim, character for character: "${phrase}" If it is English, say exactly: "Sure." Do not add any other text.`,
      },
    });
    this.toolAcknowledgementInProgress = true;
    this.activeResponse = true;
  }

  private requestToolContinuation(): void {
    if (!this.pendingContinuation) return;
    this.pendingContinuation = false;
    sendEvent(this.upstream!, {
      type: "response.create",
      response: {
        tool_choice: "none",
        instructions: this.continuationInstructions.join("\n"),
      },
    });
    this.continuationInstructions = [];
    this.activeResponse = true;
  }

  private publishReady(): void {
    if (!this.configured || !this.greetingFinished || this.ready) return;
    this.ready = true;
    clearTimeout(this.readyTimeout);
    sendEvent(this.browser, { type: "demo.ready" });
    console.info("Opening greeting finished; voice input is ready");
  }

  private markFailedResponse(
    event: BackendEvent,
    response: BackendResponse,
  ): void {
    event.response = {
      ...response,
      status_details: {
        type: "failed",
        error: {
          code: "voice_response_failed",
          message: "The voice response could not complete.",
        },
      },
    };
    sendEvent(this.browser, {
      type: "demo.error",
      message: "The voice response could not complete. Please try again.",
    });
  }

  private errorCode(event: BackendEvent): string {
    const error = event.error as { code?: unknown } | undefined;
    return typeof error?.code === "string" &&
      /^[a-zA-Z0-9_-]{1,100}$/.test(error.code)
      ? error.code
      : "upstream_error";
  }

  private isConfigured(event: BackendEvent): boolean {
    const session = event.session as
      | {
          instructions?: string;
          tools?: { name?: string }[];
          audio?: {
            output?: { voice?: { name?: string } };
          };
        }
      | undefined;
    return (
      session?.instructions === instructions &&
      tools.every((tool) =>
        session.tools?.some((entry) => entry.name === tool.name),
      ) &&
      session.audio?.output?.voice?.name === HOME_VOICE_NAME
    );
  }

  private errorParameter(event: BackendEvent): string {
    const error = event.error as { param?: unknown } | undefined;
    return typeof error?.param === "string" &&
      /^[a-zA-Z0-9_.[\]]{1,160}$/.test(error.param)
      ? error.param
      : "unspecified";
  }

  private rejectInput(message: string): void {
    sendEvent(this.browser, { type: "demo.error", message });
  }

  private fail(message: string): void {
    if (this.stopped) return;
    sendEvent(this.browser, { type: "demo.error", message });
    console.error("Voice relay ended", { ready: this.ready });
    this.close();
    this.browser.close(1011, "Voice connection ended.");
  }

  private close(): void {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.readyTimeout);
    clearTimeout(this.lifetime);
    this.unsubscribe();
    if (this.upstream?.readyState === WebSocket.CONNECTING)
      this.upstream.terminate();
    else this.upstream?.close();
  }
}

function responseHasSpokenOutput(
  response: BackendResponse | undefined,
): boolean {
  return (response?.output ?? []).some((item) => {
    if (item.type !== "message" || !Array.isArray(item.content)) return false;
    return item.content.some((content) => {
      if (!content || typeof content !== "object") return false;
      const value = content as { text?: unknown; transcript?: unknown };
      return [value.text, value.transcript].some(
        (entry) => typeof entry === "string" && entry.trim().length > 0,
      );
    });
  });
}

function isAssistantTranscriptEvent(type: string): boolean {
  return /^(response\.(audio_transcript|output_audio_transcript|text|output_text)\.(delta|done))$/.test(
    type,
  );
}

function toolAcknowledgement(callId: string): string {
  const index = [...callId].reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  );
  return TOOL_ACKNOWLEDGEMENTS[index % TOOL_ACKNOWLEDGEMENTS.length];
}

function toolContinuationInstruction(
  name: string,
  rawArguments: string,
  rawOutput: string,
): string {
  const completed =
    "The function already succeeded. Speak only about the completed result. Do not narrate a plan or use future-tense phrases such as 我先, 我来, 然后再, I will, or I'll.";
  if (!["control_device", "prepare_media_experience"].includes(name))
    return completed;
  try {
    const command = JSON.parse(rawArguments) as {
      deviceId?: unknown;
      power?: unknown;
    };
    const output = JSON.parse(rawOutput) as {
      home?: { devices?: { id?: string; power?: boolean }[] };
    };
    const televisionIsOn = output.home?.devices?.some(
      (device) => device.id === "tv" && device.power === true,
    );
    if (
      televisionIsOn &&
      (name === "prepare_media_experience" ||
        (command.deviceId === "tv" && command.power !== false))
    )
      return `${completed} If the latest user request is Chinese, repeat verbatim, character for character: "电视打开啦。想轻松一点，可以看看《小城良方》；想看都市爱情，可以试试《折月亮》。" The first sentence MUST be "电视打开啦。" and MUST NOT be changed to "电视已打开。" If it is English, repeat verbatim: "The TV is on. For a relaxed story, try Small Town Remedy; for an urban romance, try Fold the Moon." Do not add any other text.`;
  } catch {
    return completed;
  }
  return completed;
}
