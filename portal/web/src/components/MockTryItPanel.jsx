// Copyright (c) Microsoft. All rights reserved.
import { useEffect, useState } from "react";

const MOCK_TOOL_PREFIX = "mock_tool_call_";

// A Template published from the Editor carries its id in the version metadata.
export function sourceTemplateId(agent) {
  return String(agent?.metadata?.source_template_id || "").trim();
}

// Its tools still point at the shared mock MCP server until the user connects real systems.
export function mockTemplateId(agent) {
  const templateId = sourceTemplateId(agent);
  if (!templateId) return "";
  return JSON.stringify(agent?.definition || {}).includes(MOCK_TOOL_PREFIX) ? templateId : "";
}

function renderInline(text) {
  return text.split("`").map((part, index) => (index % 2 ? <code key={index}>{part}</code> : part));
}

// Any Template with "Try these turns" in its sample README shows them, e.g. the Finance test identity.
export function MockTryItPanel({ agent }) {
  const templateId = sourceTemplateId(agent);
  const mock = Boolean(mockTemplateId(agent));
  const [turns, setTurns] = useState([]);
  const [note, setNote] = useState("");

  useEffect(() => {
    setTurns([]);
    setNote("");
    if (!templateId) return undefined;
    const controller = new AbortController();
    fetch(`/api/templates/${encodeURIComponent(templateId)}/try-it`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        setTurns(Array.isArray(payload?.turns) ? payload.turns : []);
        setNote(typeof payload?.note === "string" ? payload.note : "");
      })
      .catch(() => {});
    return () => controller.abort();
  }, [templateId]);

  if (!templateId || !turns.length) return null;
  return (
    <details className="mock-try-it" open>
      <summary>{mock ? "Test data for mock tools" : note ? "Try these turns" : "Test data"}</summary>
      <p>
        {mock
          ? "This Agent uses mock tool calls with fixed, fictional test data. Use the names, numbers, and answers below; other values are treated as unknown records."
          : note || "This Agent's sample service uses fixed, fictional test data. Use the details below when the Agent asks."}
      </p>
      <ol>
        {turns.map((turn, index) => <li key={index}>{renderInline(turn)}</li>)}
      </ol>
    </details>
  );
}
