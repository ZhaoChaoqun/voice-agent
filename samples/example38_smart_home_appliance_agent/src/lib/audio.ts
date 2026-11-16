/** Browser microphone capture, ordered PCM playback, and interruption cleanup. */
import captureUrl from "@/lib/capture-worklet.ts?worker&url";
import { decodePcm, encodePcm, SAMPLE_RATE } from "@/lib/pcm";

// Playback gets a short lead to absorb transport jitter without a large delay.
const PLAYBACK_LEAD_SECONDS = 0.045;
const CAPTURE_START_TIMEOUT_MS = 5_000; // Report a stalled microphone graph instead of showing false readiness.

export class BrowserAudio {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private capture: AudioWorkletNode | null = null;
  private input: MediaStreamAudioSourceNode | null = null;
  private silentOutput: GainNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private itemStart = 0;
  private currentItem = "";
  private itemDuration = 0;
  private muted = false;
  private disposed = false;
  private captureTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly onPlaybackEnd: () => void,
    private readonly onError: (error: Error) => void,
  ) {}

  get isPlaying(): boolean {
    return this.sources.size > 0;
  }

  /** Initialize playback in a user gesture, including text-initiated sessions. */
  async initialize(): Promise<void> {
    if (this.disposed) throw new Error("Audio session closed");
    this.context ??= new AudioContext({ sampleRate: SAMPLE_RATE });
    await this.context.resume();
  }

  /** Capture the microphone with browser echo cancellation and noise reduction. */
  async startCapture(send: (encoded: string) => void): Promise<void> {
    if (this.stream) return;
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error("AUDIO_UNSUPPORTED");
    await this.initialize();
    const context = this.context;
    if (!context) throw new Error("Audio context not initialized");
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    if (this.disposed) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
      throw new Error("Audio session closed");
    }
    await context.audioWorklet.addModule(captureUrl);
    if (this.disposed) throw new Error("Audio session closed");
    this.capture = new AudioWorkletNode(context, "pcm-capture");
    this.input = context.createMediaStreamSource(this.stream);
    this.silentOutput = context.createGain();
    this.silentOutput.gain.value = 0;
    this.capture.port.onmessage = (event: MessageEvent<ArrayBuffer>): void => {
      if (this.captureTimer) clearTimeout(this.captureTimer);
      this.captureTimer = null;
      if (!this.muted) send(encodePcm(new Uint8Array(event.data)));
    };
    this.capture.onprocessorerror = (): void =>
      this.onError(new Error("Microphone audio processor failed"));
    this.captureTimer = setTimeout(
      () =>
        this.onError(
          new Error(
            "Microphone audio capture did not start. Check the browser audio device.",
          ),
        ),
      CAPTURE_START_TIMEOUT_MS,
    );
    this.input
      .connect(this.capture)
      .connect(this.silentOutput)
      .connect(context.destination);
  }

  /** Play one backend audio delta and preserve sample ordering. */
  play(encoded: string, itemId: string): void {
    const context = this.context;
    if (!context) return;
    const samples = decodePcm(encoded);
    const buffer = context.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.copyToChannel(new Float32Array(samples), 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    this.nextTime = Math.max(
      this.nextTime,
      context.currentTime + PLAYBACK_LEAD_SECONDS,
    );
    if (itemId !== this.currentItem) {
      this.currentItem = itemId;
      this.itemStart = this.nextTime;
      this.itemDuration = 0;
    }
    this.itemDuration += buffer.duration;
    source.start(this.nextTime);
    this.nextTime += buffer.duration;
    this.sources.add(source);
    source.onended = (): void => {
      this.sources.delete(source);
      source.disconnect();
      if (this.sources.size === 0) this.onPlaybackEnd();
    };
  }

  /** Stop queued sound and return only the portion actually heard. */
  interrupt(): { itemId: string; audioMs: number } | null {
    const elapsed = (this.context?.currentTime ?? 0) - this.itemStart;
    const audioMs = Math.floor(
      Math.max(0, Math.min(elapsed, this.itemDuration)) * 1000,
    );
    const interrupted =
      this.currentItem && this.sources.size > 0
        ? { itemId: this.currentItem, audioMs }
        : null;
    for (const source of this.sources) source.stop();
    this.sources.clear();
    this.nextTime = 0;
    this.currentItem = "";
    return interrupted;
  }

  /** Silence capture without changing playback or the conversation. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    for (const track of this.stream?.getAudioTracks() ?? [])
      track.enabled = !muted;
  }

  /** Release every media track and audio node when ending or replacing a session. */
  close(): void {
    this.disposed = true;
    if (this.captureTimer) clearTimeout(this.captureTimer);
    this.captureTimer = null;
    this.interrupt();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.capture?.disconnect();
    this.input?.disconnect();
    this.silentOutput?.disconnect();
    this.capture = null;
    this.input = null;
    this.stream = null;
    this.silentOutput = null;
    const context = this.context;
    this.context = null;
    if (context) void context.close();
  }
}
