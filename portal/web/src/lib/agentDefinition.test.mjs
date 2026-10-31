// Copyright (c) Microsoft. All rights reserved.

import assert from "node:assert/strict";
import test from "node:test";

import {
  agentDefinitionToJson,
  agentDefinitionToYaml,
  parseAgentDefinitionYaml,
} from "./agentDefinition.mjs";
import { createBlankDefinition, parseAgentJson, parseAgentSource } from "../../../static/handoff/handoff-core.mjs";

test("Runtime JSON exports import in Editor without losing settings or extension fields", () => {
  const definition = createBlankDefinition();
  definition.instructions = "First line.\nSecond line: \u4f60\u597d";
  definition.audio.input.transcription.language = "hi-IN,en-IN";
  definition.future_capability = { enabled: false, values: [0, null], nested: { retained: true } };
  definition.handoff.nodes[0].config.future_setting = { retained: true };
  const source = agentDefinitionToJson(definition);
  assert.deepEqual(JSON.parse(source), definition);
  const imported = parseAgentJson(source);
  assert.deepEqual(imported.problems, []);
  assert.deepEqual(imported.definition, definition);
  assert.deepEqual(parseAgentDefinitionYaml(agentDefinitionToYaml(definition)), definition);
  assert.deepEqual(parseAgentSource(agentDefinitionToYaml(definition)).definition, definition);
});

test("Runtime JSON export reports a missing definition", () => {
  for (const value of [undefined, null, [], "voice"]) {
    assert.throws(() => agentDefinitionToJson(value), /does not have a definition/);
  }
});

test("round trips a voice definition through portal-style YAML", () => {
  const definition = {
    kind: "voice",
    model_type: "managed",
    model: "azure-realtime",
    instructions: "First line.\nSecond line.",
    output_modalities: ["text", "audio"],
    store: true,
  };

  const yaml = agentDefinitionToYaml(definition);

  assert.match(yaml, /^definition:/);
  assert.match(yaml, /instructions: \|-/);
  assert.deepEqual(parseAgentDefinitionYaml(yaml), definition);
});

test("requires a top-level voice definition", () => {
  assert.throws(
    () => parseAgentDefinitionYaml("kind: voice\n"),
    /top-level definition object/,
  );
  assert.throws(
    () => parseAgentDefinitionYaml("definition:\n  kind: prompt\n"),
    /definition\.kind must be "voice"/,
  );
  assert.throws(
    () => parseAgentDefinitionYaml("definition: ["),
    /Invalid YAML/,
  );
});
