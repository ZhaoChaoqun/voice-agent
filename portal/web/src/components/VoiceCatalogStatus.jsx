// Copyright (c) Microsoft. All rights reserved.
import { voiceCatalogStatusText } from "../../../static/handoff/voice-catalog.mjs";

export function VoiceCatalogStatus({ cfg, loading, error, onRetry }) {
  if (cfg.voiceCatalogSource === "live" && !loading && !error) return null;
  return (
    <div className="voice-catalog-status info-note" role="status" aria-label="Voice catalog status">
      <span>{voiceCatalogStatusText(cfg, loading, error)}</span>
      <button type="button" disabled={loading} onClick={onRetry}>
        {loading ? "Checking voices…" : "Retry live voice discovery"}
      </button>
    </div>
  );
}
