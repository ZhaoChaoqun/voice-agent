// Offline stand-ins for the tests: an in-memory Foundry project behind the real Projects SDK
// HTTP pipeline, and a scripted Live WebSocket transport for the page's SDK Live client.
import assert from "node:assert/strict";

export const ENDPOINT = "https://sample.services.ai.azure.com/api/projects/test";
export const ENV = {
  FOUNDRY_PROJECT_ENDPOINT: ENDPOINT,
  GPT_LIVE_DEPLOYMENT: "live-model",
  RESPONSE_DELEGATION_DEPLOYMENT: "text-model",
};
export const credential = {
  getToken: async () => ({ token: "offline-test-token", expiresOnTimestamp: Date.now() + 3_600_000 }),
};

function headers(values) {
  const map = new Map(Object.entries(values));
  return {
    get: (name) => map.get(name.toLowerCase()),
    has: (name) => map.has(name.toLowerCase()),
    set: (name, value) => map.set(name.toLowerCase(), String(value)),
    delete: (name) => map.delete(name.toLowerCase()),
    toJSON: () => Object.fromEntries(map),
    [Symbol.iterator]: () => map.entries(),
  };
}

/** An in-memory Foundry project, passed to the SDK as its httpClient. */
export class OfflineProject {
  constructor(agents = {}, { failVoice = false } = {}) {
    this.agents = new Map(Object.entries(agents)); // name -> { version, definition }
    this.failVoice = failVoice;
    this.requests = [];
    this.created = [];
    this.deleted = [];
  }

  async sendRequest(request) {
    this.requests.push(request);
    const [status, body] = this.handle(request);
    return {
      request,
      status,
      headers: headers({ "content-type": "application/json" }),
      bodyAsText: JSON.stringify(body),
    };
  }

  version(name) {
    const { version, definition } = this.agents.get(name);
    return { object: "agent.version", id: `${name}:${version}`, name, version, created_at: 1, definition };
  }

  handle(request) {
    const path = new URL(request.url).pathname.slice(new URL(ENDPOINT).pathname.length);
    const [collection, name, ...rest] = path.split("/").filter(Boolean).map(decodeURIComponent);
    if (collection === "deployments" && request.method === "GET") {
      return [200, {
        name, type: "ModelDeployment", modelName: name, modelVersion: "1", modelPublisher: "OpenAI",
        capabilities: {}, sku: { name: "GlobalStandard", capacity: 1, family: "", size: "", tier: "" },
      }];
    }
    assert.equal(collection, "agents", `Unexpected request: ${request.method} ${request.url}`);
    if (request.method === "POST" && !name) {
      const body = JSON.parse(request.body);
      if (body.definition.kind === "voice" && this.failVoice) {
        return [400, { error: { code: "test_failure", message: "Test failure." } }];
      }
      this.created.push({ name: body.name, definition: body.definition, features: request.headers.get("foundry-features") });
      this.agents.set(body.name, { version: body.definition.kind === "prompt" ? "7" : "3", definition: body.definition });
      return [200, { object: "agent", id: body.name, name: body.name, versions: { latest: this.version(body.name) } }];
    }
    if (request.method === "DELETE") {
      this.deleted.push(name);
      return [200, { object: "agent.deleted", name, deleted: true }];
    }
    if (!this.agents.has(name)) return [404, { error: { code: "not_found", message: "Agent not found." } }];
    if (rest[0] === "versions") return [200, this.version(name)];
    return [200, { object: "agent", id: name, name, versions: { latest: this.version(name) } }];
  }

  deploymentChecks() {
    return this.requests
      .filter((request) => request.url.includes("/deployments/"))
      .map((request) => new URL(request.url).pathname.split("/").pop());
  }
}

let eventCount = 0;
const event = (type, fields) => ({ type, event_id: `event-${++eventCount}`, ...fields });
const SESSION = { id: "live_offline", audio: { format: { type: "audio/pcm", rate: 24000 } } };
/** A managed session's delegation snapshot; the SDK refuses Responses commands for it. */
export const MANAGED = { type: "foundry_managed_agent", agent_name: "prompt", agent_version: "7" };

/** Live server events with the fields the SDK validates. */
export const live = {
  started: (conversationId, delegation) =>
    event("session.started", {
      session: delegation ? { ...SESSION, delegation } : SESSION,
      conversation_id: conversationId,
    }),
  user: (delta) => event("session.input_transcript.delta", { delta, start_ms: 0, end_ms: 100 }),
  teacher: (delta) => event("session.output_transcript.delta", { delta, start_ms: 100, end_ms: 200 }),
  audio: (pcm) => ({ type: "session.output_audio.delta", delta: Buffer.from(pcm).toString("base64") }),
  delegation: (id, target) =>
    event("session.delegation.created", { delegation: { id, type: "delegation", target }, offset_ms: 1000 }),
  backend: (id, type, fields = {}) => event("response.event", { delegation_id: id, event: { type, ...fields } }),
  commentary: () => event("session.commentary.appended", { start_ms: 200, end_ms: 400 }),
  closed: (reason) => event("session.closed", { session: SESSION, reason, usage: { seconds: 1 } }),
};

/**
 * A scripted Live endpoint for the SDK's webSocketFactory: sends session.started after the
 * upgrade and the remaining events once the client is ready, records client commands, and
 * answers session.close with session.closed. respond(command) returns any events to send back.
 */
export class ScriptedLive {
  constructor(events = [], { delayMs = 20, respond = () => [] } = {}) {
    this.respond = respond;
    this.events = events;
    this.delayMs = delayMs;
    this.connects = [];
    this.received = [];
  }

  create() {
    let handlers;
    let closed = false;
    const finish = (code) => {
      if (closed) return;
      closed = true;
      setImmediate(() => handlers.onClose(code, "", true));
    };
    const play = (payloads) => {
      for (const payload of payloads) {
        if (closed) return;
        handlers.onMessage(JSON.stringify(payload));
        if (payload.type === "session.closed") finish(1000);
      }
    };
    return {
      setHandlers: (value) => {
        handlers = value;
      },
      connect: async (options) => {
        this.connects.push(options);
        const [first, ...rest] = this.events;
        setImmediate(() => play(first ? [first] : []));
        setTimeout(() => play(rest), this.delayMs);
      },
      send: async (data) => {
        const command = JSON.parse(data);
        this.received.push(command);
        setImmediate(() => play(this.respond(command)));
        if (command.type === "session.close" && !closed) {
          play([live.closed("close_requested")]);
          finish(1000);
        }
      },
      close: async (code) => finish(code),
    };
  }

  commands() {
    return this.received.map((command) => command.type);
  }
}

/** SDK client options that route the server's REST calls to `project`. */
export const clientOptions = (project) => ({ httpClient: project });
