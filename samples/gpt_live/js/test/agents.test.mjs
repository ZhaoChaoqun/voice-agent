// Offline agent definition and lifecycle tests against the real Projects SDK client.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BACKEND_INSTRUCTIONS,
  GREETING,
  clientAgentDefinition,
  createProject,
  deleteAgents,
  managedVoiceAgentDefinition,
  prepareClientAgent,
  prepareManagedAgents,
  prepareResponsesAgent,
  promptAgentDefinition,
  responsesAgentDefinition,
} from "../agents.mjs";
import { ENDPOINT, ENV, OfflineProject, credential } from "./offline.mjs";

const quiet = () => {};
const LESSON_INPUTS = {
  learner_name: { description: "What the teacher calls the learner.", default_value: "friend" },
  level: {
    description: "The learner's English level.",
    default_value: "intermediate",
    schema: { type: "string", enum: ["beginner", "intermediate", "advanced"] },
  },
};

/** Every sample's voice agent declares the lesson inputs and a template greeting that uses them. */
function assertLessonPersonalization(definition) {
  assert.equal(definition.model_type, "self_deployed");
  assert.deepEqual(definition.greeting, { type: "template", text: GREETING });
  assert.match(definition.greeting.text, /\{\{learner_name\}\}/);
  assert.match(definition.instructions, /\{\{learner_name\}\}.*\{\{level\}\}/);
  assert.deepEqual(definition.structured_inputs, LESSON_INPUTS);
}

function client(project) {
  return createProject(ENDPOINT, credential, { httpClient: project });
}

describe("agent definitions", () => {
  it("defines a Responses-delegation GPT Live agent", () => {
    const definition = responsesAgentDefinition(ENV);
    assert.deepEqual(
      [definition.kind, definition.sub_protocol, definition.model_type, definition.model, definition.store],
      ["voice", "live", "self_deployed", "live-model", true],
    );
    assert.deepEqual(definition.delegation, {
      type: "responses",
      responses: { model: "text-model", instructions: BACKEND_INSTRUCTIONS },
    });
    assert.deepEqual(definition.audio, { format: { type: "audio/pcm", rate: 24000 }, output: { voice: "marin" } });
    assertLessonPersonalization(definition);
  });

  it("defines a client-delegation agent that delegates the time and addition to the page", () => {
    const definition = clientAgentDefinition(ENV);
    assert.deepEqual(definition.delegation, { type: "client" });
    assert.equal(definition.model, "live-model");
    assert.match(definition.instructions, /always delegate before answering/);
    assertLessonPersonalization(definition);
  });

  it("pins the managed prompt agent version with plain-text output", () => {
    const voice = managedVoiceAgentDefinition("live", "prompt", 7);
    assert.deepEqual(voice.delegation, { type: "foundry_managed_agent", agent_name: "prompt", agent_version: "7" });
    assert.equal(voice.store, true);
    assertLessonPersonalization(voice);
    const prompt = promptAgentDefinition("text");
    assert.deepEqual(prompt.text, { format: { type: "text" } });
    assert.match(prompt.instructions, /\[commentary\]/);
  });
});

describe("prepareResponsesAgent", () => {
  it("checks deployments, then creates the agent with the preview header", async () => {
    const project = new OfflineProject();
    const created = [];
    const agent = await prepareResponsesAgent(client(project), ENV, quiet, created);
    assert.deepEqual(project.deploymentChecks(), ["live-model", "text-model"]);
    assert.deepEqual(project.requests.slice(0, 2).map((request) => request.method), ["GET", "GET"]);
    assert.equal(project.created.length, 1);
    assert.equal(project.created[0].features, "VoiceAgents=V1Preview");
    assert.deepEqual(created, [agent.name]);
    assert.deepEqual(agent, {
      name: project.created[0].name, version: "3", managedDelegation: false, clientDelegation: false,
      backendModel: "text-model", inputs: ["learner_name", "level"],
    });
  });

  it("reuses AGENT_NAME without creating it and checks its saved deployments", async () => {
    const saved = {
      kind: "voice", sub_protocol: "live", model_type: "self_deployed", model: "saved-live",
      delegation: { type: "foundry_managed_agent", agent_name: "saved-prompt", agent_version: "2" },
    };
    const project = new OfflineProject({ teacher: { version: "5", definition: saved } });
    const created = [];
    const agent = await prepareResponsesAgent(client(project), { ...ENV, AGENT_NAME: "teacher" }, quiet, created);
    assert.deepEqual(project.created, []);
    assert.deepEqual(created, []);
    assert.deepEqual(project.deploymentChecks(), ["saved-live"]);
    // The saved agent declares no structured inputs, so the page sends none.
    assert.deepEqual(agent, {
      name: "teacher", version: "5", managedDelegation: true, clientDelegation: false,
      backendModel: "saved-prompt:2", inputs: [],
    });
  });

  it("rejects a missing or Realtime agent", async () => {
    const realtime = { kind: "voice", model: "realtime-model" };
    for (const [agents, message] of [[{}, /was not found/], [{ teacher: { version: "1", definition: realtime } }, /sub_protocol=live/]]) {
      const project = new OfflineProject(agents);
      await assert.rejects(prepareResponsesAgent(client(project), { ...ENV, AGENT_NAME: "teacher" }, quiet, []), message);
    }
  });
});

describe("prepareClientAgent", () => {
  it("ignores AGENT_NAME, checks only the GPT Live deployment, and creates a client agent", async () => {
    const project = new OfflineProject({ teacher: { version: "5", definition: {} } });
    const created = [];
    const agent = await prepareClientAgent(client(project), { ...ENV, AGENT_NAME: "teacher" }, quiet, created);
    assert.deepEqual(project.deploymentChecks(), ["live-model"]);
    assert.deepEqual(project.created.map(({ definition }) => definition.delegation), [{ type: "client" }]);
    assert.deepEqual(created, [agent.name]);
    assert.deepEqual(agent, {
      name: project.created[0].name, version: "3", managedDelegation: false, clientDelegation: true,
      backendModel: "this page", inputs: ["learner_name", "level"],
    });
  });
});

describe("prepareManagedAgents", () => {
  it("creates the prompt agent, then a voice agent pinned to its returned version", async () => {
    const project = new OfflineProject();
    const created = [];
    const agent = await prepareManagedAgents(client(project), { ...ENV, AGENT_NAME: "ignored" }, quiet, created);
    const [prompt, voice] = project.created;
    assert.equal(prompt.definition.kind, "prompt");
    assert.deepEqual(voice.definition.delegation, {
      type: "foundry_managed_agent", agent_name: prompt.name, agent_version: "7",
    });
    assert.equal(voice.features, "VoiceAgents=V1Preview");
    assert.deepEqual(project.deploymentChecks(), ["live-model", "text-model"]);
    assert.deepEqual(created, [prompt.name, voice.name]);
    assert.deepEqual(agent, {
      name: voice.name, version: "3", managedDelegation: true, clientDelegation: false,
      backendModel: `${prompt.name}:7`, inputs: ["learner_name", "level"],
    });
    assertLessonPersonalization(voice.definition);
  });

  it("records only the prompt agent when voice-agent creation fails", async () => {
    const project = new OfflineProject({}, { failVoice: true });
    const created = [];
    await assert.rejects(prepareManagedAgents(client(project), ENV, quiet, created), /HTTP 400/);
    assert.deepEqual(created, [project.created[0].name]);
  });
});

describe("deleteAgents", () => {
  it("deletes newest first and treats an already-deleted agent as deleted", async () => {
    const project = new OfflineProject();
    const lines = [];
    await deleteAgents(client(project), ["prompt", "voice"], (line) => lines.push(line));
    assert.deepEqual(project.deleted, ["voice", "prompt"]);
    assert.deepEqual(lines, ["Deleted temporary agent: voice", "Deleted temporary agent: prompt"]);
  });
});
