// Copyright (c) Microsoft. All rights reserved.

// Voice Live lists each `mcp` tool's server after the session starts. A turn sent before that
// listing completes can be answered with a plain `function_call` for an MCP tool name, which
// nobody executes, and the session stays stuck. The Playground therefore holds input until every
// MCP server in the session has reported `mcp_list_tools.completed` or `.failed`.

// Longest wait before input is released anyway, so a missing completion event cannot lock the UI.
export const MCP_TOOL_LOADING_TIMEOUT_MS = 30000;

// The number of MCP tool listings a session will report.
export function pendingMcpToolListings(tools) {
  return (Array.isArray(tools) ? tools : []).filter((tool) => tool && tool.type === "mcp").length;
}

// The listings still pending after one completed or failed.
export function settleMcpToolListing(pending) {
  return Math.max(0, (Number(pending) || 0) - 1);
}
