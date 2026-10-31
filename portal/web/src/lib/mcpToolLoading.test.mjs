// Copyright (c) Microsoft. All rights reserved.

import test from "node:test";
import assert from "node:assert/strict";
import { pendingMcpToolListings, settleMcpToolListing } from "./mcpToolLoading.mjs";

test("counts one pending listing per MCP tool and ignores other tools", () => {
  assert.equal(pendingMcpToolListings([
    { type: "mcp", server_label: "conference" },
    { type: "end_conversation" },
    { type: "foundry_toolbox", server_label: "workiq" },
    { type: "mcp", server_label: "kb" },
    { type: "function", name: "lookup" },
  ]), 2);
});

test("has nothing pending without MCP tools or a tool list", () => {
  assert.equal(pendingMcpToolListings([{ type: "end_conversation" }]), 0);
  assert.equal(pendingMcpToolListings(undefined), 0);
  assert.equal(pendingMcpToolListings(null), 0);
});

test("settling a listing never goes below zero", () => {
  assert.equal(settleMcpToolListing(2), 1);
  assert.equal(settleMcpToolListing(1), 0);
  assert.equal(settleMcpToolListing(0), 0);
  assert.equal(settleMcpToolListing(undefined), 0);
});
