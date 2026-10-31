// Copyright (c) Microsoft. All rights reserved.

import test from "node:test";
import assert from "node:assert/strict";
import { withSelectedAgent, withSessionTransport } from "./agentUrl.mjs";

test("adds the selected agent while preserving route, query, and hash", () => {
  assert.equal(
    withSelectedAgent(
      "http://localhost:8095/runtime/?backend=sample-project&autostart=1#session",
      "finance agent/mcp",
    ),
    "http://localhost:8095/runtime/?backend=sample-project&autostart=1&agent=finance+agent%2Fmcp#session",
  );
});

test("replaces or removes only the selected agent", () => {
  const current = "http://localhost:8095/runtime/?agent=old&backend=tip";
  assert.equal(
    withSelectedAgent(current, "new"),
    "http://localhost:8095/runtime/?agent=new&backend=tip",
  );
  assert.equal(
    withSelectedAgent(current, ""),
    "http://localhost:8095/runtime/?backend=tip",
  );
});

test("sets the session transport while preserving the selected agent, view, and hash", () => {
  for (const transport of ["websocket", "webrtc"]) {
    assert.equal(
      withSessionTransport(
        "http://localhost:9527/runtime/?agent=finance&view=handoff#session",
        transport,
      ),
      `http://localhost:9527/runtime/?agent=finance&view=handoff&transport=${transport}#session`,
    );
  }
});

test("replaces duplicate transport parameters without changing other URL fields", () => {
  assert.equal(
    withSessionTransport(
      "http://localhost:9527/runtime/?transport=websocket&agent=finance&transport=webrtc",
      "webrtc",
    ),
    "http://localhost:9527/runtime/?transport=webrtc&agent=finance",
  );
});

test("rejects unsupported session transports instead of creating misleading links", () => {
  for (const transport of ["", "rtc", "WebRTC", null, undefined]) {
    assert.throws(
      () => withSessionTransport("http://localhost:9527/runtime/", transport),
      /Transport must be "websocket" or "webrtc"/,
    );
  }
});
