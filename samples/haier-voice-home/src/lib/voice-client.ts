/** Testable, bounded lifecycle for the browser's real-time audio connection. */
import type {
  HomeState,
  KnowledgeSource,
  Language,
  ToolActivity,
} from "@shared/protocol";
import { errorMessage } from "@/lib/api";
import { BrowserAudio } from "@/lib/audio";
import {
  parseEvent,
  type Transcript,
  updateTranscript,
} from "@/lib/conversation";

export type VoiceStatus =
  "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";
export interface VoiceOptions {
  model: string;
  language: Language;
  onHome: (home: HomeState) => void;
}
export interface VoiceSnapshot {
  status: VoiceStatus;
  messages: Transcript[];
  activities: ToolActivity[];
  sources: KnowledgeSource[];
  error: string;
  muted: boolean;
  hasMicrophone: boolean;
}
interface ConnectionGate {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const CONNECT_TIMEOUT_MS = 60_000; // Bound managed-service startup time.
const ACTIVITY_LIMIT = 30; // Keep showroom tool history bounded.

export class VoiceClient {
  private options: VoiceOptions;
  private snapshot: VoiceSnapshot = {
    status: "idle",
    messages: [],
    activities: [],
    sources: [],
    error: "",
    muted: false,
    hasMicrophone: false,
  };
  private listeners = new Set<() => void>();
  private socket: WebSocket | null = null;
  private audio: BrowserAudio | null = null;
  private gate: ConnectionGate | null = null;
  private generation = 0;
  private responseActive = false;
  private queuedText: string | null = null;

  constructor(options: VoiceOptions) {
    this.options = options;
  }

  /** Subscribe without coupling transport code to React. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Return a stable snapshot until an actual state transition. */
  getSnapshot = (): VoiceSnapshot => this.snapshot;

  /** Changing the engine starts a genuinely new conversation. */
  configure(options: VoiceOptions): void {
    if (options.model !== this.options.model) {
      this.stop();
      this.patch({ messages: [], activities: [], sources: [], error: "" });
    }
    this.options = options;
  }

  private patch(update: Partial<VoiceSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...update };
    for (const listener of this.listeners) listener();
  }

  /** Start or reuse a real connection, optionally enabling microphone capture. */
  connect = async (microphone: boolean): Promise<boolean> => {
    const generation = this.generation;
    let startingMicrophone = false;
    try {
      this.audio ??= new BrowserAudio(
        () => this.playbackEnded(),
        (error) => this.eventFailure(error.message),
      );
      await this.audio.initialize();
      if (generation !== this.generation) return false;
      await this.openSocket();
      if (generation !== this.generation) return false;
      if (microphone && !this.snapshot.hasMicrophone) {
        startingMicrophone = true;
        await this.audio?.startCapture((encoded) => this.capture(encoded));
        if (generation !== this.generation) return false;
        this.patch({ hasMicrophone: true, muted: false });
      }
      return true;
    } catch (failure) {
      if (generation !== this.generation) return false;
      this.stop();
      const detail = errorMessage(failure);
      this.patch({
        error: startingMicrophone ? `MICROPHONE_ACCESS: ${detail}` : detail,
        status: "error",
      });
      return false;
    }
  };

  private capture(encoded: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.send({ type: "input_audio_buffer.append", audio: encoded });
    }
  }

  private playbackEnded(): void {
    if (this.snapshot.status === "speaking" && !this.responseActive)
      this.patch({ status: "listening" });
  }

  private openSocket(): Promise<void> {
    if (this.gate) return this.gate.promise;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const query = new URLSearchParams({
      model: this.options.model,
      language: this.options.language,
    });
    const socket = new WebSocket(
      `${protocol}//${location.host}/api/voice?${query}`,
    );
    this.socket = socket;
    this.patch({ status: "connecting", error: "" });
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((success, failure) => {
      resolve = success;
      reject = failure;
    });
    const timer = setTimeout(() => {
      reject(new Error("Voice Agent connection timed out"));
      socket.close();
    }, CONNECT_TIMEOUT_MS);
    this.gate = { promise, resolve, reject, timer };
    this.attachSocket(socket);
    return promise;
  }

  private attachSocket(socket: WebSocket): void {
    socket.onmessage = (message: MessageEvent<string>): void => {
      if (this.socket !== socket) return;
      try {
        this.receive(parseEvent(message.data));
      } catch (failure) {
        this.eventFailure(errorMessage(failure));
      }
    };
    socket.onerror = (): void =>
      this.eventFailure("Could not connect to the voice server");
    socket.onclose = (): void => {
      if (this.socket !== socket) return;
      const connecting = this.snapshot.status === "connecting";
      this.gate?.reject(
        new Error("Voice connection closed before it was ready"),
      );
      this.stop();
      this.patch({
        error: connecting
          ? "Voice connection could not be established"
          : "Voice connection ended. Reconnect to continue.",
        status: "error",
      });
    };
  }

  private receive(event: Record<string, unknown>): void {
    const type = String(event.type);
    if (type === "demo.ready") {
      if (this.gate) clearTimeout(this.gate.timer);
      this.patch({ status: "listening" });
      this.gate?.resolve();
    }
    this.receiveDemo(event);
    this.receiveAudio(event);
    if (type === "response.created") {
      this.responseActive = true;
      this.patch({ status: "thinking" });
    }
    if (type === "response.done") this.responseDone(event);
    if (
      /^(response\.(audio_transcript|output_audio_transcript|text|output_text)\.(delta|done)|conversation\.item\.input_audio_transcription\.completed)$/.test(
        type,
      )
    ) {
      this.receiveTranscript(event);
    }
    if (type === "error" || type === "demo.error") {
      const detail = event.error as { message?: string } | undefined;
      this.eventFailure(
        String(
          event.message ??
            detail?.message ??
            "Voice backend rejected the request",
        ),
      );
    }
  }

  private receiveDemo(event: Record<string, unknown>): void {
    if (event.type === "demo.state" && event.home)
      this.options.onHome(event.home as HomeState);
    if (event.type === "demo.sources" && Array.isArray(event.sources))
      this.patch({ sources: event.sources as KnowledgeSource[] });
    if (event.type === "demo.tool" && event.activity) {
      const activity = event.activity as ToolActivity;
      const activities = [
        ...this.snapshot.activities.filter((item) => item.id !== activity.id),
        activity,
      ];
      this.patch({ activities: activities.slice(-ACTIVITY_LIMIT) });
    }
  }

  private receiveAudio(event: Record<string, unknown>): void {
    if (event.type === "input_audio_buffer.speech_started") {
      this.interrupt();
      this.patch({ status: "listening" });
    }
    if (event.type === "input_audio_buffer.speech_stopped")
      this.patch({ status: "thinking" });
    if (
      event.type === "response.audio.delta" ||
      event.type === "response.output_audio.delta"
    ) {
      if (typeof event.delta === "string")
        this.audio?.play(event.delta, String(event.item_id ?? ""));
      this.patch({ status: "speaking" });
    }
  }

  private receiveTranscript(event: Record<string, unknown>): void {
    const type = String(event.type);
    const role = type.startsWith("conversation.") ? "user" : "assistant";
    const final = type.endsWith(".completed") || type.endsWith(".done");
    const value = final ? (event.transcript ?? event.text) : event.delta;
    if (typeof value !== "string") return;
    const id = String(event.item_id ?? event.response_id ?? "assistant");
    this.patch({
      messages: updateTranscript(this.snapshot.messages, {
        id,
        role,
        text: value,
        final,
      }),
    });
  }

  private responseDone(event: Record<string, unknown>): void {
    this.responseActive = false;
    const response = event.response as
      | { status?: string; status_details?: { error?: { message?: string } } }
      | undefined;
    if (response?.status === "failed")
      this.eventFailure(
        response.status_details?.error?.message ?? "Model response failed",
      );
    if (!this.audio?.isPlaying) this.patch({ status: "listening" });
    if (!this.queuedText) return;
    const next = this.queuedText;
    this.queuedText = null;
    this.submitText(next);
  }

  private eventFailure(message: string): void {
    if (this.gate) clearTimeout(this.gate.timer);
    this.gate?.reject(new Error(message));
    this.patch({ error: message });
  }

  private send(event: Record<string, unknown>): void {
    if (this.socket?.readyState !== WebSocket.OPEN)
      throw new Error("Voice session is not connected");
    this.socket.send(JSON.stringify(event));
  }

  /** Submit user text through the same actual model and tools as spoken input. */
  sendText = async (value: string): Promise<boolean> => {
    const content = value.trim();
    if (!content || !(await this.connect(false))) return false;
    this.patch({ error: "" });
    this.interrupt();
    if (this.responseActive) {
      this.queuedText = content;
      this.send({ type: "response.cancel" });
      return true;
    }
    this.submitText(content);
    return true;
  };

  private submitText(content: string): void {
    const id = crypto.randomUUID().replaceAll("-", "");
    this.patch({
      messages: updateTranscript(this.snapshot.messages, {
        id,
        role: "user",
        text: content,
        final: true,
      }),
      status: "thinking",
    });
    this.send({
      type: "conversation.item.create",
      item: {
        id,
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: content }],
      },
    });
    this.send({ type: "response.create" });
  }

  private interrupt(): void {
    const played = this.audio?.interrupt();
    if (played && this.socket?.readyState === WebSocket.OPEN) {
      this.send({
        type: "conversation.item.truncate",
        item_id: played.itemId,
        content_index: 0,
        audio_end_ms: played.audioMs,
      });
    }
  }

  /** Interrupt sound immediately, then cancel model generation if still active. */
  cancel = (): void => {
    this.interrupt();
    if (this.responseActive && this.socket?.readyState === WebSocket.OPEN)
      this.send({ type: "response.cancel" });
    this.patch({ status: "listening" });
  };

  /** Mute the microphone while keeping the model and playback connected. */
  toggleMute = (): void => {
    this.audio?.setMuted(!this.snapshot.muted);
    this.patch({ muted: !this.snapshot.muted });
  };

  /** Idempotently stop sockets, timeout, pending capture, and queued sound. */
  stop = (): void => {
    this.generation += 1;
    if (this.gate) clearTimeout(this.gate.timer);
    this.gate?.reject(new Error("Voice session stopped"));
    this.gate = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.audio?.close();
    this.audio = null;
    this.responseActive = false;
    this.queuedText = null;
    this.patch({ status: "idle", hasMicrophone: false, muted: false });
  };
}
