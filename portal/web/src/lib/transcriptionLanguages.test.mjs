// Copyright (c) Microsoft. All rights reserved.
import assert from "node:assert/strict";
import test from "node:test";
import {
  VOICE_LIVE_INPUT_LOCALES,
  AZURE_SPEECH_INPUT_LOCALES,
  buildInputTranscription,
  displayTranscriptionLanguage,
  normalizeTranscriptionLanguage,
  transcriptionLanguageError,
  transcriptionLanguageOptions,
} from "../../../static/handoff/transcription-languages.mjs";
import { createBlankDefinition, validateDefinition } from "../../../static/handoff/handoff-core.mjs";

test("Azure Speech exposes explicit locales beyond the default multilingual model", () => {
  assert.equal(VOICE_LIVE_INPUT_LOCALES.length, 15);
  assert.equal(new Set(VOICE_LIVE_INPUT_LOCALES).size, 15);
  const azure = transcriptionLanguageOptions("azure-speech");
  assert.equal(azure.length, AZURE_SPEECH_INPUT_LOCALES.length + 1);
  assert.equal(new Set(AZURE_SPEECH_INPUT_LOCALES).size, AZURE_SPEECH_INPUT_LOCALES.length);
  assert.ok(azure.some((option) => option.value === "ta-IN"));
  assert.ok(azure.some((option) => option.value === "ar-SA"));
  assert.ok(azure.some((option) => option.value === "sr-ME"));
  assert.ok(!transcriptionLanguageOptions("azure-fast-transcription").some((option) => option.value === "sr-ME"));
  assert.deepEqual(azure[0], { value: "", label: "Auto", disabled: false });
  assert.match(azure.find((option) => option.value === "hi-IN").label, /Hindi/);
  for (const model of ["mai-transcribe", "mai-transcribe-2", "mai-transcribe-2-streaming"]) {
    const options = transcriptionLanguageOptions(model);
    assert.equal(options.length, 16);
    assert.ok(options.some((option) => option.value === "hi-IN"));
  }
  assert.equal(transcriptionLanguageOptions("whisper-1").length, 16);
  assert.equal(transcriptionLanguageOptions("azure-llm-speech").length, 16);
});

test("language options sort by locale code and show the name in parentheses", () => {
  for (const model of ["azure-speech", "azure-speech-streaming", "azure-fast-transcription",
    "azure-llm-speech", "mai-transcribe-2", "mai-transcribe-2-streaming", "whisper-1", "gpt-4o-transcribe"]) {
    const options = transcriptionLanguageOptions(model);
    assert.equal(options[0].value, "");
    const locales = options.slice(1).map((option) => option.value);
    assert.deepEqual(locales, [...locales].sort((a, b) => a.localeCompare(b, "en")));
    assert.equal(options.find((option) => option.value === "en-IN").label, "en-IN (English (India))");
    for (const option of options.slice(1)) assert.ok(option.label.startsWith(`${option.value} (`));
  }
});

test("selection normalization preserves each explicit English locale instead of collapsing to en", () => {
  for (const model of ["azure-speech", "mai-transcribe-2", "whisper-1", "gpt-4o-transcribe"]) {
    for (const locale of ["en-AU", "en-CA", "en-GB", "en-IN", "en-US"]) {
      assert.equal(normalizeTranscriptionLanguage(model, locale), locale);
    }
    assert.equal(normalizeTranscriptionLanguage(model, "en-IN (English (India))"), "en-IN");
    assert.equal(normalizeTranscriptionLanguage(model, "English (India) - en-IN"), "en-IN");
  }
  assert.equal(buildInputTranscription("mai-transcribe-2", "en-IN").language, "en");
  assert.equal(buildInputTranscription("azure-speech", "en-IN").language, "en-IN");
});

test("Auto omits language and an explicit locale is sent unchanged", () => {
  assert.deepEqual(buildInputTranscription(), { model: "azure-speech" });
  assert.deepEqual(buildInputTranscription("azure-speech", "  "), { model: "azure-speech" });
  assert.deepEqual(buildInputTranscription("azure-speech", "hi-IN"), { model: "azure-speech", language: "hi-IN" });
  assert.equal(buildInputTranscription("azure-speech", "en-IN,hi-IN").language, "en-IN,hi-IN");
  assert.equal(buildInputTranscription("mai-transcribe-2", "hi").language, "hi");
  assert.equal(buildInputTranscription("gpt-4o-transcribe", "hi").language, "hi");
});

test("loading existing language candidates preserves their value and ordering", () => {
  const current = "en-IN,hi-IN";
  assert.equal(transcriptionLanguageOptions("azure-speech", current).length, AZURE_SPEECH_INPUT_LOCALES.length + 1);
  assert.equal(displayTranscriptionLanguage(current), "en-IN, hi-IN");
  assert.equal(transcriptionLanguageError("azure-speech", current), "");
  assert.equal(transcriptionLanguageError("mai-transcribe-2", "hi-IN"), "");
  assert.equal(transcriptionLanguageError("azure-speech", "en"), "");
  assert.equal(transcriptionLanguageError("azure-speech", "HI-in"), "");
  assert.equal(normalizeTranscriptionLanguage("azure-speech", "hi-in, en-in"), "hi-IN,en-IN");
});

test("selected language display lists actual locale codes in primary order", () => {
  assert.equal(displayTranscriptionLanguage("hi-IN,en-IN"), "hi-IN, en-IN");
  assert.equal(displayTranscriptionLanguage("en-IN,hi-IN"), "en-IN, hi-IN");
  assert.equal(displayTranscriptionLanguage("hi-in, en-in"), "hi-IN, en-IN");
  assert.equal(displayTranscriptionLanguage("en-US,fr-FR,ja-JP"), "en-US, fr-FR, ja-JP");
});

test("editable input accepts Auto, language names and loosely formatted locale codes", () => {
  for (const text of ["Auto", "auto", "  AUTO  ", ""]) {
    assert.deepEqual(buildInputTranscription("azure-speech", text), { model: "azure-speech" });
  }
  for (const text of ["Hindi", "Hindi (India)", "hi-IN", "HI_in", "hi in"]) {
    assert.equal(normalizeTranscriptionLanguage("azure-speech", text), "hi-IN");
    assert.equal(buildInputTranscription("azure-speech", text).language, "hi-IN");
  }
  assert.equal(buildInputTranscription("mai-transcribe-2", "Hindi").language, "hi");
  assert.equal(buildInputTranscription("gpt-4o-transcribe", "Hindi").language, "hi");
  assert.equal(buildInputTranscription("azure-speech", "en in, Hindi").language, "en-IN,hi-IN");
  assert.match(transcriptionLanguageError("azure-speech", "English"), /published Voice Live/);
});

test("model-specific invalid input languages are explicit errors, never silently reset", () => {
  assert.match(transcriptionLanguageError("mai-transcribe-2", "en-IN,hi-IN"), /only one/);
  assert.equal(transcriptionLanguageError("gpt-4o-transcribe", "hi-IN"), "");
  assert.match(transcriptionLanguageError("azure-speech", "not-a-locale"), /published Voice Live/);
  assert.match(transcriptionLanguageError("azure-speech", "hi-IN,"), /empty/);
  assert.match(transcriptionLanguageError("azure-speech", "en-IN,en-US"), /one locale per language/);
  assert.equal(transcriptionLanguageError("azure-speech", "ta-IN,hi-IN"), "");
  assert.match(transcriptionLanguageError("azure-speech", VOICE_LIVE_INPUT_LOCALES.slice(0, 11).join(",")), /at most 10/);
  assert.match(transcriptionLanguageError("azure-speech-streaming", ""), /requires an input language/);
  assert.equal(transcriptionLanguageError("azure-speech-streaming", "hi-IN"), "");
  assert.throws(() => buildInputTranscription("mai-transcribe-2", "en,hi"), /only one/);
  const definition = createBlankDefinition();
  definition.audio.input.transcription = { model: "mai-transcribe-2", language: "en,hi" };
  assert.ok(validateDefinition(definition).some((problem) => problem.code === "invalid_transcription_language"));
});
