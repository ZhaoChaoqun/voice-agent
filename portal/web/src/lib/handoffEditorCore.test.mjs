import assert from "node:assert/strict";
import test from "node:test";

import {
  ENTRYPOINT_ID,
  PIPELINE_COMPONENTS,
  PIPELINE_COST_USAGE,
  PIPELINE_LLM_ESTIMATE_DIVISOR,
  PIPELINE_RETAIL_RATES_PER_MILLION,
  createBlankDefinition,
  createSampleDefinition,
  deterministicYaml,
  estimatePipeline,
  ensureEditableDefinition,
  extractLatestAgent,
  formatPipelineCost,
  formatPipelineLatency,
  groupVoicesByLocale,
  layoutHandoffGraph,
  mergeServiceProblems,
  matchesAgentSearch,
  modelEstimate,
  pipelineBrand,
  pipelineComponentOptions,
  pipelineComponentProvider,
  pipelineMetricMinimum,
  pipelineTotals,
  parseAgentJson,
  parseAgentSource,
  publicationDefinition,
  publicationFeatures,
  sideEdgeAnchors,
  smoothOuterEdgePath,
  smoothVerticalEdgePath,
  sortPipelineComponents,
  stableJson,
  validateDefinition,
  voiceLocale,
} from "../../../static/handoff/handoff-core.mjs";

test("blank Agents explicitly select a managed model before any settings are saved", () => {
  const definition = createBlankDefinition();
  assert.equal(definition.kind, "voice");
  assert.equal(definition.model_type, "managed");
  assert.equal(definition.model, "gpt-realtime");
  assert.deepEqual(validateDefinition(definition).filter((item) => item.severity === "error"), []);
  assert.equal(JSON.parse(stableJson(definition)).model_type, "managed");
  assert.match(deterministicYaml(definition), /^model_type: "managed"$/m);
});

test("blank Agents hardcode Customer Support base settings with the Emma Omni voice", () => {
  const definition = createBlankDefinition();
  assert.deepEqual(definition.audio, {
    input: {
      format: { type: "audio/pcm", rate: 24000 },
      turn_detection: {
        type: "azure_semantic_vad", profile: "normal", auto_truncate: true,
        interrupt_response: true, silence_duration_ms: 400,
      },
      transcription: { model: "azure-speech" },
      echo_cancellation: { type: "server_echo_cancellation" },
      noise_reduction: { type: "azure_deep_noise_suppression" },
    },
    output: {
      format: { type: "audio/pcm", rate: 24000 },
      voice: { type: "azure-standard", name: "en-US-Emma:DragonHDOmniLatestNeural" },
    },
  });
  assert.equal(definition.store, false);
  assert.deepEqual(definition.output_modalities, ["audio"]);
  assert.deepEqual(definition.greeting, { type: "template", text: "Hello! How can I help you today?" });
  assert.equal(definition.tool_choice, "auto");
  assert.deepEqual(definition.tools, []);
  assert.equal(definition.handoff.max_transfers, 16);
  assert.equal(definition.handoff.max_attempts, 16);
});

test("blank Agents contain a runnable entrypoint-to-end graph that survives publication and export", () => {
  const definition = createBlankDefinition();
  assert.deepEqual(definition.handoff.nodes.map((node) => node.id), ["end"]);
  const end = definition.handoff.nodes[0];
  assert.ok(end.description.trim());
  assert.match(end.config.instructions, /end_conversation/);
  assert.deepEqual(end.config.tools, [{ type: "system", name: "end_conversation" }]);
  assert.equal(end.config.tool_choice, "auto");
  assert.equal(definition.handoff.edges.length, 1);
  const edge = definition.handoff.edges[0];
  assert.equal(edge.source, ENTRYPOINT_ID);
  assert.equal(edge.target, "end");
  assert.match(edge.description, /goodbye/);
  assert.equal(edge.target_response, "auto");
  assert.equal(edge.cancel_on_interruption, true);
  assert.deepEqual(validateDefinition(definition), []);
  assert.deepEqual(publicationDefinition(definition), definition);
  assert.deepEqual(parseAgentJson(stableJson(definition)).definition, definition);
  assert.match(deterministicYaml(definition), /name: "end_conversation"/);
});

test("blank Agents do not share mutable node, route or tool defaults", () => {
  const first = createBlankDefinition();
  const second = createBlankDefinition();
  first.handoff.nodes[0].config.tools.length = 0;
  first.handoff.edges[0].target = "changed";
  first.audio.output.voice.name = "changed";
  first.audio.input.turn_detection.silence_duration_ms = 100;
  assert.equal(second.handoff.nodes[0].config.tools[0].name, "end_conversation");
  assert.equal(second.handoff.edges[0].target, "end");
  assert.equal(second.audio.output.voice.name, "en-US-Emma:DragonHDOmniLatestNeural");
  assert.equal(second.audio.input.turn_detection.silence_duration_ms, 400);
});

test("publishes imported flat Agents without sending an empty editable handoff graph", () => {
  const definition = createBlankDefinition();
  definition.handoff.nodes = [];
  definition.handoff.edges = [];
  const original = structuredClone(definition);
  const published = publicationDefinition(definition);
  assert.equal(published.model_type, "managed");
  assert.equal(Object.hasOwn(published, "handoff"), false);
  const { handoff, ...flatDefinition } = original;
  assert.deepEqual(published, flatDefinition);
  assert.deepEqual(definition, original);
});

test("publication preserves real and incomplete graphs instead of dropping configuration", () => {
  const definition = createSampleDefinition();
  assert.deepEqual(publicationDefinition(definition), definition);
  for (const handoff of [
    { nodes: [{ id: "support" }], edges: [] },
    { nodes: [], edges: [{ source: ENTRYPOINT_ID, target: "support" }] },
    { nodes: [], edges: null },
  ]) {
    const changed = { ...createBlankDefinition(), handoff };
    assert.deepEqual(publicationDefinition(changed), changed);
  }
});

test("pipeline metrics show compact cents and complete latency ranges", () => {
  assert.equal(formatPipelineCost(.019654), "1.97¢/min");
  assert.equal(formatPipelineCost(.000154), "0.02¢/min");
  assert.equal(formatPipelineCost(.00001), "0.01¢/min");
  assert.equal(formatPipelineCost(.019651), "1.97¢/min");
  assert.equal(formatPipelineCost(.019701), "1.98¢/min");
  assert.equal(formatPipelineCost(.0102), "1.02¢/min");
  assert.equal(formatPipelineCost(Number.MIN_VALUE), "0.01¢/min");
  assert.equal(formatPipelineCost(0), "0¢/min");
  for (const value of [null, undefined, NaN, Infinity, Number.MAX_VALUE, -1]) {
    assert.equal(formatPipelineCost(value), "Not available");
  }
  assert.equal(
    formatPipelineLatency({ latencyMinMs: 800, latencyMaxMs: 3200 }),
    "800 ms – 3.2 s",
  );
  assert.equal(
    formatPipelineLatency({ latencyMinMs: 1300, latencyMaxMs: 3625 }),
    "1.3 s – 3.7 s",
  );
  assert.equal(formatPipelineLatency({ latencyMs: 307 }), "307 ms");
  assert.equal(formatPipelineLatency({ latencyMinMs: 800 }), "Not available");
  assert.equal(formatPipelineLatency(null), "Not available");
});

test("displayed cost never rounds a positive budget down or to zero", () => {
  for (let millionths = 1; millionths <= 100_000; millionths += 17) {
    const usd = millionths / 1_000_000;
    const displayed = Number(formatPipelineCost(usd).replaceAll(",", "").replace("¢/min", ""));
    assert.ok(displayed > 0);
    assert.ok(displayed + 1e-12 >= usd * 100, `${usd} rounded down to ${displayed} cents`);
    assert.ok(displayed - usd * 100 < .010000000001);
  }
});

test("uses full audio minutes and budgets for repeated history and reasoning without cache discounts", () => {
  assert.deepEqual(PIPELINE_COST_USAGE, {
    userAudioSeconds: 60,
    agentAudioSeconds: 60,
    inputAudioTokensPerSecond: 10,
    outputAudioTokensPerSecond: 20,
    modelRequestsPerMinute: 10,
    textInputTokensPerRequest: 64_000,
    textOutputTokensPerRequest: 2_000,
    nativeAudioInputTokensPerRequest: 6_000,
    nativeAudioInputTokens: 60_000,
    textInputTokens: 640_000,
    textOutputTokens: 20_000,
  });
  assert.equal(PIPELINE_RETAIL_RATES_PER_MILLION.lite.nativeAudioOutput, 12);
  assert.deepEqual(
    ["pro", "standard", "lite"].map((tier) => {
      const rates = PIPELINE_RETAIL_RATES_PER_MILLION[tier];
      return [
        rates.textInput, rates.textOutput, rates.nativeAudioInput, rates.nativeAudioOutput,
        rates.speechInput, rates.speechOutput, rates.customSpeechInput, rates.customSpeechOutput,
      ];
    }),
    [
      [4, 16, 32, 64, 17, 31, 40, 55],
      [.66, 2.64, 11, 22, 15, 26, 39, 50],
      [.11, .44, 4, 12, 15, 25, 38, 50],
    ],
  );
});

test("divides only the prior model budget by the approved factor and preserves full speech minutes", () => {
  assert.equal(PIPELINE_LLM_ESTIMATE_DIVISOR, 150);
  const usage = PIPELINE_COST_USAGE;
  assert.equal(usage.textInputTokens, usage.modelRequestsPerMinute * usage.textInputTokensPerRequest);
  assert.equal(usage.textOutputTokens, usage.modelRequestsPerMinute * usage.textOutputTokensPerRequest);
  assert.equal(usage.nativeAudioInputTokens, usage.modelRequestsPerMinute * usage.nativeAudioInputTokensPerRequest);
  const realtime = estimatePipeline({ model: "gpt-realtime", stt: "azure-speech", voice: "alloy" }).pipeline;
  const rates = PIPELINE_RETAIL_RATES_PER_MILLION.pro;
  const perRequest = (
    64_000 * rates.textInput + 2_000 * rates.textOutput + 6_000 * rates.nativeAudioInput
  ) / 1_000_000;
  assert.ok(Math.abs(realtime.model.costPerMinute - 10 * perRequest / 150) < 1e-12);
  assert.match(realtime.model.costSource, /Temporary model budget \/150; workload revision pending approval/);
  assert.equal(realtime.stt.costPerMinute, 60 * 10 * rates.speechInput / 1_000_000);
  assert.equal(realtime.voice.costPerMinute, 60 * 20 * rates.nativeAudioOutput / 1_000_000);
});

test("reduces every model budget exactly 150-fold without changing its retail-rate certainty", () => {
  const expected = {
    "gpt-realtime-2.1": [4.96, false],
    "azure-realtime": [4.96, true],
    "gpt-realtime-1.5": [4.96, true],
    "gpt-realtime-2.1-mini": [1.1352, false],
    "gpt-realtime": [4.8, false],
    "gpt-realtime-mini": [1.1352, false],
    "gpt-realtime-2": [4.96, false],
    "gpt-5.4": [3.04, true],
    "gpt-5.6-terra": [3.04, true],
    "gpt-5.6-luna": [.4752, false],
    "gpt-6-sol": [4.44, true],
    "gpt-6.1-sol": [4.44, true],
    "gpt-6-luna": [4.44, true],
    "gpt-oss-120b": [4.44, true],
  };
  const models = pipelineComponentOptions("model");
  assert.equal(models.length, Object.keys(expected).length);
  for (const model of models) {
    const [amount, allowance] = expected[model.id];
    assert.ok(Math.abs(model.costPerMinute * 150 - amount) < 1e-12, model.id);
    assert.equal(model.costIsAllowance, allowance, model.id);
    if (allowance) {
      assert.equal(model.publicRateLabel, "");
      assert.match(model.costSource, /Conservative/);
    } else {
      assert.match(model.publicRateLabel, /1M tokens/);
    }
  }
});

test("shares pipeline estimates between authoring and runtime cards", () => {
  const { preset, pipeline } = estimatePipeline({
    model: "gpt-realtime-2.1",
    voice: "alloy",
    stt: "whisper-1",
  });
  assert.equal(preset.id, "balanced");
  const balancedTotals = pipelineTotals(pipeline);
  assert.ok(Math.abs(balancedTotals.costPerMinute - (.02 + 4.96 / 150 + .0768)) < 1e-12);
  assert.deepEqual({
    latencyMinMs: balancedTotals.latencyMinMs,
    latencyMaxMs: balancedTotals.latencyMaxMs,
    latencyMs: balancedTotals.latencyMs,
  }, {
    latencyMinMs: 1300,
    latencyMaxMs: 3626,
    latencyMs: 2463,
  });

  const fallback = estimatePipeline({
    model: "custom-model",
    voice: "custom-voice",
    stt: "whisper-1",
  }).pipeline;
  assert.equal(pipelineTotals(fallback), null);
  assert.equal(fallback.model.estimateUnavailable, true);
});

test("keeps current Realtime versions distinct and couples compatible speech stages", () => {
  const realtime = estimatePipeline({
    model: "gpt-realtime",
    voice: "alloy",
    stt: "whisper-1",
  }).pipeline;
  assert.equal(realtime.model.id, "gpt-realtime");
  assert.equal(realtime.stt.id, "whisper-1");
  const realtimeTotals = pipelineTotals(realtime);
  assert.ok(Math.abs(realtimeTotals.costPerMinute - .1288) < 1e-12);
  assert.deepEqual({
    latencyMinMs: realtimeTotals.latencyMinMs,
    latencyMaxMs: realtimeTotals.latencyMaxMs,
    latencyMs: realtimeTotals.latencyMs,
  }, {
    latencyMinMs: 800,
    latencyMaxMs: 3126,
    latencyMs: 1963,
  });

  const realtimeModels = pipelineComponentOptions("model")
    .filter((item) => item.architecture === "realtime")
    .map((item) => item.id);
  assert.deepEqual(realtimeModels, [
    "gpt-realtime-2.1",
    "azure-realtime",
    "gpt-realtime-1.5",
    "gpt-realtime-2.1-mini",
    "gpt-realtime",
    "gpt-realtime-mini",
    "gpt-realtime-2",
  ]);
  const realtimeStt = pipelineComponentOptions("stt", {
    model: "gpt-realtime-2.1",
    voice: "alloy",
    stt: "whisper-1",
  });
  assert.equal(realtimeStt.length, 11);
  assert.ok(realtimeStt.every((item) => item.compatible));
  assert.ok(realtimeStt.some((item) => item.id === "whisper-1"));
  assert.ok(!realtimeStt.some((item) => item.id === "native-realtime-audio"));
  assert.ok(
    pipelineTotals(estimatePipeline({
      model: "gpt-realtime-2.1",
      voice: "alloy",
      stt: "native-realtime-audio",
    }).pipeline),
  );
  assert.ok(
    pipelineComponentOptions("voice", {
      model: "azure-realtime",
      voice: "ava",
      stt: "azure-speech",
    }).some((item) => item.id === "ava" && item.compatible),
  );
  assert.ok(
    pipelineComponentOptions("voice", {
      model: "azure-realtime",
      voice: "ava",
      stt: "azure-speech",
    }).some((item) => item.id === "alloy" && item.compatible),
  );
});

test("offers Azure Speech Omni voices without confusing them with Azure Realtime native voices", () => {
  const voices = [
    "en-US-Emma:DragonHDOmniLatestNeural",
    "en-US-Brian:DragonHDOmniLatestNeural",
  ];
  for (const model of PIPELINE_COMPONENTS.model) {
    const options = pipelineComponentOptions("voice", { model: model.id });
    for (const id of voices) {
      const option = options.find((item) => item.id === id);
      assert.ok(option, `Missing ${id} for ${model.id}`);
      assert.equal(option.type, "azure-standard");
      assert.equal(option.compatible, true);
      if (option.compatible) {
        const pipeline = estimatePipeline({ model: model.id, voice: id }).pipeline;
        assert.equal(pipeline.voice.id, id);
        assert.ok(pipelineTotals(pipeline));
      }
    }
    const native = options.find((item) => item.id === "emma");
    assert.equal(native.compatible, true);
    assert.equal(native.incompatibility, "");
    assert.equal(options.length, PIPELINE_COMPONENTS.voice.length);
  }
  assert.equal(pipelineComponentOptions("voice", { model: "custom-deployment" }).length, PIPELINE_COMPONENTS.voice.length);
});

test("groups every voice once under its locale without guessing locales for short names", () => {
  const groups = groupVoicesByLocale(PIPELINE_COMPONENTS.voice);
  assert.deepEqual(groups.map((group) => group.locale), ["en-IN", "en-US", "zh-CN", ""]);
  assert.equal(groups.flatMap((group) => group.items).length, PIPELINE_COMPONENTS.voice.length);
  assert.equal(voiceLocale("en-US-Emma:DragonHDOmniLatestNeural"), "en-US");
  assert.equal(voiceLocale("zh-CN-XiaoxiaoNeural"), "zh-CN");
  assert.equal(voiceLocale("emma"), "");
  assert.equal(voiceLocale({ id: "emma", locale: "en-US" }), "en-US");
  assert.equal(voiceLocale({ id: "diya", locale: "hi-IN" }), "hi-IN");
  assert.ok(groups.find((group) => group.locale === "en-US").items.some((voice) => voice.id.includes("Emma:DragonHDOmni")));
  assert.ok(groups.at(-1).items.some((voice) => voice.id === "emma"));
  assert.equal(groups.at(-1).label, "No fixed locale");
});

test("uses a discovered voice catalog without limiting choices to the static shortlist", () => {
  const voices = [
    { id: "hi-IN-SwaraNeural", type: "azure-standard", locale: "hi-IN", label: "Swara" },
    { id: "diya", type: "azure-realtime-native", locale: "hi-IN", label: "Diya" },
  ];
  const options = pipelineComponentOptions("voice", { model: "gpt-realtime", voices });
  assert.deepEqual(options.map((voice) => voice.id), voices.map((voice) => voice.id));
  assert.ok(options.every((voice) => voice.compatible && voice.locale === "hi-IN"));
  assert.equal(groupVoicesByLocale(options)[0].locale, "hi-IN");
});

test("offers current cascaded models and Voice Live transcription choices", () => {
  const cascadedModels = pipelineComponentOptions("model")
    .filter((item) => item.architecture === "cascaded")
    .map((item) => item.id);
  assert.deepEqual(cascadedModels, [
    "gpt-5.4",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-6-sol",
    "gpt-6.1-sol",
    "gpt-6-luna",
    "gpt-oss-120b",
  ]);
  const transcribers = pipelineComponentOptions("stt", {
    model: "gpt-5.4",
    voice: "en-US-Ava:DragonHDLatestNeural",
    stt: "mai-transcribe-2",
  });

  assert.ok(transcribers.some((item) => item.id === "azure-speech" && item.compatible));
  assert.ok(transcribers.some((item) => item.id === "mai-transcribe-2-streaming" && item.compatible));
  assert.ok(transcribers.some((item) => item.id === "gpt-4o-transcribe-diarize" && item.compatible));
  assert.ok(transcribers.some((item) => item.id === "whisper-1" && item.compatible));
});

test("separates verified speech meters from unverified auxiliary transcription allowances", () => {
  const realtimeStt = pipelineComponentOptions("stt", {
    model: "gpt-realtime",
    voice: "alloy",
    stt: "whisper-1",
  });
  assert.equal(realtimeStt.find((item) => item.id === "azure-speech").latencyMs, 1016);
  assert.equal(realtimeStt.find((item) => item.id === "mai-transcribe-2-streaming").latencyMs, 130);
  assert.equal(realtimeStt.find((item) => item.id === "gpt-realtime-whisper").latencyMs, 740);
  assert.equal(realtimeStt.find((item) => item.id === "gpt-4o-transcribe").latencyMs, 637);
  assert.equal(realtimeStt.find((item) => item.id === "whisper-1").latencyMs, 1507);
  for (const model of ["gpt-realtime", "gpt-realtime-mini"]) {
    const choices = pipelineComponentOptions("stt", { model, voice: "alloy" });
    assert.equal(choices.length, 11);
    for (const choice of choices) {
      if (["azure-speech", "mai-transcribe", "mai-transcribe-2", "mai-transcribe-2-streaming"].includes(choice.id)) {
        assert.equal(choice.costPerMinute, model === "gpt-realtime" ? .0102 : .009);
        assert.equal(choice.costIsAllowance, false);
      } else {
        assert.equal(choice.costPerMinute, .02, choice.id);
        assert.equal(choice.costIsAllowance, true);
        assert.equal(choice.publicRateLabel, "");
        assert.match(choice.costSource, /unverified/);
      }
    }
  }
  assert.equal(
    realtimeStt.find((item) => item.id === "mai-transcribe-2-streaming").publicRateLabel,
    "$17 / 1M Voice Live speech-input tokens",
  );
  assert.equal(
    realtimeStt.find((item) => item.id === "mai-transcribe-2").costPerMinute,
    0.0102,
  );

  const realtimeVoices = pipelineComponentOptions("voice", {
    model: "gpt-realtime",
    voice: "alloy",
    stt: "whisper-1",
  });
  const alloy = realtimeVoices.find((item) => item.id === "alloy");
  assert.equal(alloy.latencyMs, null);
  assert.equal(alloy.latencyIncludedInModel, true);
  assert.equal(
    realtimeVoices.find((item) => item.id === "en-US-Ava:DragonHDLatestNeural").latencyMs,
    307,
  );
  const realtime = estimatePipeline({
    model: "gpt-realtime",
    stt: "whisper-1",
    voice: "alloy",
  }).pipeline;
  assert.equal(realtime.stt.costPerMinute, 0.02);
  assert.equal(realtime.stt.noAdditionalCost, undefined);
  assert.ok(Math.abs(realtime.model.costPerMinute - .032) < 1e-12);
  assert.equal(
    realtime.model.publicRateLabel,
    "$32 audio input + $4 text input + $16 text output / 1M tokens",
  );
  assert.equal(realtime.voice.costPerMinute, 0.0768);
  assert.equal(
    realtime.voice.publicRateLabel,
    "$64 / 1M native audio-output tokens",
  );
  assert.ok(Math.abs(pipelineTotals(realtime).costPerMinute - .1288) < 1e-12);

  const noTranscript = estimatePipeline({
    model: "gpt-realtime",
    stt: "native-realtime-audio",
    voice: "alloy",
  }).pipeline;
  assert.equal(noTranscript.stt.costPerMinute, 0);
  assert.equal(noTranscript.stt.noAdditionalCost, true);
  assert.ok(Math.abs(pipelineTotals(noTranscript).costPerMinute - .1088) < 1e-12);
});

test("does not assign publicly unverified models bargain rates based on their names", () => {
  const standard = estimatePipeline({
    model: "gpt-5.6-luna",
    stt: "azure-speech",
    voice: "en-US-Ava:DragonHDLatestNeural",
  }).pipeline;
  assert.deepEqual(
    [standard.stt.costPerMinute, standard.model.costPerMinute, standard.voice.costPerMinute],
    [0.009, 0.4752 / 150, 0.0312],
  );
  assert.ok(Math.abs(pipelineTotals(standard).costPerMinute - .043368) < 1e-12);

  const lite = estimatePipeline({
    model: "gpt-6-luna",
    stt: "azure-speech",
    voice: "en-US-Ava:DragonHDLatestNeural",
  }).pipeline;
  assert.deepEqual(
    [lite.stt.costPerMinute, lite.model.costPerMinute, lite.voice.costPerMinute],
    [0.0102, 4.44 / 150, 0.0372],
  );
  for (const component of [lite.stt, lite.model, lite.voice]) {
    assert.equal(component.publicRateLabel, "");
    assert.equal(component.costIsAllowance, true);
  }
  assert.ok(Math.abs(pipelineTotals(lite).costPerMinute - .077) < 1e-12);
  assert.ok(Math.abs(
    pipelineTotals(lite).costPerMinute
      - (lite.stt.costPerMinute + lite.model.costPerMinute + lite.voice.costPerMinute),
  ) < 1e-12);
});

test("prices every compatible catalog combination without omitting or double-counting components", () => {
  assert.equal(PIPELINE_COMPONENTS.model.length, 14);
  assert.equal(PIPELINE_COMPONENTS.stt.length, 12);
  assert.equal(PIPELINE_COMPONENTS.voice.length, 56);
  let checked = 0;
  for (const model of PIPELINE_COMPONENTS.model) {
    for (const voice of pipelineComponentOptions("voice", { model: model.id }).filter((item) => item.compatible)) {
      for (const stt of pipelineComponentOptions("stt", { model: model.id, voice: voice.id }).filter((item) => item.compatible)) {
        const pipeline = estimatePipeline({ model: model.id, voice: voice.id, stt: stt.id }).pipeline;
        if (pipeline.available === false) {
          assert.equal(pipelineTotals(pipeline), null);
          continue;
        }
        const components = [pipeline.stt, pipeline.model, pipeline.voice];
        assert.ok(components.every((component) => Number.isFinite(component.costPerMinute)));
        assert.ok(pipeline.model.costPerMinute > 0);
        assert.ok(pipeline.voice.costPerMinute > 0);
        if (stt.id !== "native-realtime-audio") assert.ok(pipeline.stt.costPerMinute > 0);
        assert.ok(Math.abs(
          pipelineTotals(pipeline).costPerMinute
            - components.reduce((total, component) => total + component.costPerMinute, 0),
        ) < 1e-12);
        checked += 1;
      }
    }
  }
  assert.ok(checked > 1_000);
});

test("does not price configured Custom Speech recognition at the lower Standard Speech rate", () => {
  for (const [model, expected] of [
    ["gpt-5.4", .024],
    ["gpt-5.6-luna", .0234],
    ["gpt-6-luna", .024],
  ]) {
    const selection = {
      model, stt: "azure-speech", voice: "en-US-Ava:DragonHDLatestNeural", customSpeech: true,
    };
    const pipeline = estimatePipeline(selection).pipeline;
    assert.equal(pipeline.stt.costPerMinute, expected);
    assert.match(pipeline.stt.costSource, /Custom Speech|Conservative/);
    const row = pipelineComponentOptions("stt", selection).find((item) => item.id === "azure-speech");
    assert.equal(row.costPerMinute, expected);
    assert.equal(row.costSource, pipeline.stt.costSource);
  }
});

test("uses the declared voice family for standard, custom and personal output costs", () => {
  const selection = { model: "gpt-realtime", stt: "native-realtime-audio" };
  for (const [voice, voiceType, amount, allowance] of [
    ["en-US-AvaNeural", "azure-standard", .0372, false],
    ["customer-voice", "azure-custom", .066, false],
    ["customer-voice", "azure-personal", .066, true],
    ["en-US-Ava:DragonHDLatestNeural", "azure-custom", .066, false],
  ]) {
    const pipeline = estimatePipeline({ ...selection, voice, voiceType }).pipeline;
    assert.equal(pipeline.voice.type, voiceType);
    assert.equal(pipeline.voice.costPerMinute, amount);
    assert.equal(pipeline.voice.costIsAllowance, allowance);
    assert.ok(pipelineTotals(pipeline));
  }
  assert.equal(
    estimatePipeline({ ...selection, voice: "en-US-AvaNeural" }).pipeline.voice.costPerMinute,
    .0372,
  );
  assert.equal(
    pipelineTotals(estimatePipeline({ ...selection, voice: "unknown-voice" }).pipeline),
    null,
  );
});

test("does not report a partial or nonfinite pipeline cost as a valid total", () => {
  for (const costPerMinute of [null, undefined, NaN, Infinity, -1]) {
    assert.equal(pipelineTotals({
      stt: { costPerMinute: .01 },
      model: { costPerMinute },
      voice: { costPerMinute: .03 },
    }), null);
  }
});

test("labels providers and sorts table metrics by the minimum estimate", () => {
  const models = pipelineComponentOptions("model");
  assert.equal(
    pipelineComponentProvider(
      "voice",
      pipelineComponentOptions("voice", {
        model: "gpt-realtime",
        voice: "alloy",
        stt: "whisper-1",
      }).find((item) => item.id === "en-US-Ava:DragonHDLatestNeural"),
    ),
    "Azure Speech",
  );
  assert.equal(
    pipelineComponentProvider(
      "voice",
      pipelineComponentOptions("voice", {
        model: "gpt-realtime",
        voice: "alloy",
        stt: "whisper-1",
      }).find((item) => item.id === "alloy"),
    ),
    "GPT native",
  );
  const realtime = models.find((item) => item.id === "gpt-realtime");
  assert.equal(pipelineMetricMinimum(realtime, "latency"), realtime.latencyMinMs);
  assert.deepEqual(
    sortPipelineComponents("model", models, { key: "latency", direction: "asc" })
      .slice(0, 3)
      .map((item) => item.id),
    ["gpt-realtime-mini", "azure-realtime", "gpt-realtime-1.5"],
  );
  assert.equal(
    sortPipelineComponents("model", models, { key: "cost", direction: "desc" })[0]
      .costPerMinute,
    Math.max(...models.map((item) => item.costPerMinute)),
  );
});

test("GPT Realtime allows Azure Speech as well as Whisper across every graph node", () => {
  for (const model of ["gpt-realtime", "gpt-realtime-2025-08-28"]) {
    const options = pipelineComponentOptions("stt", {
      model, models: [model, model], stt: "whisper-1",
    });
    for (const stt of ["azure-speech", "whisper-1"]) {
      assert.equal(options.find((item) => item.id === stt)?.compatible, true);
      const definition = createBlankDefinition();
      definition.model = model;
      definition.audio.input.transcription.model = stt;
      for (const node of definition.handoff.nodes) node.config.model = model;
      assert.deepEqual(validateDefinition(definition), []);
    }
  }
});

test("STT choices are never locked by graph models, including custom deployments", () => {
  const expected = PIPELINE_COMPONENTS.stt.filter((item) => item.id !== "native-realtime-audio")
    .map((item) => item.id);
  for (const model of ["gpt-realtime", "gpt-5.6-luna", "azure-realtime", "custom-deployment", undefined]) {
    const transcribers = pipelineComponentOptions("stt", {
      model, models: ["gpt-realtime-2.1", "gpt-5.6-luna"], stt: "whisper-1",
    });
    assert.deepEqual(transcribers.map((item) => item.id), expected);
    assert.ok(transcribers.every((item) => item.compatible && !item.incompatibility));
  }
});

test("model and STT combination validation is left to the service", () => {
  const definition = createSampleDefinition();
  definition.handoff.nodes[0].config.model = "gpt-5.6-luna";
  definition.handoff.nodes[0].config.voice = "alloy";
  const problems = validateDefinition(definition);
  assert.deepEqual(problems, []);
});

test("matches Agent names by case-insensitive partial terms", () => {
  assert.equal(matchesAgentSearch("frontdesk-fluency-v12-baseline", "FLU v12"), true);
  assert.equal(matchesAgentSearch("frontdesk-fluency-v12-baseline", "front base"), true);
  assert.equal(matchesAgentSearch("frontdesk-fluency-v12-baseline", "finance"), false);
  assert.equal(matchesAgentSearch("frontdesk-fluency-v12-baseline", "  "), true);
});

test("anchors reverse edges to the selected left or right node sides", () => {
  const from = { x: 300, y: 500, width: 320, height: 160 };
  const to = { x: 100, y: 100, width: 320, height: 160 };

  assert.deepEqual(sideEdgeAnchors(from, to, -80), {
    side: "left",
    sourceX: 300,
    sourceY: 580,
    targetX: 100,
    targetY: 180,
  });
  assert.deepEqual(sideEdgeAnchors(from, to, 900), {
    side: "right",
    sourceX: 620,
    sourceY: 580,
    targetX: 420,
    targetY: 180,
  });
});

test("classifies prominent node pipeline brands", () => {
  assert.equal(pipelineBrand("stt", "mai-transcribe-2"), "mai");
  assert.equal(pipelineBrand("stt", "whisper-1"), "whisper");
  assert.equal(pipelineBrand("stt", "azure-speech"), "azure");
  assert.equal(pipelineBrand("model", "gpt-realtime-2.1"), "gpt");
  assert.equal(pipelineBrand("voice", "en-US-Ava:DragonHDLatestNeural"), "azure");
});

test("draws every edge as a smooth curve between the exact handle centers", () => {
  const adjacent = smoothVerticalEdgePath(140, 246, 326, 445);
  const jump = smoothOuterEdgePath(140, 246, 326, 1145, 620);
  const feedback = smoothOuterEdgePath(326, 1145, 140, 246, -120);

  assert.equal(adjacent, "M140,246 C140,345.5 326,345.5 326,445");
  assert.doesNotMatch(adjacent, /\bL\b/);
  assert.equal(jump, "M140,246 C620,246 620,1145 326,1145");
  assert.doesNotMatch(jump, /\bL\b/);
  assert.equal(feedback, "M326,1145 C-120,1145 -120,246 140,246");
  assert.doesNotMatch(feedback, /\bL\b/);
});

test("lays out the handoff graph from top to bottom with readable layer gaps", () => {
  const positions = layoutHandoffGraph(
    [ENTRYPOINT_ID, "identify", "billing", "support", "done"],
    [
      { id: "start", source: ENTRYPOINT_ID, target: "identify" },
      { id: "identify_billing", source: "identify", target: "billing" },
      { id: "identify_support", source: "identify", target: "support" },
      { id: "billing_done", source: "billing", target: "done" },
      { id: "support_done", source: "support", target: "done" },
    ],
  );

  assert.ok(positions.get(ENTRYPOINT_ID).y < positions.get("identify").y);
  assert.equal(positions.get("billing").y, positions.get("support").y);
  assert.ok(Math.abs(positions.get("billing").x - positions.get("support").x) >= 372);
  assert.ok(positions.get("billing").y < positions.get("done").y);
  assert.equal(positions.get(ENTRYPOINT_ID).x, positions.get("identify").x);
});

test("keeps cycles finite and places disconnected nodes after the reachable graph", () => {
  const positions = layoutHandoffGraph(
    [ENTRYPOINT_ID, "one", "two", "orphan"],
    [
      { id: "start", source: ENTRYPOINT_ID, target: "one" },
      { id: "forward", source: "one", target: "two" },
      { id: "back", source: "two", target: "one" },
    ],
  );

  assert.ok(positions.get(ENTRYPOINT_ID).y < positions.get("one").y);
  assert.ok(positions.get("one").y < positions.get("two").y);
  assert.ok(positions.get("two").y < positions.get("orphan").y);
  for (const position of positions.values()) {
    assert.ok(Number.isFinite(position.x));
    assert.ok(Number.isFinite(position.y));
  }
});

test("keeps unknown root fields while adding an editable handoff graph", () => {
  const source = {
    kind: "voice",
    instructions: "Root",
    future_capability: { enabled: true, settings: ["one", "two"] },
  };

  const editable = ensureEditableDefinition(source);
  editable.handoff.nodes.push({
    id: "specialist",
    description: "Handle specialist requests.",
    config: { instructions: "Help.", tools: [], tool_choice: "auto" },
  });
  editable.handoff.edges.push({
    id: "start_to_specialist",
    source: ENTRYPOINT_ID,
    target: "specialist",
    description: "Use for specialist requests.",
  });

  assert.deepEqual(editable.future_capability, source.future_capability);
  assert.equal(source.handoff, undefined);
  assert.equal(validateDefinition(editable).filter((item) => item.severity === "error").length, 0);
});

test("JSON and YAML serializers are deterministic over one canonical state", () => {
  const definition = createSampleDefinition();
  const firstJson = stableJson(definition);
  const firstYaml = deterministicYaml(definition);

  assert.equal(stableJson(definition), firstJson);
  assert.equal(deterministicYaml(definition), firstYaml);
  assert.match(firstYaml, /^audio:/);
  assert.match(firstYaml, /handoff:/);
  assert.ok(firstYaml.includes('source: "$entrypoint"'));
});

test("imports exported definitions, wrappers and resources without dropping advanced fields", () => {
  const definition = createSampleDefinition();
  definition.audio.input.transcription = { model: "azure-speech", language: "en-IN,hi-IN" };
  definition.audio.input.echo_cancellation = {
    type: "server_echo_cancellation", reference_source: "server", channels: 1,
  };
  definition.future_capability = { enabled: true };
  for (const document of [
    definition,
    { name: "imported-agent", definition, description: "Imported", metadata: { owner: "test" } },
    { name: "imported-agent", versions: { latest: { definition, version: "3" } } },
  ]) {
    const result = parseAgentJson(JSON.stringify(document));
    assert.deepEqual(result.definition, definition);
    assert.equal(result.problems.filter((item) => item.severity === "error").length, 0);
    assert.equal(result.name, document.name || "");
  }
});

test("validates import syntax, required fields and malformed structures before normalization", () => {
  assert.throws(() => parseAgentJson("{"), /Invalid JSON/);
  assert.throws(() => parseAgentJson("[]"), /object/);
  assert.throws(() => parseAgentJson('{"definition":null}'), /definition must be an object/);
  for (const definition of [
    { kind: "prompt", model: "gpt-realtime" },
    { kind: "voice" },
    { kind: "voice", model: "gpt-realtime", handoff: { nodes: "bad", edges: [] } },
    { kind: "voice", model: "gpt-realtime", audio: { input: [] } },
    { kind: "voice", model: "gpt-realtime", tools: "bad" },
    { kind: "voice", model: "gpt-realtime", tools: [null] },
    { kind: "voice", model: "gpt-realtime", max_output_tokens: -1 },
    { kind: "voice", model: "gpt-realtime", include: [true] },
    { kind: "voice", model: "gpt-realtime", audio: { input: { turn_detection: { type: 3 } } } },
    { kind: "voice", model: "gpt-realtime", handoff: { nodes: [{ id: 1 }], edges: [] } },
    { kind: "voice", model: "gpt-realtime", store: "yes" },
    { kind: "voice", model: "gpt-realtime", sub_protocol: "live" },
  ]) {
    const source = JSON.stringify(definition);
    assert.ok(parseAgentJson(source).problems.some((item) => item.severity === "error"), source);
    assert.equal(JSON.stringify(definition), source);
  }
});

test("imports JSON and YAML definitions, wrappers and resources through the same validation", () => {
  const definition = createSampleDefinition();
  definition.instructions = "First line: \u4f60\u597d\nSecond line.\n";
  definition.future_capability = {
    enabled: false, values: [0, null, "2026-10-28"], nested: { retained: true },
  };
  for (const document of [
    definition,
    { name: "imported-agent", definition, description: "Imported", metadata: { owner: "test" } },
    { name: "imported-agent", versions: { latest: {
      definition, version: "3", description: "Imported", metadata: { owner: "test" },
    } } },
  ]) {
    const expected = parseAgentJson(JSON.stringify(document));
    for (const source of [JSON.stringify(document), deterministicYaml(document)]) {
      assert.deepEqual(parseAgentSource(source), expected);
      assert.deepEqual(parseAgentSource(`\uFEFF${source}`), expected);
    }
  }
  const source = "kind: voice\nmodel: gpt-realtime\ninstructions: |\n  First line.\n  Second line.\n";
  assert.equal(parseAgentSource(source).definition.instructions, "First line.\nSecond line.\n");
});

test("YAML imports reject syntax errors, non-object documents, aliases and custom tags", () => {
  for (const source of [
    "", "{", "definition: [", "kind: voice\nkind: prompt\n", "kind: voice\n---\nkind: voice\n",
    "kind: voice\nmodel: &model gpt-realtime\ninstructions: *model\n",
    "kind: voice\nmodel: !!js/function 'function () {}'\n",
  ]) {
    assert.throws(() => parseAgentSource(source), /Invalid JSON or YAML/);
  }
  for (const source of ["null", "[]", "- voice\n", "voice"]) {
    assert.throws(() => parseAgentSource(source), /must contain an object/);
  }
  assert.throws(() => parseAgentSource("definition: null\n"), /definition must be an object/);
});

test("YAML imports retain the existing blocking field and graph validation", () => {
  const definition = createSampleDefinition();
  for (const invalid of [
    { ...definition, kind: "prompt" },
    { ...definition, model: "" },
    { ...definition, store: "yes" },
    { ...definition, handoff: { nodes: "bad", edges: [] } },
    { ...definition, sub_protocol: "live" },
    { ...definition, model_type: "hosted_agent", conversation_engine: {} },
  ]) {
    const source = deterministicYaml(invalid);
    assert.ok(parseAgentSource(source).problems.some((item) => item.severity === "error"), source);
  }
  definition.handoff.edges[0].target = "missing";
  assert.ok(parseAgentSource(deterministicYaml(definition)).problems.some(
    (item) => item.code === "unknown_edge_target",
  ));
});

test("rejects imported invalid graph routes and echo channel combinations", () => {
  const definition = createSampleDefinition();
  definition.handoff.edges[0].target = "missing";
  assert.ok(parseAgentJson(JSON.stringify(definition)).problems.some((item) => item.code === "unknown_edge_target"));
  delete definition.handoff;
  definition.audio.input.echo_cancellation = {
    type: "server_echo_cancellation", reference_source: "client", channels: 1,
  };
  assert.ok(parseAgentJson(JSON.stringify(definition)).problems.some((item) => item.code === "echo_cancellation_config"));
});

test("validation returns field and object scoped blocking problems", () => {
  const definition = createSampleDefinition();
  definition.handoff.max_attempts = 1;
  definition.handoff.edges[0].target = "missing";
  definition.handoff.nodes.push({
    id: "orphan",
    description: "",
    config: { instructions: "", tools: {} },
  });

  const problems = validateDefinition(definition);

  assert.ok(problems.some((item) => item.field === "max_attempts" && item.objectKind === "graph"));
  assert.ok(problems.some((item) => item.objectId === "start_to_support" && item.field === "target"));
  assert.ok(problems.some((item) => item.objectId === "orphan" && item.code === "unreachable_node"));
  assert.ok(problems.some((item) => item.objectId === "orphan" && item.field === "tools"));
});

test("validates managed runtime and interim-response fields", () => {
  const definition = createSampleDefinition();
  definition.store = true;
  definition.output_modalities = ["text", "audio"];
  definition.greeting = {
    type: "llm_generated",
    prompt: "Say hello.",
    fallback_text: "Hello.",
  };
  definition.audio = {
    input: {
      format: { type: "audio/pcm", rate: 24000 },
      turn_detection: { type: "azure_semantic_vad", threshold: 0.5 },
    },
    output: {
      format: { type: "audio/pcm", rate: 24000 },
      voice: "en-US-AvaNeural",
      voice_type: "azure-standard",
    },
  };
  definition.handoff.nodes[0].config.interim_response = {
    type: "static_interim_response",
    triggers: ["tool"],
    texts: ["One moment."],
  };
  definition.handoff.nodes[1].config.interim_response = null;
  assert.equal(validateDefinition(definition).filter((item) => item.severity === "error").length, 0);

  definition.greeting.prompt = "";
  definition.audio.input.format.rate = 0;
  definition.audio.input.turn_detection.threshold = 1.2;
  definition.handoff.nodes[0].config.interim_response.texts = [];
  const codes = new Set(validateDefinition(definition).map((item) => item.code));
  assert.ok(codes.has("greeting_prompt"));
  assert.ok(codes.has("audio_rate"));
  assert.ok(codes.has("turn_threshold"));
  assert.ok(codes.has("interim_response_texts"));
});

test("model indicators identify catalog estimates and unknown values honestly", () => {
  assert.deepEqual(modelEstimate("gpt-realtime-mini"), {
    latency: "Low",
    cost: "Low",
    source: "Estimated from Voice Live guidance and public retail tier",
    available: true,
  });
  assert.deepEqual(modelEstimate("custom-deployment"), {
    latency: "Not available",
    cost: "Not available",
    source: "No estimate for custom or unknown values",
    available: false,
  });
});

test("draft publication adds the required preview feature without duplicates", () => {
  assert.equal(
    publicationFeatures("VoiceAgents=V1Preview", false),
    "VoiceAgents=V1Preview",
  );
  assert.equal(
    publicationFeatures("VoiceAgents=V1Preview", true),
    "VoiceAgents=V1Preview,DraftAgents=V1Preview",
  );
  assert.equal(
    publicationFeatures(
      "VoiceAgents=V1Preview,DraftAgents=V1Preview",
      true,
    ),
    "VoiceAgents=V1Preview,DraftAgents=V1Preview",
  );
});

test("extracts latest complete definition and maps service validation details", () => {
  const definition = createSampleDefinition();
  definition.unknown_root = "preserved";
  const agent = extractLatestAgent({
    name: "handoff-agent",
    versions: {
      latest: {
        version: "12",
        draft: false,
        definition,
        metadata: { owner: "voice" },
      },
    },
  });

  assert.equal(agent.version, "12");
  assert.equal(agent.definition.unknown_root, "preserved");
  const problems = mergeServiceProblems([], {
    error: {
      details: [{
        code: "handoff_unknown_node",
        object_kind: "edge",
        object_id: "edge-a",
        field: "target",
        message: "Target does not exist.",
      }],
    },
  });
  assert.deepEqual(problems[0], {
    severity: "error",
    message: "Target does not exist.",
    objectKind: "edge",
    objectId: "edge-a",
    field: "target",
    code: "handoff_unknown_node",
    server: true,
  });
});
