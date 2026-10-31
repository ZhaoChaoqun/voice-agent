// Copyright (c) Microsoft. All rights reserved.
import { useEffect, useRef, useState } from "react";
import {
  displayTranscriptionLanguage,
  mountInputLanguagePicker,
} from "../../../static/handoff/transcription-languages.mjs";

export function InputLanguagePicker({ id, model, value, onChange, disabled, ...props }) {
  const root = useRef(null);
  const [error, setError] = useState("");
  const change = useRef(onChange);
  change.current = onChange;
  useEffect(() => mountInputLanguagePicker({
    input: root.current.querySelector("input"),
    toggle: root.current.querySelector("button"),
    list: root.current.querySelector('[role="listbox"]'),
    model,
    value,
    onChange: (language) => change.current(language),
    onError: setError,
  }), [model, value, disabled]);
  return (
    <>
    <div ref={root} className="input-language-combobox">
      <input {...props} id={id} type="text" role="combobox" readOnly disabled={disabled}
        defaultValue={displayTranscriptionLanguage(value)} autoComplete="off" spellCheck={false}
        aria-haspopup="listbox" aria-expanded="false" aria-controls={`${id}-languages`}
        aria-describedby={[props["aria-describedby"], error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined} />
      <button type="button" className="input-language-toggle" disabled={disabled}
        aria-label="Show input languages">▾</button>
      <div className="input-language-options" hidden>
        <div id={`${id}-languages`} role="listbox" aria-label="Input languages" />
      </div>
    </div>
    {error ? <p id={`${id}-error`} className="form-feedback err" role="alert">{error}</p> : null}
    </>
  );
}
