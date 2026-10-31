// Copyright (c) Microsoft. All rights reserved.
// Standalone WebRTC app shell. Three phases drive a single-agent, WebRTC-only experience:
//   setup  -> pick an agent (reuses the shared agent catalog + /config).
//   live   -> WebRTC voice session (transport forced to "webrtc" on connect).
//   review -> INLINE persisted showcase for the just-finished conversation (no new tab).
// It deliberately reuses the shared useVoiceSession hook and config loaders; only the
// layout/feel is different from the integrated demo (App.jsx), which is left untouched.

import { useCallback, useEffect, useState } from "react";
import { loadConfig } from "../config.js";
import {
  asVoiceAgent,
  loadVoiceAgent,
  loadVoiceAgentPage,
} from "../lib/agentCatalog.mjs";
import { useVoiceSession } from "../hooks/useVoiceSession.js";
import { AgentPicker } from "./components/AgentPicker.jsx";
import { LiveStage } from "./components/LiveStage.jsx";
import { PersistedShowcase } from "./components/PersistedShowcase.jsx";
import { VoiceCatalogStatus } from "../components/VoiceCatalogStatus.jsx";
import { useVoiceCatalog } from "../hooks/useVoiceCatalog.js";

export function WebRtcApp() {
  const [cfg, setCfg] = useState(null);
  const voiceCatalogState = useVoiceCatalog(cfg, setCfg);
  const [loadError, setLoadError] = useState(null);
  const [agents, setAgents] = useState([]);
  const [agentsState, setAgentsState] = useState({
    loading: true,
    loadingMore: false,
    error: "",
    hasMore: false,
    nextCursor: "",
  });
  const [agent, setAgent] = useState(null);
  const [phase, setPhase] = useState("setup"); // "setup" | "live" | "review"
  const [reviewConversationId, setReviewConversationId] = useState(null);
  const session = useVoiceSession();

  useEffect(() => {
    loadConfig()
      .then(async (loaded) => {
        try {
          const page = await loadVoiceAgentPage(loaded);
          setAgents(page.agents);
          setAgentsState({
            loading: false,
            loadingMore: false,
            error: "",
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
          });
        } catch (e) {
          setAgentsState({
            loading: false,
            loadingMore: false,
            error: String(e),
            hasMore: false,
            nextCursor: "",
          });
        }
        setCfg(loaded);
      })
      .catch((e) => setLoadError(String(e)));
  }, []);

  const loadMoreAgents = useCallback(async () => {
    if (
      agentsState.loading
      || agentsState.loadingMore
      || !agentsState.hasMore
      || !agentsState.nextCursor
    ) return;

    setAgentsState((current) => ({ ...current, loadingMore: true, error: "" }));
    try {
      const page = await loadVoiceAgentPage(cfg, { after: agentsState.nextCursor });
      setAgents((current) => {
        const known = new Set(current.map((item) => item.name));
        return [...current, ...page.agents.filter((item) => !known.has(item.name))];
      });
      setAgentsState({
        loading: false,
        loadingMore: false,
        error: "",
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      });
    } catch (e) {
      setAgentsState((current) => ({
        ...current,
        loadingMore: false,
        error: String(e),
      }));
    }
  }, [cfg, agentsState]);

  const resolveAgent = useCallback(async (name) => {
    const requested = String(name || "").trim();
    if (!requested) throw new Error("Enter an exact Agent name");

    let selected = agents.find((item) => item.name === requested)
      || agents.find((item) => item.name.toLocaleLowerCase() === requested.toLocaleLowerCase())
      || null;
    if (!selected) {
      selected = asVoiceAgent(await loadVoiceAgent(cfg, requested));
      if (!selected) throw new Error(`Agent '${requested}' is not a Voice Agent`);
      setAgents((current) => [
        selected,
        ...current.filter((item) => item.name !== selected.name),
      ]);
    }
    return selected;
  }, [agents, cfg]);

  const start = useCallback((selected) => {
    if (!selected) return;
    setAgent(selected);
    setReviewConversationId(null);
    session.clearMessages();
    setPhase("live");
    // 5th arg forces the WebRTC transport (see useVoiceSession.connect signature).
    session.connect(selected.name, undefined, undefined, undefined, "webrtc");
  }, [session]);

  const end = useCallback(() => {
    // Capture the conversation id BEFORE teardown so the review phase can showcase it inline.
    setReviewConversationId(session.conversationId || null);
    session.stopSession();
    setPhase("review");
  }, [session]);

  const restart = useCallback(() => {
    session.clearMessages();
    setReviewConversationId(null);
    setAgent(null);
    setPhase("setup");
  }, [session]);

  if (loadError) return <div className="wrtc-error">Could not load /config: {loadError}</div>;
  if (!cfg) return <div className="wrtc-loading">Loading…</div>;

  return (
    <div className="wrtc-shell">
      <header className="wrtc-header">
        <div className="wrtc-title">Voice Agent <span className="wrtc-chip">WebRTC</span></div>
        <div className="wrtc-header-right">
          {agent ? <span className="wrtc-agent">{agent.name}</span> : null}
          <span className={"wrtc-badge wrtc-" + (session.webrtcStatus || "off")}>
            webrtc: {session.webrtcStatus || "off"}
          </span>
        </div>
      </header>
      <p className="info-note">{cfg.notice} <a href="/runtime/">Return to Runtime</a></p>
      <VoiceCatalogStatus cfg={cfg} {...voiceCatalogState} />

      <main className="wrtc-body">
        {phase === "setup" ? (
          <AgentPicker
            agents={agents}
            state={agentsState}
            onLoadMore={loadMoreAgents}
            onResolveAgent={resolveAgent}
            onStart={start}
          />
        ) : null}
        {phase === "live" ? (
          <LiveStage session={session} agent={agent} onEnd={end} />
        ) : null}
        {phase === "review" ? (
          <PersistedShowcase
            cfg={cfg}
            agent={agent}
            conversationId={reviewConversationId}
            debugMode={session.verbose}
            onRestart={restart}
          />
        ) : null}
      </main>
    </div>
  );
}
