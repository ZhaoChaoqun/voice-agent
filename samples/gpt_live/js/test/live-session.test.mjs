// Offline tests for the page's GPT Live session: the real Projects SDK Live client talks to a
// scripted Live endpoint, and the test stands in for the page's UI and microphone.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { FALLBACK } from "../public/client-backend.js";
import { LiveSession } from "../public/live-session.js";
import { DATETIME_TOOL_NAME } from "../public/local-tools.js";
import { openLiveSession } from "../public/live-transport.js";
import { ENDPOINT, MANAGED, ScriptedLive, credential, live } from "./offline.mjs";

const MICROPHONE = new Uint8Array(4800).map((_, index) => index % 256);
const RESPONSES_AGENT = { name: "teacher", version: "3", managedDelegation: false, backendModel: "text-model" };
const MANAGED_AGENT = { name: "teacher-live", version: "3", managedDelegation: true, backendModel: "prompt:7" };
const CLIENT_AGENT = {
  name: "teacher-client", version: "3", managedDelegation: false, clientDelegation: true, backendModel: "this page",
};
/** Long enough for the page to wait for a quiet transcript and answer a client delegation. */
const ANSWER_MS = 1500;

/**
 * Runs one session as the page does: on "ready" it sends one microphone chunk (an
 * ArrayBuffer, as the AudioWorklet posts), then stops once the scripted events have arrived.
 */
async function runSession({ agent = RESPONSES_AGENT, events = [], stopAfterMs = 80, openLive, respond, typed = [] } = {}) {
  const scripted = new ScriptedLive(events, { respond });
  const messages = [];
  const session = new LiveSession({
    openLive: openLive ?? ((target) => openLiveSession({ endpoint: ENDPOINT, credential, webSocketFactory: scripted }, target)),
    agent,
    onMessage: async (message) => {
      messages.push(message);
      if (message.type === "ready") {
        session.sendAudio(MICROPHONE.buffer);
        for (const text of typed) await session.sendText(text);
        await sleep(stopAfterMs);
        session.stop();
      }
    },
  });
  const result = await session.run();
  return { result, messages, scripted };
}

const ofType = (messages, type) => messages.filter((message) => message.type === type);

describe("Responses delegation session", () => {
  it("streams microphone audio and shows transcripts, delegation, and teacher audio", async () => {
    const { result, messages, scripted } = await runSession({
      events: [
        live.started("conversation-1"),
        live.user("I goed to school."),
        live.delegation("delegation-1", "responses"),
        live.backend("delegation-1", "response.created"),
        live.backend("delegation-1", "response.output_text.delta", { delta: "Say: I went." }),
        live.backend("delegation-1", "response.completed"),
        live.teacher("I went to school."),
        live.audio([1, 2, 3, 4]),
      ],
    });

    assert.equal(ofType(messages, "ready")[0].conversationId, "conversation-1");
    assert.deepEqual(ofType(messages, "transcript"), [
      { type: "transcript", role: "user", delta: "I goed to school." },
      { type: "transcript", role: "teacher", delta: "I went to school." },
    ]);
    assert.deepEqual(
      ofType(messages, "delegation").map(({ status, delta }) => [status, delta ?? ""]),
      [
        ["Delegation requested", ""],
        ["Backend response started", ""],
        ["Receiving backend guidance", "Say: I went."],
        ["Backend response completed", ""],
      ],
    );
    assert.equal(ofType(messages, "delegation")[0].title, "Delegation → text-model");
    assert.deepEqual(ofType(messages, "audio"), [{ type: "audio", delta: Buffer.from([1, 2, 3, 4]).toString("base64") }]);
    assert.deepEqual(ofType(messages, "closed"), [
      { type: "closed", conversationId: "conversation-1", closeReason: "close_requested", usageSeconds: 1 },
    ]);
    assert.equal(result.failure, undefined);
    // Raw page PCM reaches the service base64-encoded; the page then closes gracefully.
    assert.deepEqual(
      scripted.received.filter((command) => command.type === "session.input_audio.append").map((command) => command.audio),
      [Buffer.from(MICROPHONE).toString("base64")],
    );
    assert.equal(scripted.commands().at(-1), "session.close");
  });

  it("answers a client delegation with commentary tied to its ID", async () => {
    const { scripted } = await runSession({ events: [live.started("c"), live.delegation("delegation-client", "client")] });
    const commentary = scripted.received.filter((command) => command.type === "session.commentary.append");
    assert.equal(commentary.length, 1);
    assert.equal(commentary[0].delegation_id, "delegation-client");
  });

  it("reports a backend failure or a lost upstream connection and ends the session", async () => {
    for (const [events, message] of [
      [[live.started("c"), live.delegation("d", "responses"), live.backend("d", "response.failed")], /response\.failed/],
      [[live.started("c"), live.closed("connection_lost")], /connection was lost/],
    ]) {
      const { result, messages } = await runSession({ events, stopAfterMs: 500 });
      assert.match(ofType(messages, "error")[0].message, message);
      assert.equal(ofType(messages, "closed").length, 1);
      assert.ok(result.failure);
    }
  });

  it("shows why the connection failed, including the cause the SDK wraps", async () => {
    const refused = Object.assign(new Error("Failed to connect to the Live voice agent."), {
      name: "VoiceAgentConnectionError",
      cause: new Error("Foundry refused the GPT Live WebSocket."),
    });
    const { messages } = await runSession({ openLive: async () => Promise.reject(refused) });
    assert.deepEqual(ofType(messages, "error"), [
      {
        type: "error",
        message: "VoiceAgentConnectionError: Failed to connect to the Live voice agent. Foundry refused the GPT Live WebSocket.",
      },
    ]);
    assert.equal(messages.at(-1).type, "closed");
  });
});

describe("client delegation session", () => {
  const delegated = (said) => [
    live.started("conversation-client"),
    live.user(said),
    live.delegation("delegation-client", "client"),
  ];
  const replies = (scripted) =>
    scripted.received.filter((command) => /^session\.(thinking|commentary)\.append$/.test(command.type));

  it("answers from what the learner said with thinking and commentary tied to the delegation", async () => {
    const { result, messages, scripted } = await runSession({
      agent: CLIENT_AGENT,
      events: delegated("What is seventeen plus twenty five?"),
      stopAfterMs: ANSWER_MS,
    });
    assert.equal(result.failure, undefined);
    assert.deepEqual(replies(scripted), [
      { type: "session.thinking.append", content: "The client app computed 17 + 25 = 42.", delegation_id: "delegation-client" },
      { type: "session.commentary.append", content: "17 plus 25 is 42.", delegation_id: "delegation-client" },
    ]);
    const answered = ofType(messages, "delegation").find((message) => message.title === "Client delegation → this page");
    assert.equal(answered.status, "Answered locally from: What is seventeen plus twenty five?");
    assert.equal(answered.delta, "17 plus 25 is 42.");
    // Only the answer goes out; the page never sends Responses commands for a client agent.
    assert.ok(!scripted.commands().some((type) => type.startsWith("response.")));
  });

  it("falls back with commentary only when the page cannot answer", async () => {
    const { scripted } = await runSession({
      agent: CLIENT_AGENT,
      events: delegated("Please correct my English: I goed to school."),
      stopAfterMs: ANSWER_MS,
    });
    assert.deepEqual(replies(scripted), [
      { type: "session.commentary.append", content: FALLBACK, delegation_id: "delegation-client" },
    ]);
  });

  it("reports a reply that fails after the event loop moved on, then closes", async () => {
    const { messages } = await runSession({
      agent: CLIENT_AGENT,
      events: delegated("What time is it?"),
      // Stop before the transcript is quiet; the reply then fails on the closed session.
      stopAfterMs: 50,
    });
    assert.match(ofType(messages, "error")[0]?.message ?? "", /Client delegation failed/);
    assert.equal(messages.at(-1).type, "closed");
  });
});

describe("managed prompt-agent session", () => {
  it("shows Foundry-managed delegation and never runs the prompt agent itself", async () => {
    const { messages, scripted } = await runSession({
      agent: MANAGED_AGENT,
      events: [
        live.started("conversation-managed"),
        live.delegation("delegation-managed", "foundry_managed_agent"),
        live.backend("delegation-managed", "response.created"),
        live.backend("delegation-managed", "response.output_text.delta", { delta: "[commentary] I went." }),
        live.commentary(),
        live.backend("delegation-managed", "response.completed"),
        live.teacher("I went to school yesterday."),
      ],
    });
    const delegation = ofType(messages, "delegation");
    assert.equal(delegation[0].title, "Managed delegation → prompt:7");
    assert.deepEqual(delegation.map((message) => message.status), [
      "Prompt agent delegation requested",
      "Backend response started",
      "Receiving backend guidance",
      "Accepted commentary forwarded to GPT Live",
      "Backend response completed; accepted guidance forwarded to GPT Live",
    ]);
    assert.ok(delegation.every((message) => message.id === "delegation-managed"));
    // The page only streams audio and closes; Foundry runs the prompt agent.
    assert.deepEqual([...new Set(scripted.commands())], ["session.input_audio.append", "session.close"]);
  });

  it("shows session.delegation.done, which the SDK passes through as an unknown event", async () => {
    const { messages } = await runSession({
      agent: MANAGED_AGENT,
      events: [
        live.started("conversation-done"),
        live.delegation("delegation-done", "foundry_managed_agent"),
        live.backend("delegation-done", "response.completed", { response: { id: "response-1", output: [] } }),
        {
          type: "session.delegation.done",
          event_id: "evt_managed_done_1",
          delegation_id: "delegation-done",
          status: "completed",
          error_code: null,
          response_id: "response-1",
          partial: false,
          observations_truncated: false,
        },
      ],
    });
    assert.deepEqual(ofType(messages, "delegation").at(-1), {
      type: "delegation",
      id: "delegation-done",
      status: "Delegation done: completed",
    });
  });

  it("runs the local function in the page and returns its result on the session", async () => {
    const call = { type: "function_call", call_id: "call-1", name: DATETIME_TOOL_NAME, arguments: "{}" };
    const { messages, scripted } = await runSession({
      agent: MANAGED_AGENT,
      events: [
        live.started("conversation-tools", MANAGED),
        live.delegation("delegation-tools", "foundry_managed_agent"),
        live.backend("delegation-tools", "response.created", { response: { id: "response-1" } }),
        live.backend("delegation-tools", "response.output_item.done", { item: call }),
        live.backend("delegation-tools", "response.completed", { response: { id: "response-1", output: [] } }),
        live.teacher("It's 1:54 PM."),
      ],
    });
    // The function output and one continuation go out on the same Live socket.
    const commands = scripted.received.filter((command) => command.type.startsWith("response."));
    assert.deepEqual(commands.map((command) => command.type), ["response.item.create", "response.create"]);
    assert.equal(commands[0].item.type, "function_call_output");
    assert.equal(commands[0].item.call_id, "call-1");
    assert.ok("utc_datetime" in JSON.parse(commands[0].item.output));
    assert.ok(
      ofType(messages, "delegation").some(
        (message) =>
          message.title === "Managed prompt-agent tools" &&
          message.status === "Local function results sent; resuming the prompt agent",
      ),
    );
  });

  it("rejects native client or responses targets without a fallback", async () => {
    for (const target of ["client", "responses"]) {
      const { messages, scripted } = await runSession({
        agent: MANAGED_AGENT,
        events: [live.started("c"), live.delegation("d", target)],
        stopAfterMs: 500,
      });
      assert.match(ofType(messages, "error")[0].message, new RegExp(`delegation target '${target}'`));
      assert.ok(!scripted.commands().some((type) => /commentary|thinking|response\./.test(type)));
    }
  });
});

describe("typed messages", () => {
  const TYPED_ITEM = (text) => ({ type: "message", role: "user", content: [{ type: "input_text", text }] });
  /** The backend answers a typed run with a delegation that names the response.create event_id. */
  const answer = (target) => (command) =>
    command.type === "response.create"
      ? [
          {
            type: "session.delegation.created",
            event_id: "event-typed",
            client_event_id: command.event_id,
            offset_ms: 0,
            delegation: { id: "delegation-typed", type: "delegation", target },
          },
          live.backend("delegation-typed", "response.completed", { response: { id: "response-typed", output: [] } }),
          live.teacher('Say "I went."'),
        ]
      : [];

  for (const [agent, target, snapshot] of [
    [RESPONSES_AGENT, "responses", { type: "responses", responses: { model: "text-model" } }],
    [MANAGED_AGENT, "foundry_managed_agent", MANAGED],
  ]) {
    it(`sends a user item, then response.create, to the ${target} backend`, async () => {
      const { result, messages, scripted } = await runSession({
        agent,
        events: [live.started("conversation-typed", snapshot)],
        respond: answer(target),
        typed: ["I goed to school."],
        stopAfterMs: 150,
      });
      assert.equal(result.failure, undefined);
      const [item, run] = scripted.received.filter((command) => command.type.startsWith("response."));
      assert.equal(item.type, "response.item.create");
      assert.match(item.event_id, /^typed-[0-9a-f]+$/);
      assert.deepEqual(item.item, TYPED_ITEM("I goed to school."));
      assert.equal(run.type, "response.create");
      assert.match(run.event_id, /^typed-run-[0-9a-f]+$/);
      // Every titled update for the typed run keeps the label, including later backend events.
      const titled = ofType(messages, "delegation").filter((message) => message.id === "delegation-typed" && message.title);
      assert.ok(titled.length >= 2);
      assert.ok(titled.every((message) => message.title.endsWith("(typed message)")));
      assert.deepEqual(ofType(messages, "transcript").at(-1), { type: "transcript", role: "teacher", delta: 'Say "I went."' });
    });
  }

  it("reports a rejected typed message without ending the session", async () => {
    const { result, messages } = await runSession({
      agent: MANAGED_AGENT,
      events: [live.started("conversation-typed", MANAGED)],
      respond: (command) =>
        command.type === "response.item.create"
          ? [
              {
                type: "error",
                event_id: "evt_managed_1",
                error: {
                  type: "invalid_request_error",
                  code: "typed_input_too_large",
                  message: "The typed message exceeds the size limit.",
                  client_event_id: command.event_id,
                },
              },
            ]
          : [],
      typed: ["x".repeat(50)],
      stopAfterMs: 150,
    });
    assert.equal(result.failure, undefined);
    assert.ok(messages.some((message) => message.type === "status" && message.text === "Typed message not accepted: typed_input_too_large"));
    assert.equal(ofType(messages, "error").length, 0);
  });

  it("refuses typed input for a client-delegation agent without sending anything", async () => {
    const scripted = new ScriptedLive([live.started("conversation-client")]);
    const session = new LiveSession({
      openLive: (target) => openLiveSession({ endpoint: ENDPOINT, credential, webSocketFactory: scripted }, target),
      agent: CLIENT_AGENT,
      onMessage: async (message) => {
        if (message.type !== "ready") return;
        assert.equal(session.acceptsText, false);
        await assert.rejects(session.sendText("hello"), /Responses or Foundry-managed agent backend/);
        session.stop();
      },
    });
    await session.run();
    assert.ok(!scripted.commands().some((type) => type.startsWith("response.")));
  });
});
