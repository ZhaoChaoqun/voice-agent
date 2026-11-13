/** Loopback WebRTC model-mode lab with a server-owned control channel. */
import "dotenv/config";
import { Agent as HttpsAgent } from "node:https";
import { pathToFileURL } from "node:url";

import {
  AzureCliCredential,
  ManagedIdentityCredential,
  type TokenCredential,
} from "@azure/identity";
import express from "express";
import { WebSocket, type RawData } from "ws";
import { z } from "zod";
import { VOICE_MODEL_IDS } from "@shared/protocol";
import { isSameOrigin } from "#server/app";

const API_VERSION = "2026-07-15";
const CONNECT_TIMEOUT_MS = 60_000; // Bound token acquisition, WebSocket upgrade and SDP negotiation.
const MAX_SDP_LENGTH = 256 * 1024; // Match the MediaGateway control-message limit.
const MAX_TEXT_LENGTH = 4_000; // Bound benchmark text turns.
const ALLOWED_MODELS = new Set<string>(VOICE_MODEL_IDS);
const sessionRequestSchema = z
  .object({ sdpOffer: z.string().min(1).max(MAX_SDP_LENGTH) })
  .strict();
const turnRequestSchema = z
  .object({ text: z.string().trim().min(1).max(MAX_TEXT_LENGTH) })
  .strict();

export interface WebRtcBenchmarkConfig {
  endpoint: string;
  model: string;
  host: string;
  port: number;
  tenantId?: string;
  clientId?: string;
}

interface BenchmarkSession {
  socket: WebSocket;
}

/**
 * Validate the explicitly supplied Voice Live endpoint for the benchmark.
 *
 * Parameters
 * ----------
 * env : NodeJS.ProcessEnv
 *     Process environment supplied by local development or ACA.
 *
 * Returns
 * -------
 * WebRtcBenchmarkConfig
 *     Validated server-only benchmark settings.
 */
export function webRtcBenchmarkConfig(
  env: NodeJS.ProcessEnv = process.env,
): WebRtcBenchmarkConfig {
  const endpoint = env.VOICE_LIVE_ENDPOINT?.replace(/\/$/, "") ?? "";
  const model = env.WEBRTC_MODEL ?? "microsoft-realtime-flash-1";
  if (!/^https:\/\/[a-zA-Z0-9-]+\.services\.ai\.azure\.com$/.test(endpoint))
    throw new Error(
      "VOICE_LIVE_ENDPOINT must be an Azure AI Services HTTPS origin.",
    );
  if (!ALLOWED_MODELS.has(model))
    throw new Error("WEBRTC_MODEL is not an approved benchmark model.");
  const host = env.HOST ?? "127.0.0.1";
  if (!["127.0.0.1", "localhost", "::1", "0.0.0.0"].includes(host))
    throw new Error("HOST must be loopback or 0.0.0.0.");
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error("PORT must be a valid TCP port.");
  return {
    endpoint,
    model,
    host,
    port,
    tenantId: env.AZURE_TENANT_ID,
    clientId: env.AZURE_CLIENT_ID,
  };
}

/**
 * Build the authenticated MediaGateway WebRTC control-channel URL.
 *
 * Parameters
 * ----------
 * config : WebRtcBenchmarkConfig
 *     Validated benchmark configuration.
 *
 * Returns
 * -------
 * string
 *     WebSocket URL for model-mode SDP and control events.
 */
export function mediaGatewayUrl(config: WebRtcBenchmarkConfig): string {
  const url = new URL(
    `${config.endpoint.replace("https:", "wss:")}/voice-live/realtime/calls`,
  );
  url.searchParams.set("api-version", API_VERSION);
  url.searchParams.set("model", config.model);
  return url.toString();
}

/**
 * Return the initial model-mode session update used by both benchmark variants.
 *
 * Returns
 * -------
 * Record<string, unknown>
 *     Preview Voice Live configuration sent over the sideband channel.
 */
export function benchmarkSessionUpdate(): Record<string, unknown> {
  return {
    type: "session.update",
    session: {
      instructions:
        "You are Home Companion, a concise home assistant. Match the user's language and answer directly.",
      tool_choice: "none",
      turn_detection: {
        type: "azure_semantic_vad",
        profile: "normal",
        auto_truncate: true,
        create_response: true,
        interrupt_response: true,
        remove_filler_words: false,
      },
      voice: {
        type: "azure-standard",
        name: "zh-CN-Xiaoxiao:DragonHDFlashLatestNeural",
      },
    },
  };
}

function credential(config: WebRtcBenchmarkConfig): TokenCredential {
  if (config.clientId)
    return new ManagedIdentityCredential({ clientId: config.clientId });
  return new AzureCliCredential(
    config.tenantId ? { tenantId: config.tenantId } : {},
  );
}

function sameOrigin(request: express.Request): boolean {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === "https:" || isSameOrigin(origin, host)) &&
      parsed.host === host
    );
  } catch {
    return false;
  }
}

async function openSocket(
  config: WebRtcBenchmarkConfig,
  token: string,
): Promise<WebSocket> {
  const socket = new WebSocket(mediaGatewayUrl(config), ["realtime"], {
    headers: { Authorization: ["Bearer", token].join(" ") },
    handshakeTimeout: CONNECT_TIMEOUT_MS,
    perMessageDeflate: false,
    agent: new HttpsAgent({ proxyEnv: process.env }),
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("MediaGateway connection timed out.")),
      CONNECT_TIMEOUT_MS,
    );
    socket.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return socket;
}

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: RawData): void => {
      cleanup();
      try {
        resolve(JSON.parse(data.toString()) as Record<string, unknown>);
      } catch {
        reject(new Error("MediaGateway returned invalid JSON."));
      }
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error("MediaGateway closed during session setup."));
    };
    const cleanup = (): void => {
      socket.off("message", onMessage);
      socket.off("close", onClose);
    };
    socket.once("message", onMessage);
    socket.once("close", onClose);
  });
}

async function waitForType(
  socket: WebSocket,
  type: string,
): Promise<Record<string, unknown>> {
  while (true) {
    const event = await nextMessage(socket);
    if (event.type === "error")
      throw new Error(
        String(
          (event.error as { message?: unknown } | undefined)?.message ??
            "MediaGateway rejected the session.",
        ),
      );
    if (event.type === type) return event;
  }
}

async function createSession(
  config: WebRtcBenchmarkConfig,
  getToken: () => Promise<string>,
  sdpOffer: string,
): Promise<{ id: string; sdpAnswer: string; session: BenchmarkSession }> {
  const socket = await openSocket(config, await getToken());
  const timer = setTimeout(() => socket.terminate(), CONNECT_TIMEOUT_MS);
  try {
    socket.send(
      JSON.stringify({ type: "rtc.call.sdp.create", sdp_offer: sdpOffer }),
    );
    const created = await waitForType(socket, "rtc.call.sdp.created");
    socket.send(JSON.stringify(benchmarkSessionUpdate()));
    await waitForType(socket, "session.updated");
    const id = String(created.rtc_call_id ?? "");
    const sdpAnswer = String(created.sdp_answer ?? "");
    if (!id || !sdpAnswer)
      throw new Error("MediaGateway returned an incomplete SDP answer.");
    return { id, sdpAnswer, session: { socket } };
  } catch (error) {
    socket.close();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function startServer(): void {
  const config = webRtcBenchmarkConfig();
  const identity = credential(config);
  const getToken = async (): Promise<string> => {
    const accessToken = await identity.getToken(
      "https://ai.azure.com/.default",
    );
    if (!accessToken)
      throw new Error("Azure authentication returned no token.");
    return accessToken.token;
  };
  const sessions = new Map<string, BenchmarkSession>();
  const app = express();
  app.disable("x-powered-by");
  app.use((request, response, next) => {
    const host = request.headers.host;
    const loopbackOnly = config.host !== "0.0.0.0";
    if (
      !host ||
      (loopbackOnly && !isSameOrigin(`http://${host}`, host)) ||
      (request.method !== "GET" && !sameOrigin(request))
    )
      return void response
        .status(403)
        .json({ error: "Same-origin request required." });
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  app.use(express.json({ limit: "512kb", strict: true }));
  app.get("/api/health", (_request, response) =>
    response.json({ status: "ok", transport: "webrtc", model: config.model }),
  );
  app.get("/api/config", (_request, response) =>
    response.json({ transport: "webrtc", model: config.model }),
  );
  app.post("/api/sessions", async (request, response) => {
    if (!sameOrigin(request))
      return void response.status(403).json({ error: "Same origin required." });
    if (sessions.size >= 10)
      return void response
        .status(503)
        .json({ error: "Lab session capacity reached." });
    try {
      const { sdpOffer } = sessionRequestSchema.parse(request.body);
      const created = await createSession(config, getToken, sdpOffer);
      sessions.set(created.id, created.session);
      const expiry = setTimeout(
        () => created.session.socket.close(),
        15 * 60_000,
      );
      created.session.socket.once("close", () => {
        clearTimeout(expiry);
        sessions.delete(created.id);
      });
      response.json({ sessionId: created.id, sdpAnswer: created.sdpAnswer });
    } catch (error) {
      console.error("WebRTC session creation failed");
      response.status(error instanceof z.ZodError ? 400 : 502).json({
        error:
          error instanceof z.ZodError
            ? "Invalid SDP offer."
            : "WebRTC setup failed. Check service availability and server configuration.",
      });
    }
  });
  app.post("/api/sessions/:id/turns", (request, response) => {
    if (!sameOrigin(request))
      return void response.status(403).json({ error: "Same origin required." });
    const session = sessions.get(request.params.id);
    if (!session || session.socket.readyState !== WebSocket.OPEN)
      return void response.status(404).json({ error: "Session not found." });
    const { text } = turnRequestSchema.parse(request.body);
    session.socket.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }],
        },
      }),
    );
    session.socket.send(JSON.stringify({ type: "response.create" }));
    response.json({ accepted: true });
  });
  app.delete("/api/sessions/:id", (request, response) => {
    sessions.get(request.params.id)?.socket.close();
    sessions.delete(request.params.id);
    response.json({ closed: true });
  });
  app.use("/api", (_request, response) =>
    response.status(404).json({ error: "Not found." }),
  );
  app.use(((error, _request, response, _next) => {
    console.error("WebRTC request failed");
    response
      .status(error instanceof z.ZodError ? 400 : 500)
      .json({ error: "Invalid request or lab operation failed." });
  }) satisfies express.ErrorRequestHandler);
  app.use(
    express.static(new URL("../webrtc-benchmark", import.meta.url).pathname),
  );
  app.use((_request, response) =>
    response.sendFile(
      new URL("../webrtc-benchmark/index.html", import.meta.url).pathname,
    ),
  );
  const server = app.listen(config.port, config.host, () =>
    console.info("Smart Home WebRTC benchmark ready", {
      host: config.host,
      port: config.port,
      model: config.model,
    }),
  );
  const close = (): void => {
    for (const session of sessions.values()) session.socket.close();
    server.close();
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  startServer();
