// Copyright (c) Microsoft. All rights reserved.
import assert from "node:assert/strict";
import test from "node:test";
import { filterVoiceGroups, voiceMatchCount } from "../../../static/handoff/voice-picker.mjs";

const groups = [
  { locale: "en-US", label: "en-US English (United States)", items: [
    { id: "en-US-AvaNeural", label: "Ava", type: "azure-standard" },
    { id: "en-US-AvaMultilingualNeural", label: "Ava Multilingual", type: "azure-standard" },
    { id: "en-US-Ava:DragonHDLatestNeural", label: "Ava HD", type: "azure-standard" },
    { id: "en-US-Emma:DragonHDOmniLatestNeural", label: "Emma", type: "azure-standard" },
  ] },
  { locale: "hi-IN", label: "hi-IN Hindi (India)", items: [
    { id: "hi-IN-SwaraNeural", label: "Swara", type: "azure-standard" },
    { id: "diya", label: "Diya", type: "azure-realtime-native", secondaryLocales: ["en-IN"] },
  ] },
  { locale: "zh-CN", label: "zh-CN Chinese (China)", items: [
    { id: "zh-CN-XiaoxiaoNeural", label: "Xiaoxiao", type: "azure-standard" },
  ] },
];

test("locale accepts codes, partial names, case and separator variations", () => {
  for (const query of ["en-US", "EN_us", "en us", "enus", "English", "United States"]) {
    assert.deepEqual(filterVoiceGroups(groups, query).map((group) => group.locale), ["en-US"], query);
  }
  for (const query of ["hi", "hi-IN", "hi in", "Hindi", "Hindi India"]) {
    assert.deepEqual(filterVoiceGroups(groups, query).map((group) => group.locale), ["hi-IN"], query);
  }
  assert.equal(voiceMatchCount(filterVoiceGroups(groups, "Chinese")), 1);
});

test("voice search narrows names, variants and complete IDs within a locale", () => {
  assert.equal(voiceMatchCount(filterVoiceGroups(groups, "en-US", "ava")), 3);
  assert.equal(voiceMatchCount(filterVoiceGroups(groups, "", "EN US AVA")), 3);
  assert.equal(voiceMatchCount(filterVoiceGroups(groups, "", "ava dragon hd")), 1);
  assert.equal(voiceMatchCount(filterVoiceGroups(groups, "", "en-US-AvaMultilingualNeural")), 1);
  assert.equal(voiceMatchCount(filterVoiceGroups(groups, "Hindi", "swara")), 1);
});

test("empty, cleared, and unmatched filters are explicit and never mutate the catalog", () => {
  const original = structuredClone(groups);
  for (const locale of ["", "All", "All locales"]) {
    assert.equal(voiceMatchCount(filterVoiceGroups(groups, locale)), 7);
  }
  assert.deepEqual(filterVoiceGroups(groups, "not-a-locale"), []);
  assert.deepEqual(filterVoiceGroups(groups, "hi-IN", "Ava"), []);
  filterVoiceGroups(groups, "en-US", "ava");
  assert.deepEqual(groups, original);
});

test("runtime option values are searchable as well as editor IDs", () => {
  const runtime = [{ locale: "en-US", label: "English", items: [
    { value: "en-US-AvaNeural", label: "Ava" },
  ] }];
  assert.equal(voiceMatchCount(filterVoiceGroups(runtime, "en-US", "ava")), 1);
});
