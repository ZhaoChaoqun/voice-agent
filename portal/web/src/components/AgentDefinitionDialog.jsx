// Copyright (c) Microsoft. All rights reserved.

import { useEffect, useRef, useState } from "react";
import { loadVoiceAgent } from "../lib/agentCatalog.mjs";
import { agentDefinitionToJson, agentDefinitionToYaml } from "../lib/agentDefinition.mjs";

export function AgentDefinitionDialog({ cfg, agentName, open, onClose }) {
  const dialogRef = useRef(null);
  const [format, setFormat] = useState("yaml");
  const [output, setOutput] = useState(null);
  const [state, setState] = useState({ loading: false, error: "", version: "" });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open || !agentName) return undefined;
    let cancelled = false;
    setFormat("yaml");
    setOutput(null);
    setState({ loading: true, error: "", version: "" });
    loadVoiceAgent(cfg, agentName)
      .then((resource) => {
        if (cancelled) return;
        const latest = resource.versions?.latest;
        setOutput({
          yaml: agentDefinitionToYaml(latest?.definition),
          json: agentDefinitionToJson(latest?.definition),
        });
        setState({ loading: false, error: "", version: latest.version || "" });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({ loading: false, error: String(error), version: "" });
      });
    return () => { cancelled = true; };
  }, [agentName, cfg, open]);

  const selectFormat = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "yaml" : event.key === "End" ? "json"
      : format === "yaml" ? "json" : "yaml";
    setFormat(next);
    dialogRef.current.querySelector(`[data-format="${next}"]`).focus();
  };

  return (
    <dialog
      ref={dialogRef}
      className="definition-dialog"
      aria-labelledby="runtime-export-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === dialogRef.current) onClose(); }}
    >
      <div className="definition-dialog-shell">
        <header>
          <div>
            <h2 id="runtime-export-title">Export agent definition</h2>
            <p><code>{agentName}</code></p>
          </div>
          <button type="button" className="dialog-close" aria-label="Close export" onClick={onClose}>×</button>
        </header>
        <div className="definition-dialog-copy">
          The complete published definition, including all settings, nodes, routes and extension fields.
          Import the JSON or YAML in Editor using Export/Import &gt; Import from agent, as a file or pasted text.
          Export does not change or publish the Agent.
        </div>
        <div className="definition-format-tabs" role="tablist" aria-label="Export format">
          {["yaml", "json"].map((value) => (
            <button key={value} type="button" role="tab" id={`runtime-export-${value}`}
              data-format={value} aria-selected={format === value} aria-controls="runtime-export-output"
              tabIndex={format === value ? 0 : -1}
              onClick={() => setFormat(value)} onKeyDown={selectFormat}>
              {value.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="definition-export-panel" role="tabpanel" id="runtime-export-output"
          aria-labelledby={`runtime-export-${format}`} aria-busy={state.loading}>
          <textarea className="definition-editor" aria-label={`Agent definition ${format.toUpperCase()}`}
            value={output?.[format] || ""} readOnly spellCheck="false" />
        </div>
        <footer>
          <span className={`definition-save-state ${state.error ? "err" : ""}`}
            role={state.error ? "alert" : "status"}>
            {state.loading ? "Loading current definition…" : state.error
              || (state.version ? `Published version ${state.version}` : "Published definition")}
          </span>
          <div className="definition-dialog-actions">
            <button type="button" onClick={onClose}>Close</button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}
