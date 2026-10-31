// Copyright (c) Microsoft. All rights reserved.
import { useCallback, useEffect, useRef, useState } from "react";
import { loadLiveVoiceCatalog } from "../../../static/handoff/voice-catalog.mjs";

export function useVoiceCatalog(cfg, setCfg) {
  const [state, setState] = useState({ loading: false, error: "" });
  const request = useRef(null);
  const host = cfg?.host;
  const refresh = useCallback(async (force = false) => {
    if (!host) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ loading: true, error: "" });
    try {
      const catalog = await loadLiveVoiceCatalog({
        signal: controller.signal, refresh: force,
      });
      if (controller.signal.aborted) return;
      setCfg((current) => current?.host === host ? { ...current, ...catalog } : current);
      setState({ loading: false, error: "" });
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn("Optional live voice discovery failed; retaining the current voice catalog.", error);
      setState({ loading: false, error: error.message });
    }
  }, [host, setCfg]);
  useEffect(() => {
    void refresh();
    return () => request.current?.abort();
  }, [refresh]);
  return { ...state, onRetry: () => void refresh(true) };
}
