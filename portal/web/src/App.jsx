// Copyright (c) Microsoft. All rights reserved.
// Runtime workspace: selects published agents and displays their live sessions and graphs.

import { useEffect, useMemo, useRef, useState } from "react";
import { loadConfig, loadDeployments, isCascaded } from "./config.js";
import { createDigitDemoFunctions } from "./lib/digitDemo.mjs";
import {
  asVoiceAgent,
  loadVoiceAgent,
  loadVoiceAgentPage,
} from "./lib/agentCatalog.mjs";
import { useVoiceSession } from "./hooks/useVoiceSession.js";
import { buildHandoffGraph } from "./lib/handoffGraph.mjs";
import { withSelectedAgent, withSessionTransport } from "./lib/agentUrl.mjs";
import { AgentDefinitionDialog } from "./components/AgentDefinitionDialog.jsx";
import { Icon } from "./components/ConfigControls.jsx";
import { ChatPanel } from "./components/ChatPanel.jsx";
import { HandoffGraphPanel } from "./components/HandoffGraphPanel.jsx";
import { SessionControls } from "./components/SessionControls.jsx";
import { StudioHeader } from "./components/StudioHeader.jsx";
import { VoiceCatalogStatus } from "./components/VoiceCatalogStatus.jsx";
import { useVoiceCatalog } from "./hooks/useVoiceCatalog.js";

const WORKSPACE_MIN_SIDE_WIDTH = 360;
const WORKSPACE_MIN_PLAYGROUND_WIDTH = 320;
const WORKSPACE_SPLITTER_WIDTH = 14;

function forPortal(cfg, agent) {
  return agent ? {
    ...agent,
    // Hosted agents use the cascaded voice path; voice overrides must use Azure voices.
    cascaded: agent.inferenceMode === "hosted_agent" || isCascaded(cfg, agent.model),
  } : null;
}

function mergeAgentLists(...lists) {
  const merged = new Map();
  for (const list of lists) {
    for (const item of list) {
      if (item && !merged.has(item.name)) merged.set(item.name, item);
    }
  }
  return [...merged.values()];
}

export function App() {
  const [cfg, setCfg] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const voiceCatalogState = useVoiceCatalog(cfg, setCfg);
  const [agent, setAgent] = useState(null); // { name, model, voice, cascaded }
  const [transport, setTransport] = useState(
    () => new URLSearchParams(window.location.search).get("transport") ?? "websocket",
  );
  const [transportNotice, setTransportNotice] = useState("");
  const transportError = transport === "websocket" || transport === "webrtc"
    ? ""
    : `Unsupported transport '${transport}'. Set transport=websocket or transport=webrtc in the URL.`;
  const [agents, setAgents] = useState([]);
  const [agentListState, setAgentListState] = useState({
    loading: true,
    loadingMore: false,
    error: "",
    hasMore: false,
    nextCursor: "",
  });
  const [exportingAgentName, setExportingAgentName] = useState("");
  const [debugCollapsed, setDebugCollapsed] = useState(false);
  const [sideColumnWidth, setSideColumnWidth] = useState(window.innerWidth / 2);
  const [resizingWorkspace, setResizingWorkspace] = useState(false);
  const shellRef = useRef(null);
  const splitDragRef = useRef(null);
  const workspaceResizedRef = useRef(false);
  const session = useVoiceSession();
  const { setClientFunctions } = session;
  const editorRunHandled = useRef(false);

  useEffect(() => {
    if (!agent?.clientReferenceEc) {
      setTransportNotice("");
      return;
    }
    if (transport !== "webrtc") return;
    setTransport("websocket");
    setTransportNotice("Transport changed to WebSocket: live-reference echo cancellation requires WebSocket.");
    window.history.replaceState(
      window.history.state, "", withSessionTransport(window.location.href, "websocket"),
    );
  }, [agent?.clientReferenceEc, transport]);

  const sideWidthBounds = () => {
    const shell = shellRef.current;
    const shellWidth = shell?.clientWidth || window.innerWidth;
    const shellStyle = shell ? window.getComputedStyle(shell) : null;
    const horizontalPadding = shellStyle
      ? Number.parseFloat(shellStyle.paddingLeft) + Number.parseFloat(shellStyle.paddingRight)
      : 0;
    return {
      min: WORKSPACE_MIN_SIDE_WIDTH,
      balanced: (shellWidth - horizontalPadding - WORKSPACE_SPLITTER_WIDTH) / 2,
      max: Math.max(
        WORKSPACE_MIN_SIDE_WIDTH,
        shellWidth - horizontalPadding - WORKSPACE_MIN_PLAYGROUND_WIDTH - WORKSPACE_SPLITTER_WIDTH,
      ),
    };
  };

  const clampSideColumnWidth = (value) => {
    const { min, max } = sideWidthBounds();
    return Math.min(max, Math.max(min, value));
  };

  const setClampedSideColumnWidth = (value) => {
    setSideColumnWidth((current) => clampSideColumnWidth(
      typeof value === "function" ? value(current) : value,
    ));
  };

  const startWorkspaceResize = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    splitDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: sideColumnWidth,
    };
    setResizingWorkspace(true);
  };

  const moveWorkspaceResize = (event) => {
    const drag = splitDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.clientX !== drag.startX) workspaceResizedRef.current = true;
    setClampedSideColumnWidth(drag.startWidth + event.clientX - drag.startX);
  };

  const finishWorkspaceResize = (event) => {
    const drag = splitDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    splitDragRef.current = null;
    setResizingWorkspace(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const resizeWorkspaceWithKeyboard = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") {
      resetWorkspaceSplit();
      return;
    }
    workspaceResizedRef.current = true;
    setClampedSideColumnWidth(
      (current) => current + (event.key === "ArrowRight" ? 32 : -32),
    );
  };

  const resetWorkspaceSplit = () => {
    workspaceResizedRef.current = false;
    setClampedSideColumnWidth(sideWidthBounds().balanced);
  };

  const toggleDebugPanel = () => setDebugCollapsed((current) => !current);

  useEffect(() => {
    if (session.isConnected) {
      setDebugCollapsed(false);
    }
  }, [session.isConnected]);

  useEffect(() => {
    if (!cfg || !shellRef.current) return undefined;
    const fitWorkspace = () => {
      const { min, max, balanced } = sideWidthBounds();
      setSideColumnWidth((current) => Math.min(
        max, Math.max(min, workspaceResizedRef.current ? current : balanced),
      ));
    };
    const observer = new ResizeObserver(fitWorkspace);
    observer.observe(shellRef.current);
    fitWorkspace();
    return () => observer.disconnect();
  }, [cfg]);

  /* Client-executed `function` tools are fulfilled by this page, not by Voice Live, so the
   * handlers have to be installed before a session can call one. The digit-accuracy demo is the
   * only one shipped today; registering it unconditionally is harmless for agents that declare no
   * function tool, because the registry is consulted only when a `function_call` actually arrives. */
  useEffect(() => {
    setClientFunctions(createDigitDemoFunctions());
  }, [setClientFunctions]);

  const handoffGraph = useMemo(() => {
    const definition = agent?.definition || (agent?.handoff ? { handoff: agent.handoff } : null);
    if (!definition && !session.handoffState) return null;
    return buildHandoffGraph({ definition, handoffState: session.handoffState });
  }, [agent, session.handoffState]);

  useEffect(() => {
    loadConfig()
      .then(async (cfg) => {
        // Merge dynamically-discovered BYOM deployments over the static /config fallback so BYOM mode
        // reflects the actual Foundry project. Discovery failures keep the static lists from /config.
        try {
          const dep = await loadDeployments();
          const realtime = (dep.realtime || []).map((d) => d.deployment).filter(Boolean);
          const cascaded = (dep.cascaded || []).map((d) => d.deployment).filter(Boolean);
          if (realtime.length) cfg.byomRealtimeModels = realtime;
          if (cascaded.length) cfg.byomCascadedModels = cascaded;
          cfg.byomAccount = dep.account || null;
          cfg.byomDeploymentSource = dep.source || null;
        } catch (e) {
          console.warn("BYOM deployment discovery failed; using static /config lists", e);
        }
        try {
          const page = await loadVoiceAgentPage(cfg);
          let portalAgents = page.agents.map(
            (item) => forPortal(cfg, item),
          );
          // Template publishing opens Runtime with the new agent selected, so an
          // agent named in the URL is a selection, not a filter.
          const requested = new URLSearchParams(window.location.search).get("agent");
          let selected = portalAgents[0] || null;
          if (requested) {
            selected = portalAgents.find((item) => item.name === requested) || null;
            if (!selected) {
              try {
                selected = forPortal(
                  cfg,
                  asVoiceAgent(await loadVoiceAgent(cfg, requested)),
                );
                if (selected) portalAgents = mergeAgentLists([selected], portalAgents);
              } catch (error) {
                console.warn(`Could not load requested agent '${requested}'`, error);
              }
            }
            if (!selected) {
              session.logError(`Agent '${requested}' is not in backend '${cfg.backend}'`);
            }
          }
          setAgents(portalAgents);
          setAgent(selected);
          setAgentListState({
            loading: false,
            loadingMore: false,
            error: "",
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
          });
        } catch (e) {
          console.warn("Voice agent discovery failed", e);
          setAgentListState({
            loading: false,
            loadingMore: false,
            error: String(e),
            hasMore: false,
            nextCursor: "",
          });
        }
        setCfg(cfg);
      })
      .catch((e) => setLoadError(String(e)));
  }, []);

  const onSelectAgent = async (name) => {
    const requested = String(name || "").trim();
    if (!requested) {
      setAgent(null);
      window.history.replaceState(null, "", withSelectedAgent(window.location.href));
      return "";
    }

    let selected = agents.find((item) => item.name === requested)
      || agents.find((item) => item.name.toLocaleLowerCase() === requested.toLocaleLowerCase())
      || null;
    if (!selected) {
      const resource = await loadVoiceAgent(cfg, requested);
      selected = forPortal(
        cfg,
        asVoiceAgent(resource),
      );
      if (!selected) {
        throw new Error(`Agent '${requested}' is not a Voice Agent`);
      }
      setAgents((current) => mergeAgentLists([selected], current));
    }

    setAgent(selected);
    window.history.replaceState(null, "", withSelectedAgent(window.location.href, selected.name));
    return selected.name;
  };

  const onRefreshAgents = async () => {
    const selectedName = agent?.name || "";
    setAgentListState({
      loading: true,
      loadingMore: false,
      error: "",
      hasMore: false,
      nextCursor: "",
    });
    try {
      const page = await loadVoiceAgentPage(cfg);
      let listed = page.agents.map(
        (item) => forPortal(cfg, item),
      );
      let selected = selectedName
        ? listed.find((item) => item.name === selectedName) || null
        : null;
      if (selectedName && !selected) {
        try {
          selected = forPortal(
            cfg,
            asVoiceAgent(await loadVoiceAgent(cfg, selectedName)),
          );
          if (selected) listed = mergeAgentLists([selected], listed);
        } catch (error) {
          console.warn(`Previously selected agent '${selectedName}' is no longer available`, error);
        }
      }
      setAgents(listed);
      setAgent(selected);
      setAgentListState({
        loading: false,
        loadingMore: false,
        error: "",
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      });
    } catch (e) {
      setAgentListState({
        loading: false,
        loadingMore: false,
        error: String(e),
        hasMore: false,
        nextCursor: "",
      });
    }
  };

  const onLoadMoreAgents = async () => {
    if (
      agentListState.loading
      || agentListState.loadingMore
      || !agentListState.hasMore
      || !agentListState.nextCursor
    ) return;

    setAgentListState((current) => ({ ...current, loadingMore: true, error: "" }));
    try {
      const page = await loadVoiceAgentPage(cfg, { after: agentListState.nextCursor });
      const listed = page.agents.map(
        (item) => forPortal(cfg, item),
      );
      setAgents((current) => mergeAgentLists(current, listed));
      setAgentListState({
        loading: false,
        loadingMore: false,
        error: "",
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      });
    } catch (e) {
      setAgentListState((current) => ({
        ...current,
        loadingMore: false,
        error: String(e),
      }));
    }
  };

  // Only Editor's one-shot Try it now request starts a session; shared URLs still select only.
  useEffect(() => {
    if (!cfg || agentListState.loading || editorRunHandled.current) return;
    if (agent?.clientReferenceEc && transport === "webrtc") return;
    editorRunHandled.current = true;
    let requested;
    try {
      requested = window.sessionStorage.getItem("voice-agent-editor-run");
      window.sessionStorage.removeItem("voice-agent-editor-run");
    } catch (error) {
      session.logError(`Could not read the Editor session request: ${error.message}`);
      return;
    }
    if (!requested) return;
    if (transportError) {
      session.logError(transportError);
      return;
    }
    if (agent?.name !== requested) {
      session.logError(`Could not start Editor Agent '${requested}': it is not available in this Project.`);
      return;
    }
    session.connect(
      agent.name, "", "", cfg.apiVersion, transport, Boolean(agent.clientReferenceEc),
    );
  }, [cfg, agent, agentListState.loading, transport, transportError, session.connect, session.logError]);

  if (loadError) return <div className="studio-loading" role="alert">Could not load configuration: {loadError}</div>;
  if (!cfg) return <div className="studio-loading" role="status">Loading your voice workspace…</div>;

  return (
    <div className="studio">
      <StudioHeader cfg={cfg} disabled={session.isConnected}
        debugMode={session.verbose} />
      <VoiceCatalogStatus cfg={cfg} {...voiceCatalogState} />
      <div
        ref={shellRef}
        className={`shell${resizingWorkspace ? " is-resizing" : ""}`}
        style={{ "--studio-side-width": workspaceResizedRef.current
          ? `${sideColumnWidth}px`
          : `calc((100% - ${WORKSPACE_SPLITTER_WIDTH}px) / 2)` }}
      >
        <aside className="studio-side-column" aria-label="Agent debugging">
          <section className={`studio-panel studio-workflow-panel${debugCollapsed ? " is-collapsed" : ""}`}
            aria-label="Agent debug">
            <button
              type="button"
              className="studio-panel-header-button"
              aria-expanded={!debugCollapsed}
              aria-controls="agent-debug-panel"
              onClick={toggleDebugPanel}
            >
              <span className="studio-panel-heading-copy">
                <span className="eyebrow">DEBUG</span>
                <span className="studio-panel-heading-title" role="heading" aria-level="2">Agent Debug</span>
                <span className="studio-panel-heading-hint">
                  Click to {debugCollapsed ? "expand" : "collapse"}
                </span>
              </span>
              <span className="studio-panel-heading-actions">
                {session.activeHandoffNodeId ? (
                  <span className="subtle-badge">Active: {session.activeHandoffNodeId}</span>
                ) : null}
                <span className="studio-panel-fold-control">
                  <span>{debugCollapsed ? "Expand panel" : "Collapse panel"}</span>
                  <Icon name="chevron" />
                </span>
              </span>
            </button>
            <div id="agent-debug-panel" className="studio-workflow-content" hidden={debugCollapsed}>
              {handoffGraph ? (
                <HandoffGraphPanel
                  graph={handoffGraph}
                  activeNodeId={session.activeHandoffNodeId}
                  takenEdgeIds={session.takenEdgeIds}
                  trail={session.handoffTrail}
                  runtimeMetrics={session.handoffRuntimeMetrics}
                  debugMode={session.verbose}
                  agentName={agent?.name || ""}
                />
              ) : (
                <div className="workflow-empty">
                  Select an agent with a handoff graph to follow its active node while the session runs.
                </div>
              )}
            </div>
          </section>
        </aside>
        <div
          className="studio-workspace-splitter"
          role="separator"
          aria-label="Resize Agent Debug and Live conversation panels"
          aria-orientation="vertical"
          aria-valuemin={WORKSPACE_MIN_SIDE_WIDTH}
          aria-valuemax={Math.round(sideWidthBounds().max)}
          aria-valuenow={Math.round(sideColumnWidth)}
          tabIndex="0"
          onPointerDown={startWorkspaceResize}
          onPointerMove={moveWorkspaceResize}
          onPointerUp={finishWorkspaceResize}
          onPointerCancel={finishWorkspaceResize}
          onKeyDown={resizeWorkspaceWithKeyboard}
          onDoubleClick={resetWorkspaceSplit}
          title="Drag to resize. Use Left/Right arrows for precise adjustment; double-click or press Home for equal widths."
        >
          <span aria-hidden="true" />
        </div>
        <section className="playground-column" aria-label="Agent playground">
          <SessionControls cfg={cfg} session={session} agent={agent} agents={agents}
            transport={transport} transportError={transportError} transportNotice={transportNotice}
            agentListState={agentListState} onSelectAgent={onSelectAgent} onRefreshAgents={onRefreshAgents}
            onLoadMoreAgents={onLoadMoreAgents}
            onExportAgent={() => setExportingAgentName(agent?.name || "")} />
          <ChatPanel session={session} agent={agent} cfg={cfg} />
        </section>
      </div>
      <AgentDefinitionDialog
        cfg={cfg}
        agentName={exportingAgentName}
        open={Boolean(exportingAgentName)}
        onClose={() => setExportingAgentName("")}
      />
    </div>
  );
}
