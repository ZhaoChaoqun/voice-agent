/** Same-origin HTTP API and constrained WebSocket upgrade handling for the local demo. */
import { createServer, type Server } from "node:http";
import express, { type ErrorRequestHandler, type Request } from "express";
import { WebSocket, WebSocketServer } from "ws";
import { ZodError } from "zod";
import { demoConfig, type RuntimeConfig } from "#server/config";
import type { CloudAccess, Household } from "#server/cloud";
import {
  commandSchema,
  HomeStore,
  InputError,
  sceneSchema,
} from "#server/home";
import { KnowledgeStore } from "#server/knowledge";
import {
  sendEvent,
  VoiceSession,
  voiceDependencies,
  type VoiceDependencies,
} from "#server/voice";

const JSON_LIMIT = "64kb"; // Bound plain-text uploads and REST requests before parsing.
const WS_LIMIT = 128 * 1024; // Bound browser event parsing, including base64 PCM.
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export interface AppDependencies {
  config: RuntimeConfig;
  home: HomeStore;
  knowledge: KnowledgeStore;
  voice?: VoiceDependencies;
  cloud?: CloudAccess;
}

function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  try {
    return loopbackHosts.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

/** Require a genuine same-origin browser request, including the loopback host and port. */
export function isSameOrigin(
  origin: string | undefined,
  host: string | undefined,
): boolean {
  if (!origin || !isLoopbackHost(host)) return false;
  try {
    const url = new URL(origin);
    return (
      url.protocol === "http:" && url.host === host && url.origin === origin
    );
  } catch {
    return false;
  }
}

/** Build the HTTP and WebSocket servers without binding a port or making network calls. */
export function createDemoServer(dependencies: AppDependencies): {
  app: express.Express;
  server: Server;
  close: () => void;
} {
  const app = express();
  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    });
    next();
  });
  dependencies.cloud?.install(app);
  app.use("/api", (request, response, next) => {
    if (!dependencies.cloud && !isLoopbackHost(request.headers.host))
      return void response
        .status(403)
        .json({ error: "Only local demo hosts are allowed." });
    if (
      request.method !== "GET" &&
      !(dependencies.cloud
        ? dependencies.cloud.sameOrigin(request)
        : isSameOrigin(request.headers.origin, request.headers.host))
    ) {
      return void response
        .status(403)
        .json({ error: "A same-origin request is required." });
    }
    next();
  });
  app.use(
    express.json({ limit: JSON_LIMIT, strict: true, type: "application/json" }),
  );
  addApi(app, dependencies);
  const server = createServer(app);
  const sockets = attachVoice(server, dependencies);
  return {
    app,
    server,
    close: () => {
      for (const socket of sockets.clients) socket.terminate();
      sockets.close();
      server.close();
    },
  };
}

function addApi(app: express.Express, dependencies: AppDependencies): void {
  const { config } = dependencies;
  const household = (request: Request): Household =>
    dependencies.cloud?.household(request) ?? dependencies;
  app.get("/api/health", (_request, response) =>
    response.json({
      status: "ok",
      service: "haier-smart-home",
      simulatedDevices: true,
    }),
  );
  app.get("/api/config", (request, response) => {
    const { home, knowledge } = household(request);
    response.json(demoConfig(config, home, knowledge));
  });
  app.post("/api/devices/control", (request, response) =>
    response.json(
      household(request).home.control(commandSchema.parse(request.body)),
    ),
  );
  app.post("/api/scenes", (request, response) =>
    response.json(
      household(request).home.scene(sceneSchema.parse(request.body).scene),
    ),
  );
  app.post("/api/reset", (request, response) => {
    if (
      request.body !== undefined &&
      (typeof request.body !== "object" ||
        request.body === null ||
        Array.isArray(request.body) ||
        Object.keys(request.body as object).length)
    )
      throw new InputError("Reset does not accept additional fields.");
    response.json(household(request).home.reset());
  });
  app.get("/api/knowledge", (request, response) =>
    response.json(household(request).knowledge.sources()),
  );
  app.post("/api/knowledge", (request, response) =>
    response
      .status(201)
      .json(household(request).knowledge.upload(request.body)),
  );
  app.use("/api", (_request, response) =>
    response.status(404).json({ error: "Unknown API route." }),
  );
  app.use(apiError);
}

const apiError: ErrorRequestHandler = (
  error: unknown,
  _request: Request,
  response,
  _next,
) => {
  if (error instanceof InputError || error instanceof ZodError)
    return void response.status(400).json({
      error:
        error instanceof InputError
          ? error.message
          : "Invalid request fields or values.",
    });
  const status = (error as { status?: number }).status;
  if (status === 413)
    return void response
      .status(413)
      .json({ error: "Request exceeds the 64 KB demo limit." });
  if (error instanceof SyntaxError)
    return void response.status(400).json({ error: "Invalid JSON request." });
  console.error("Demo API operation failed");
  response.status(500).json({
    error: "The demo could not save this change. Check local server storage.",
  });
};

function attachVoice(
  server: Server,
  dependencies: AppDependencies,
): WebSocketServer {
  const voice = dependencies.voice ?? voiceDependencies(dependencies.config);
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: WS_LIMIT,
    perMessageDeflate: false,
  });
  server.on("upgrade", (request, socket, head) => {
    let url: URL;
    try {
      url = new URL(request.url ?? "/", "http://localhost");
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== "/api/voice") return;
    const valid =
      url.pathname === "/api/voice" &&
      (dependencies.cloud
        ? dependencies.cloud.sameOrigin(request) &&
          Boolean(dependencies.cloud.session(request))
        : isSameOrigin(request.headers.origin, request.headers.host));
    if (!valid) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const language = url.searchParams.get("language");
    const model = url.searchParams.get("model");
    if (
      !model ||
      (language !== "zh" && language !== "en") ||
      !dependencies.config.models.some(
        (entry) => entry.id === model && entry.available,
      )
    ) {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      return;
    }
    let household: Household;
    try {
      household = dependencies.cloud?.household(request) ?? dependencies;
    } catch {
      console.error("Could not load persisted voice household");
      socket.end(
        "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n",
      );
      return;
    }
    sockets.handleUpgrade(request, socket, head, (browser: WebSocket) => {
      const { home, knowledge } = household;
      const session = new VoiceSession(browser, home, knowledge, voice);
      void session.start(dependencies.config, model, { language });
    });
  });
  return sockets;
}
