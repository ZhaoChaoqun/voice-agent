// Copyright (c) Microsoft. All rights reserved.
import { useId, useState } from "react";
import { filterVoiceGroups, voiceMatchCount } from "../../../static/handoff/voice-picker.mjs";
import { voiceGroups } from "../config.js";
import { GroupedSelect } from "./ConfigControls.jsx";

export function VoicePicker({ cfg, value, disabled, ...props }) {
  const prefix = useId();
  const [localeQuery, setLocaleQuery] = useState("");
  const [query, setQuery] = useState("");
  const groups = voiceGroups(cfg);
  const filtered = filterVoiceGroups(groups, localeQuery, query);
  const matches = voiceMatchCount(filtered);
  return (
    <div className="voice-picker">
      <div className="voice-picker-filters">
        <label htmlFor={`${prefix}-locale`}>Voice locale</label>
        <input id={`${prefix}-locale`} type="search" list={`${prefix}-locales`}
          value={localeQuery} disabled={disabled} autoComplete="off" spellCheck="false"
          placeholder="All locales - type en-US or Hindi"
          onChange={(event) => setLocaleQuery(event.target.value)} />
        <datalist id={`${prefix}-locales`}>
          <option value="All locales" />
          {groups.map((group) => (
            <option key={group.locale} value={group.locale || group.label} label={group.label} />
          ))}
        </datalist>
        <label htmlFor={`${prefix}-search`}>Search voices</label>
        <input id={`${prefix}-search`} type="search" value={query} disabled={disabled}
          autoComplete="off" placeholder="Ava, Swara, Dragon HD, or a full voice ID"
          onChange={(event) => setQuery(event.target.value)} />
        <div className="voice-picker-results">
          <span role="status">{matches} / {voiceMatchCount(groups)} voices match</span>
          <button type="button" disabled={disabled || (!localeQuery && !query)}
            onClick={() => { setLocaleQuery(""); setQuery(""); }}>Clear filters</button>
        </div>
      </div>
      {matches === 0 ? <p className="field-hint">No voices match. Try another locale or clear the filters.</p> : null}
      <GroupedSelect {...props} value={value} disabled={disabled} groups={filtered} />
      <p className="field-hint voice-picker-current">Selected: <code>{value || "Use agent default"}</code></p>
    </div>
  );
}
