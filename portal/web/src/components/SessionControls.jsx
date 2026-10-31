// Copyright (c) Microsoft. All rights reserved.
// Runtime connects with the published Agent configuration, without session overrides.

import { useEffect, useState } from "react";
import { withSelectedAgent, withSessionTransport } from "../lib/agentUrl.mjs";
import { Field, Icon } from "./ConfigControls.jsx";
import { SessionAgentPicker } from "./SessionAgentPicker.jsx";

export function SessionControls({
  cfg, session, agent, agents, agentListState, onSelectAgent, onRefreshAgents,
  onLoadMoreAgents, onExportAgent, transport, transportError, transportNotice,
}) {
  const [copyUrlState, setCopyUrlState] = useState({ text: "", kind: "", url: "" });
  const [agentQuery, setAgentQuery] = useState(agent?.name || "");
  const [agentSearchState, setAgentSearchState] = useState({
    searching: false,
    error: "",
  });
  const { isConnected, sessionReady, toolsLoading, micMuted, status } = session;
  const agentListBusy = agentListState.loading || agentListState.loadingMore;
  const agentQueryMatchesSelection = agentQuery.trim() === (agent?.name || "");

  useEffect(() => {
    setCopyUrlState({ text: "", kind: "", url: "" });
  }, [agent?.name, agent?.version, transport]);

  useEffect(() => {
    setAgentQuery(agent?.name || "");
    setAgentSearchState({ searching: false, error: "" });
  }, [agent?.name]);

  const searchAgent = async (requestedName = agentQuery) => {
    const name = requestedName.trim();
    if (!name || isConnected || agentListState.loading || agentSearchState.searching) return;
    setAgentQuery(name);
    setAgentSearchState({ searching: true, error: "" });
    try {
      const selectedName = await onSelectAgent(name);
      setAgentQuery(selectedName);
      setAgentSearchState({ searching: false, error: "" });
    } catch (error) {
      setAgentSearchState({
        searching: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const connect = () => session.connect(
    agent.name, "", "", cfg.apiVersion, transport, Boolean(agent.clientReferenceEc),
  );
  const copyAgentUrl = async () => {
    if (!agent?.name) return;
    const url = withSessionTransport(
      withSelectedAgent(window.location.href, agent.name), transport,
    );
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
        throw new Error("Clipboard API is unavailable in this browser context");
      }
      await navigator.clipboard.writeText(url);
      setCopyUrlState({ text: "Copied full URL", kind: "ok", url });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCopyUrlState({ text: `Copy failed: ${message}`, kind: "err", url });
      session.logError(`Copy Agent URL failed: ${message}`);
    }
  };
  const modelSource = agent?.inferenceMode === "hosted_agent"
    ? "Hosted agent"
    : agent?.inferenceMode === "deployment" ? "BYOM" : "Managed";
  const definition = agent?.definition;
  const input = definition?.audio?.input;
  const output = definition?.audio?.output;
  const inputLanguage = input?.transcription?.language || "Automatic (not set)";
  const echoCancellation = input?.echo_cancellation;
  const tools = definition?.tools || [];
  const structuredInputs = Object.keys(definition?.structured_inputs || {});

  return (
    <section className="session-controls" aria-label="Playground connection">
      <div className="playground-heading">
        <div><span className="eyebrow">TRY IT LIVE</span><h2>Playground</h2></div>
        <span className={`connection-status ${status.kind || ""}`} role="status">
          <span className="status-dot" />{status.text === "not connected" ? "Not connected" : status.text}
        </span>
      </div>
      <div className="agent-picker-row">
        <Field label="Session agent">
          <SessionAgentPicker agents={agents} value={agentQuery} selectedName={agent?.name || ""}
            disabled={isConnected || agentListState.loading}
            loading={agentListState.loading} busy={agentSearchState.searching}
            onChange={(value) => {
              setAgentQuery(value);
              setAgentSearchState((current) => ({ ...current, error: "" }));
            }}
            onResolve={searchAgent}
            onReset={() => {
              setAgentQuery(agent?.name || "");
              setAgentSearchState({ searching: false, error: "" });
            }} />
        </Field>
        <button className="definition-button agent-search-button" type="button"
          title="Search for an exact Agent name" aria-label="Search agent"
          disabled={isConnected || agentListState.loading || agentSearchState.searching || !agentQuery.trim()}
          onClick={() => searchAgent()}>
          <Icon name="search" /><span>{agentSearchState.searching ? "Searching…" : "Search"}</span>
        </button>
        <button className="icon-button" type="button" title="Refresh agents" aria-label="Refresh agents"
          disabled={isConnected || agentListBusy} onClick={onRefreshAgents}>
          <Icon name="refresh" className={agentListBusy ? "spin" : ""} />
        </button>
        <button className="definition-button" type="button" title="Export the complete definition as YAML or JSON"
          aria-label="Export"
          disabled={isConnected || agentListState.loading || !agent || !agentQueryMatchesSelection}
          onClick={onExportAgent}>
          <Icon name="code" /><span>Export</span>
        </button>
        <button className="definition-button" type="button" title="Copy URL to this agent"
          aria-label="Copy URL to this agent"
          disabled={!agent || !agentQueryMatchesSelection || Boolean(transportError)}
          onClick={copyAgentUrl}>
          <Icon name="external" /><span>URL</span>
        </button>
        {agentListState.hasMore || agentListState.loadingMore ? (
          <div className="agent-pagination">
            <span aria-live="polite">{agents.length} loaded</span>
            <button type="button" aria-label="Load more agents" title="Load more agents"
              disabled={agentListState.loadingMore} onClick={onLoadMoreAgents}>
              {agentListState.loadingMore ? "Loading…" : "More"}
            </button>
          </div>
        ) : null}
      </div>
      {!agentQueryMatchesSelection && agentQuery.trim() && !agentSearchState.error ? (
        <p className="agent-search-hint">Press Enter or Search to select this Agent name.</p>
      ) : null}
      {agentSearchState.error ? (
        <div className="form-feedback err" role="alert">{agentSearchState.error}</div>
      ) : null}
      {agentListState.error ? <div className="form-feedback err" role="alert">{agentListState.error}</div> : null}
      {transportError ? (
        <div className="form-feedback err" role="alert" id="session-transport-error">{transportError}</div>
      ) : null}
      {transportNotice ? <p className="field-hint" role="status">{transportNotice}</p> : null}
      {copyUrlState.text ? (
        <div className={`copy-agent-url-status ${copyUrlState.kind}`} role="status">
          <strong>{copyUrlState.text}</strong>
          <code>{copyUrlState.url}</code>
        </div>
      ) : null}
      <div className="session-actions">
        <div className="session-action-context">
          {agent ? (
            <div className="selected-agent-meta">
              <span className="subtle-badge">{modelSource}</span>
              <span title={agent.targetAgent?.name || agent.model}>{agent.model || agent.targetAgent?.name}</span>
              <span title={agent.voice}>{agent.voice || "Default voice"}</span>
              <span>v{agent.version || "latest"}</span>
            </div>
          ) : <p className="field-hint picker-hint">{agents.length} voice agent{agents.length === 1 ? "" : "s"} loaded. Creation is optional.</p>}
        </div>
        <div className="connection-buttons">
          {isConnected ? (
            <>
              <button type="button" className="icon-button" onClick={session.toggleMute}
                disabled={!sessionReady || toolsLoading} title={toolsLoading ? "Loading tools…" : micMuted ? "Unmute mic" : "Mute mic"}
                aria-label={micMuted ? "Unmute mic" : "Mute mic"}>
                <Icon name={micMuted ? "muted" : "voice"} />
              </button>
              <button type="button" className="danger" onClick={session.stopSession}><Icon name="stop" />Stop session</button>
            </>
          ) : (
            <button type="button" className="primary connect-button"
              disabled={!agent || agentListState.loading || !agentQueryMatchesSelection || Boolean(transportError)}
              onClick={connect}><Icon name="voice" />Connect & start session</button>
          )}
        </div>
      </div>
      {agent ? (
        <details className="agent-configuration" onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.currentTarget.removeAttribute("open");
            event.currentTarget.querySelector("summary")?.focus();
          }
        }}>
          <summary>
            <Icon name="code" /><strong>Agent configuration</strong>
            <span className="agent-configuration-preview">
              Input: {inputLanguage} · Storage: {agent.store ? "On" : "Off"}
            </span>
            <Icon name="chevron" />
          </summary>
          <div className="agent-configuration-body" role="region" aria-label="Agent configuration">
            <p className="field-hint">
              Read-only published configuration. Connections use these Agent settings without session overrides.
              {" "}Use Editor to change and publish them, or Export to view the complete definition.
              {" "}Workflow nodes may override shared settings; Export includes each node's configuration.
            </p>
            <dl className="agent-facts">
              <div><dt>Model source</dt><dd>{modelSource}</dd></div>
              <div><dt>Model</dt><dd>{agent.model || (agent.targetAgent ? "Owned by hosted target" : "Not set (service default)")}</dd></div>
              <div><dt>Version</dt><dd>{agent.version || "Latest"}</dd></div>
              <div><dt>Voice</dt><dd>{agent.voice || "Not set (service default)"}</dd></div>
              <div><dt>Voice type</dt><dd>{output?.voice_type || output?.voice?.type || "Not set (service default)"}</dd></div>
              <div><dt>Input language</dt><dd>{inputLanguage}</dd></div>
              <div><dt>User transcript model</dt><dd>{input?.transcription?.model || "Not set (service default)"}</dd></div>
              <div><dt>Conversation storage</dt><dd>{agent.store ? "Save transcript & audio" : "Do not save"}</dd></div>
              <div><dt>Greeting</dt><dd>{agent.greeting?.type || "None"}</dd></div>
              <div><dt>Turn detection</dt><dd>{input?.turn_detection?.type || "Not set (service default)"}</dd></div>
              <div><dt>Echo cancellation</dt><dd>{echoCancellation
                ? agent.clientReferenceEc ? "Live reference (agent playback)" : echoCancellation.type
                : "Not set (service default)"}</dd></div>
              <div><dt>Avatar</dt><dd>{agent.avatar ? [agent.avatar.character, agent.avatar.style].filter(Boolean).join(" / ") || agent.avatar.type : "Off"}</dd></div>
              <div><dt>Root tools</dt><dd>{tools.length
                ? tools.map((tool) => tool.name || tool.server_label || tool.type).join(", ")
                : "None"}</dd></div>
              <div><dt>Workflow</dt><dd>{agent.handoff
                ? `${agent.handoff.nodes?.length || 0} nodes, ${agent.handoff.edges?.length || 0} routes`
                : "None"}</dd></div>
              <div><dt>Structured inputs</dt><dd>{structuredInputs.join(", ") || "None"}</dd></div>
              {agent.targetAgent ? <div><dt>Hosted target</dt><dd>{agent.targetAgent.name} · {agent.targetAgent.version || "latest"}</dd></div> : null}
              <div><dt>Connection transport</dt><dd>{transportError ? transport || "(empty)" : transport === "webrtc" ? "WebRTC" : "WebSocket"}</dd></div>
            </dl>
            {definition?.instructions ? (
              <div className="agent-configuration-instructions">
                <h3>Instructions</h3>
                <pre>{definition.instructions}</pre>
              </div>
            ) : null}
            {transport === "webrtc" && agent.avatar ? <p className="field-hint">
              The published avatar is not used with the WebRTC media transport.
            </p> : null}
          </div>
        </details>
      ) : null}
    </section>
  );
}
