// Copyright (c) Microsoft. All rights reserved.

import test from "node:test";
import assert from "node:assert/strict";
import { createAgentDraft, draftCreateOptions, updateAgentDraft, DEFAULT_INSTRUCTIONS } from "./agentForm.mjs";
import { buildCreateAgentBody } from "./serviceContract.js";
import { buildGreetingConfig } from "./greeting.mjs";
import { HANDOFF_ENTRYPOINT_INSTRUCTIONS } from "./handoff.mjs";
import { transcriptionGroups, voiceGroups } from "../config.js";

const cfg = {
  defaultModel: "gpt-realtime",
  defaultVoice: "en-US-AvaNeural",
  defaultAzureVoice: "en-US-AvaNeural",
  inputTranscriptionModel: "azure-speech",
  transcriptionModels: ["azure-speech", "mai-transcribe-2", "whisper-1"],
  realtimeTranscriptionModels: ["azure-speech", "mai-transcribe-2", "whisper-1"],
  cascadedTranscriptionModels: ["azure-speech", "mai-transcribe-2"],
  realtimeModels: ["gpt-realtime"],
  cascadedModels: ["gpt-4.1"],
  byomRealtimeModels: ["my-realtime"],
  byomCascadedModels: ["my-cascaded"],
};
const policy = { immediate_ack: true, gap_filling_interval: 12 };
const tools = [{ type: "system", name: "end_conversation" }];
const subagents = [{ agent_name: "specialist", agent_capabilities: "Billing", response_policy: policy }];
const body = (draft) => {
  const options = draftCreateOptions(draft, tools, subagents);
  return buildCreateAgentBody({ ...options, greeting: buildGreetingConfig(options.greeting) });
};

test("editor defaults preserve the existing managed voice request", () => {
  const draft = createAgentDraft(cfg);
  const request = body(draft);
  assert.equal(request.definition.kind, "voice");
  assert.equal(request.definition.model_type, "managed");
  assert.equal(request.definition.model, cfg.defaultModel);
  assert.equal(request.definition.audio.input.transcription.model, "azure-speech");
  assert.equal(draft.transcriptionLanguage, "Auto");
  assert.equal("language" in request.definition.audio.input.transcription, false);
  assert.equal(request.definition.instructions, DEFAULT_INSTRUCTIONS);
  assert.equal(request.definition.store, true);
  assert.deepEqual(request.definition.audio.input.echo_cancellation, {
    type: "server_echo_cancellation", reference_source: "client", channels: 2,
  });
  assert.equal("greeting" in request.definition, false);
});

test("a backend can still default conversation storage off", () => {
  assert.equal(createAgentDraft({ ...cfg, defaultStore: false }).store, false);
});

test("selected input language reaches both managed and hosted-agent create requests", () => {
  const draft = { ...createAgentDraft(cfg), transcriptionLanguage: "hi-IN" };
  assert.equal(body(draft).definition.audio.input.transcription.language, "hi-IN");
  const hosted = {
    ...draft, inferenceMode: "hosted_agent", targetAgentName: "hosted-target",
  };
  assert.equal(body(hosted).definition.audio.input.transcription.language, "hi-IN");
  const auto = updateAgentDraft(cfg, draft, "transcriptionLanguage", "");
  assert.equal("language" in body(auto).definition.audio.input.transcription, false);
});

test("changing transcription models preserves the language and reports incompatibility", () => {
  const draft = { ...createAgentDraft(cfg), transcriptionLanguage: "en-IN,hi-IN" };
  const next = updateAgentDraft(cfg, draft, "transcriptionModel", "mai-transcribe-2");
  assert.equal(next.transcriptionLanguage, "en-IN,hi-IN");
  assert.throws(() => body(next), /only one input language/);
});

test("switching sources picks a valid model and does not erase the draft", () => {
  const original = { ...createAgentDraft(cfg), name: "keep-me", instructions: "Be concise." };
  const byom = updateAgentDraft(cfg, original, "inferenceMode", "deployment");
  assert.equal(byom.model, "my-realtime");
  assert.equal(body(byom).definition.model_type, "self_deployed");
  assert.equal(byom.name, "keep-me");
  assert.equal(byom.instructions, "Be concise.");
  assert.equal(updateAgentDraft(cfg, byom, "inferenceMode", "model").model, "gpt-realtime");
  assert.equal(original.inferenceMode, "model");
});

test("avatar and client-reference echo cancellation remain mutually exclusive", () => {
  const draft = { ...createAgentDraft(cfg), voice: "alloy" };
  const avatar = updateAgentDraft(cfg, draft, "avatarEnabled", true);
  assert.equal(avatar.voice, cfg.defaultAzureVoice);
  assert.equal(avatar.clientReferenceEc, false);
  assert.ok(body(avatar).definition.avatar);
  const echo = updateAgentDraft(cfg, avatar, "clientReferenceEc", true);
  assert.equal(echo.avatarEnabled, false);
  assert.equal("avatar" in body(echo).definition, false);
});

test("changing models with an avatar keeps an Azure voice", () => {
  const draft = updateAgentDraft(cfg, createAgentDraft(cfg), "avatarEnabled", true);
  const next = updateAgentDraft({ ...cfg, defaultAzureVoice: "", defaultVoice: "alloy", azureVoices: ["en-US-JennyNeural"] },
    draft, "model", "gpt-realtime");
  assert.equal(next.voice, "en-US-AvaNeural");
});

test("changing model families never replaces the selected STT", () => {
  const realtime = { ...createAgentDraft(cfg), transcriptionModel: "whisper-1" };
  const cascaded = updateAgentDraft(cfg, realtime, "model", "gpt-4.1");
  assert.equal(cascaded.transcriptionModel, "whisper-1");
  assert.equal(body(cascaded).definition.audio.input.transcription.model, "whisper-1");
  const restored = updateAgentDraft(cfg, cascaded, "model", "gpt-realtime");
  assert.equal(restored.transcriptionModel, "whisper-1");
});

test("runtime transcription choices ignore model-family and project subsets", () => {
  const restricted = {
    ...cfg, transcriptionModels: ["whisper-1"], realtimeTranscriptionModels: ["whisper-1"],
    cascadedTranscriptionModels: ["azure-speech"],
  };
  const items = transcriptionGroups(restricted).flatMap((group) => group.items);
  assert.ok(items.some((item) => item.value === "azure-speech"));
  assert.ok(items.some((item) => item.value === "gpt-4o-transcribe"));
  assert.ok(items.every((item) => !item.disabled && !item.label.includes("unavailable")));
  for (const inferenceMode of ["model", "deployment", "hosted_agent"]) {
    const draft = { ...createAgentDraft(cfg), transcriptionModel: "whisper-1" };
    assert.equal(updateAgentDraft(cfg, draft, "inferenceMode", inferenceMode).transcriptionModel, "whisper-1");
  }
});

test("changing model families preserves transcription and voice when both remain compatible", () => {
  const realtime = {
    ...createAgentDraft(cfg),
    transcriptionModel: "mai-transcribe-2",
    voice: "en-US-AvaNeural",
  };
  const cascaded = updateAgentDraft(cfg, realtime, "model", "gpt-4.1");
  assert.equal(cascaded.transcriptionModel, "mai-transcribe-2");
  assert.equal(cascaded.voice, "en-US-AvaNeural");
});

test("changing models and model sources never replaces the selected voice", () => {
  for (const voice of ["emma", "alloy", "en-US-Emma:DragonHDOmniLatestNeural"]) {
    const original = { ...createAgentDraft(cfg), voice };
    assert.equal(updateAgentDraft(cfg, original, "model", "gpt-4.1").voice, voice);
    assert.equal(updateAgentDraft(cfg, original, "inferenceMode", "deployment").voice, voice);
    assert.equal(updateAgentDraft(cfg, original, "inferenceMode", "hosted_agent").voice, voice);
  }
});

test("runtime voice selectors group choices by locale without disabling voices", () => {
  const groups = voiceGroups({
    ...cfg,
    azureVoices: ["fr-FR-DeniseNeural"],
  });
  assert.ok(groups.find((group) => group.locale === "en-US").items.some(
    (voice) => voice.value === "en-US-Emma:DragonHDOmniLatestNeural",
  ));
  assert.ok(groups.find((group) => group.locale === "fr-FR").items.some(
    (voice) => voice.value === "fr-FR-DeniseNeural",
  ));
  assert.ok(groups.at(-1).items.some((voice) => voice.value === "emma"));
  assert.ok(groups.every((group) => group.items.every((voice) => !voice.disabled)));
});

test("hosted wrappers exclude target-owned fields without destroying local selections", () => {
  const initial = {
    ...createAgentDraft(cfg), instructions: "Keep my custom instructions", handoffEnabled: true,
    greeting: { mode: "llm_generated", prompt: "Greet the caller", fallbackText: "Hello", toolChoice: "required" },
  };
  const hosted = {
    ...updateAgentDraft(cfg, initial, "inferenceMode", "hosted_agent"),
    targetAgentName: " hosted-target ", targetAgentVersion: " 2 ",
  };
  const definition = body(hosted).definition;
  assert.equal(definition.model_type, "hosted_agent");
  assert.deepEqual(definition.target_agent, { name: "hosted-target", version: "2" });
  for (const key of ["model", "instructions", "tools", "handoff", "subagent_config"]) {
    assert.equal(key in definition, false, key);
  }
  assert.equal(definition.greeting.tool_choice, "auto");
  assert.equal(initial.greeting.toolChoice, "required");
  const restored = body(updateAgentDraft(cfg, hosted, "inferenceMode", "model")).definition;
  assert.deepEqual(restored.tools, tools);
  assert.deepEqual(restored.subagent_config, { subagents });
  assert.equal(restored.instructions, initial.instructions);
  assert.ok(restored.handoff);
});

test("backend-default hosted wrappers start with an Azure voice", () => {
  const draft = createAgentDraft({ ...cfg, defaultInferenceMode: "hosted_agent", defaultVoice: "alloy" });
  assert.equal(draft.inferenceMode, "hosted_agent");
  assert.equal(draft.voice, cfg.defaultAzureVoice);
});

test("handoff prompt remains the default unless instructions are explicitly authored", () => {
  const draft = { ...createAgentDraft(cfg), handoffEnabled: true };
  assert.equal(body(draft).definition.instructions, HANDOFF_ENTRYPOINT_INSTRUCTIONS);
  assert.equal(body({ ...draft, instructions: "My explicit routing instructions" }).definition.instructions,
    "My explicit routing instructions");
});

test("template and generated greetings survive draft-to-request conversion", () => {
  const draft = createAgentDraft(cfg);
  draft.greeting = { ...draft.greeting, mode: "template", text: "Hello {{name}}!" };
  assert.deepEqual(body(draft).definition.greeting, { type: "template", text: "Hello {{name}}!" });
  draft.greeting = { mode: "llm_generated", prompt: "Greet warmly", fallbackText: "Hello", toolChoice: "auto" };
  assert.deepEqual(body(draft).definition.greeting, {
    type: "llm_generated", prompt: "Greet warmly", fallback_text: "Hello", tool_choice: "auto",
  });
});

test("structured input definitions reach managed and BYOM agents, but not hosted wrappers", () => {
  const structuredInputs = { customer_name: { schema: { type: "string" }, default_value: "Ada" } };
  const draft = { ...createAgentDraft(cfg), instructions: "Help {{customer_name}}." };
  for (const inferenceMode of ["model", "deployment", "hosted_agent"]) {
    const options = draftCreateOptions(
      { ...draft, inferenceMode, targetAgentName: "hosted-target" }, tools, subagents, structuredInputs,
    );
    const definition = buildCreateAgentBody(options).definition;
    assert.deepEqual(definition.structured_inputs, inferenceMode === "hosted_agent" ? undefined : structuredInputs);
  }
});
