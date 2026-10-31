// Copyright (c) Microsoft Corporation. All rights reserved.
// Run with: node --test test_frames.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { MAX_IMAGE_BYTES, dataUrlByteSize, fitFrameSize, validateImageFile } from "./static/frames.mjs";

test("fitFrameSize keeps aspect ratio and never upscales", () => {
  assert.deepEqual(fitFrameSize(1920, 1080), { width: 1280, height: 720 });
  assert.deepEqual(fitFrameSize(640, 480), { width: 640, height: 480 });
  assert.deepEqual(fitFrameSize(1080, 1920), { width: 405, height: 720 });
  assert.throws(() => fitFrameSize(0, 10));
});

test("dataUrlByteSize decodes base64 length", () => {
  assert.equal(dataUrlByteSize("data:image/png;base64,aGVsbG8="), 5);
  assert.equal(dataUrlByteSize("data:image/png;base64,aGk="), 2);
  assert.equal(dataUrlByteSize("not a data url"), 0);
});

test("validateImageFile enforces type and size", () => {
  assert.equal(validateImageFile({ type: "image/webp", size: MAX_IMAGE_BYTES }), "");
  assert.match(validateImageFile({ type: "image/gif", size: 1 }), /JPEG/);
  assert.match(validateImageFile({ type: "image/png", size: MAX_IMAGE_BYTES + 1 }), /no larger/);
  assert.match(validateImageFile(null), /Choose/);
});
