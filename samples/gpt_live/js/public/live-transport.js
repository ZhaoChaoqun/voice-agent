// Opens GPT Live sessions straight from the page with the SDK's VoiceAgentLiveClient, over a
// browser WebSocket transport the sample supplies through the public webSocketFactory option.
//
// Browsers cannot set WebSocket handshake headers, so the transport does what the SDK's own browser
// transport does. It moves the SDK's access token into the subprotocol list, offering "live" and
// "authorization.bearer.<token>"; Foundry turns that offer into an Authorization header for the
// Live route and selects only "live". It sends the Foundry-Features: VoiceAgents=V1Preview header
// as the foundry_features query parameter.
//
// Keeping the transport also lets the sample send local function results: in Foundry-managed
// delegation they go back to the prompt agent with response.item.create and response.create,
// as the Python tools sample does. This preview JS SDK refuses both commands unless the session
// uses Responses delegation, so the sample sends those two directly on the same socket.
// Everything else goes through the SDK connection.
import { VoiceAgentLiveClient } from "@azure/ai-projects";

export const LIVE_SUBPROTOCOL = "live";
const BEARER_OFFER = "authorization.bearer.";
/** Handshake headers a page cannot send, and the query parameters Foundry accepts instead. */
const HEADER_QUERY_PARAMETERS = {
  "foundry-features": "foundry_features",
  "x-ms-client-request-id": "client-request-id",
};

/** Moves the SDK's preview and request-ID headers into the Live URL, as the SDK's browser transport does. */
export function browserLiveUrl(url, headers = {}) {
  const target = new URL(url);
  for (const [name, value] of Object.entries(headers)) {
    const parameter = HEADER_QUERY_PARAMETERS[name.toLowerCase()];
    if (parameter) target.searchParams.set(parameter, value);
  }
  return target.toString();
}

/** The SDK's Live transport for browsers: a WebSocket that authenticates with a subprotocol offer. */
export class BrowserWebSocketTransport {
  setHandlers(handlers) {
    this.handlers = handlers;
  }

  async connect({ url, headers, connectionTimeoutInMs, abortSignal }) {
    // The SDK builds "authorization: Bearer <token>"; its other headers cannot be sent from a page.
    const token = /^Bearer (\S+)$/.exec(headers?.authorization ?? "")?.[1];
    if (!token) throw new Error("The SDK supplied no bearer token for the Live handshake.");
    if (abortSignal?.aborted) throw new Error("WebSocket connection was cancelled.");
    const socket = new WebSocket(browserLiveUrl(url, headers), [LIVE_SUBPROTOCOL, BEARER_OFFER + token]);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.addEventListener("message", (event) => this.handlers?.onMessage(event.data));
    socket.addEventListener("close", (event) => this.handlers?.onClose(event.code, event.reason, event.wasClean));
    // Browser error events carry no details; a close event with its code follows.
    socket.addEventListener("error", () => this.handlers?.onError(new Error("The GPT Live WebSocket failed.")));
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => fail(new Error(`WebSocket connection timed out after ${connectionTimeoutInMs}ms.`)),
        connectionTimeoutInMs,
      );
      const onAbort = () => fail(new Error("WebSocket connection was cancelled."));
      const onOpen = () => {
        settle();
        resolve();
      };
      // Browsers hide the HTTP status of a refused upgrade; it surfaces as an error or close
      // before open.
      const onRefused = () =>
        fail(
          new Error(
            "Foundry refused the GPT Live WebSocket. Check az login, project access, and that " +
              "the service accepts browser sign-in for Live sessions.",
          ),
        );
      function settle() {
        clearTimeout(timeout);
        abortSignal?.removeEventListener("abort", onAbort);
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onRefused);
        socket.removeEventListener("close", onRefused);
      }
      function fail(error) {
        settle();
        if (socket.readyState !== WebSocket.CLOSED) socket.close();
        reject(error);
      }
      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onRefused);
      socket.addEventListener("close", onRefused);
      abortSignal?.addEventListener("abort", onAbort);
    });
    // Foundry selects only "live" and never echoes the credential offer.
    if (socket.protocol !== LIVE_SUBPROTOCOL) {
      socket.close();
      throw new Error(`Foundry did not select the '${LIVE_SUBPROTOCOL}' WebSocket subprotocol.`);
    }
  }

  async send(data) {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error("WebSocket is not connected.");
    this.socket.send(data);
  }

  async close(code, reason) {
    const socket = this.socket;
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    // Browsers only send 1000 or 3000-4999; the SDK may ask for others, such as 1002.
    const browserCode = code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000;
    // Best effort: give the close handshake 5 seconds.
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 5000);
      socket.addEventListener(
        "close",
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
      socket.close(browserCode, reason?.slice(0, 120));
    });
  }
}

export const browserWebSocketFactory = { create: () => new BrowserWebSocketTransport() };

/**
 * A token credential for the page: the local server returns an access token for Foundry from
 * your az login session (see GET /token in ../server.mjs).
 */
export const serverCredential = {
  async getToken() {
    const response = await fetch("/token", { method: "POST", cache: "no-store" });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  },
};

/**
 * Opens a Live session for `agent` and resolves once Foundry sends session.started, with
 * the SDK connection and sendRaw(event), which sends a client command on the same socket.
 * The SDK sends `structuredInputs` as JSON in the handshake URL; Foundry fills them into the
 * agent's instructions and greeting.
 */
export async function openLiveSession(
  { endpoint, credential = serverCredential, webSocketFactory = browserWebSocketFactory, structuredInputs },
  agent,
) {
  let transport;
  const live = new VoiceAgentLiveClient(endpoint, credential, {
    webSocketFactory: { create: () => (transport = webSocketFactory.create()) },
  });
  const connection = await live.connect(agent.name, {
    agentVersionOverride: agent.version,
    structuredInputs,
  });
  return { connection, sendRaw: (event) => transport.send(JSON.stringify(event)) };
}
