import test from "node:test";
import assert from "node:assert/strict";
import { initialState, controlDevice, lookupManual, clarifyFridge } from "./demo.mjs";

test("power and temperature operations update only the requested simulated device", () => {
  const original = initialState();
  const powered = controlDevice(original, { device: "ac", action: "power", value: true });
  const adjusted = controlDevice(powered.state, { device: "ac", action: "temperature", value: 24 });
  assert.equal(adjusted.state.ac.temperature, 24);
  assert.equal(adjusted.state.ac.power, true);
  assert.equal(original.ac.power, false);
  assert.deepEqual(adjusted.state.fridge, original.fridge);
  assert.equal(controlDevice(adjusted.state, { device: "ac", action: "power", value: false }).state.ac.power, false);
});

test("invalid or unsupported operations never mutate state", () => {
  const state = initialState();
  for (const request of [
    { device: "ac", action: "temperature", value: 15 },
    { device: "ac", action: "temperature", value: 31 },
    { device: "ac", action: "temperature", value: 26.5 },
    { device: "ac", action: "temperature", value: "26" },
    { device: "tv", action: "power", value: "true" },
    { device: "tv", action: "temperature", value: 26 },
    { device: "unknown", action: "power", value: true },
    { device: "toString", action: "power", value: true },
  ]) {
    const result = controlDevice(state, request);
    assert.equal(result.status, "rejected");
    assert.equal(result.state, state);
  }
  for (const value of [16, 30]) assert.equal(controlDevice(state, { device: "ac", action: "temperature", value }).status, "ok");
});

test("offline television fails explicitly while a separate light command still succeeds", () => {
  const state = initialState();
  state.tv.online = false;
  const result = controlDevice(state, { device: "tv", action: "power", value: true });
  assert.equal(result.status, "offline");
  assert.equal(result.state.tv.power, false);
  assert.equal(controlDevice(result.state, { device: "light", action: "power", value: false }).state.light.power, false);
});

test("fridge power and door requests require clarification and cannot mutate state", () => {
  const state = initialState();
  for (const action of ["power", "door"]) {
    const result = controlDevice(state, { device: "fridge", action, value: false });
    assert.equal(result.status, "confirmation_required");
    assert.equal(result.state, state);
  }
  assert.match(clarifyFridge("door"), /不支持电动开门/);
  assert.match(clarifyFridge("power"), /已经通电/);
  assert.match(clarifyFridge("cancel"), /没有改变/);
  assert.match(clarifyFridge("unknown"), /未识别/);
});

test("manual answers require matching model and topic and return a traceable source", () => {
  const result = lookupManual("DEMO AC-01", "clean");
  assert.equal(result.status, "found");
  assert.equal(result.source.page, 12);
  assert.match(result.source.title, /虚构/);
  assert.equal(result.message, result.source.text);
  for (const [model, topic] of [["DEMO TV-01", "warranty"], ["DEMO RF-01", "clean"], ["unknown", "intro"]]) {
    const missing = lookupManual(model, topic);
    assert.equal(missing.status, "not_found");
    assert.equal(missing.source, null);
    assert.match(missing.message, /不能确认/);
  }
});
