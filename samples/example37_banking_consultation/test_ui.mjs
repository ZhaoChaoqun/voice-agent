import assert from "node:assert/strict";
import test from "node:test";
import { chooseModel, chooseVoice, preferenceKey, readPreferences, savePreferences, updateTranscript } from "./static/state.mjs";

const models = {
  gpt: { default_voice: "harper", voices: [{ id: "harper" }, { id: "gpt-other" }] },
  azure: { default_voice: "ava", voices: [{ id: "ava" }, { id: "andrew" }] },
};

test("model changes reset only to that model's legal voice; connecting/calling locks both", () => {
  const old = { model: "gpt", voice: "gpt-other" };
  const azure = chooseModel(old, "azure", false, models);
  assert.deepEqual(azure, { model: "azure", voice: "ava" });
  assert.deepEqual(chooseVoice(azure, "andrew", false, models), { model: "azure", voice: "andrew" });
  assert.equal(chooseVoice(azure, "harper", false, models), azure);
  assert.equal(chooseModel(old, "azure", true, models), old);
  assert.equal(chooseVoice(old, "harper", true, models), old);
  assert.equal(chooseModel(old, "unknown", false, models), old);
});

test("only model, voice and language preferences persist; corrupt or obsolete choices reset", t => {
  const values = new Map();
  const storage = () => ({
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  });
  assert.equal(savePreferences({ model: "azure", voice: "andrew" }, "zh", models, storage), true);
  assert.deepEqual(readPreferences(models, "gpt", storage), { model: "azure", voice: "andrew", language: "zh" });
  assert.equal(values.size, 1);
  t.mock.method(console, "warn", () => {});
  for (const invalid of ["{", '{"model":"azure","voice":"harper","language":"zh"}', "null"]) {
    values.set(preferenceKey, invalid);
    assert.deepEqual(readPreferences(models, "gpt", storage), { model: "gpt", voice: "harper", language: "de" });
  }
  const denied = () => { throw new DOMException("Blocked", "SecurityError"); };
  assert.equal(savePreferences({ model: "gpt", voice: "harper" }, "en", models, denied), false);
});

test("completed captions replace deltas without translation or late duplication, and history is bounded", () => {
  const entries = new Map();
  for (const event of [
    { text: "Guten ", final: false }, { text: "Tag", final: false },
    { text: "Guten Tag.", final: true }, { text: "late", final: false },
  ]) updateTranscript(entries, { role: "assistant", id: "one", ...event });
  assert.equal(entries.get("assistant:one").text, "Guten Tag.");
  updateTranscript(entries, { role: "user", id: "one", text: "你好", final: true });
  assert.equal(entries.get("user:one").text, "你好");
  for (let index = 0; index < 210; index++) {
    updateTranscript(entries, { role: "user", id: String(index), text: "Synthetic caption.", final: true });
  }
  assert.equal(entries.size, 200);
  assert.equal(entries.has("assistant:one"), false);
});
