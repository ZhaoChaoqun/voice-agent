// Copyright (c) Microsoft. All rights reserved.

import { isCascaded, modelGroups, transcriptionGroups } from "../config.js";
import { AVATAR_PRESETS } from "../lib/avatar.mjs";
import { DEFAULT_INSTRUCTIONS } from "../lib/agentForm.mjs";
import { LIMITS } from "../lib/authoringContract.mjs";
import { GREETING_MODES, GREETING_TOOL_CHOICES } from "../lib/greeting.mjs";
import { HANDOFF_ENTRYPOINT_INSTRUCTIONS } from "../lib/handoff.mjs";
import { Field, GroupedSelect, SectionHeading, Toggle } from "./ConfigControls.jsx";
import { StructuredInputsConfig } from "./StructuredInputsConfig.jsx";
import { VoicePicker } from "./VoicePicker.jsx";
import { InputLanguagePicker } from "./InputLanguagePicker.jsx";
import {
  INPUT_LANGUAGE_HINT,
  transcriptionLanguageError,
} from "../../../static/handoff/transcription-languages.mjs";

export function AgentConfig({ cfg, draft, update, disabled, structuredInputConfigs, onStructuredInputsChange }) {
  const hosted = draft.inferenceMode === "hosted_agent";
  const greeting = draft.greeting;
  const updateGreeting = (key, value) => update("greeting", { ...greeting, [key]: value });
  const modes = cfg.inferenceModes || [
    { value: "model", label: "Managed model" },
    { value: "deployment", label: "BYOM deployment" },
    { value: "hosted_agent", label: "Hosted agent" },
  ];
  const modeLabels = { model: "Managed model", deployment: "Your deployment (BYOM)", hosted_agent: "Hosted agent" };

  return (
    <>
      <SectionHeading title="Agent & model" description="Set your agent’s purpose, model, and first message." />
      <Field label="Agent name" optional hint="Leave blank to generate a unique name.">
        <input type="text" value={draft.name} maxLength={LIMITS.name}
          placeholder="e.g. customer-support" disabled={disabled}
          onChange={(event) => update("name", event.target.value)} />
      </Field>
      <div className="field-grid">
        <Field label="Model source">
          <select value={draft.inferenceMode} disabled={disabled}
            onChange={(event) => update("inferenceMode", event.target.value)}>
            {modes.map((mode) => <option key={mode.value} value={mode.value}>{modeLabels[mode.value] || mode.label}</option>)}
          </select>
        </Field>
        {!hosted ? (
          <Field label={draft.inferenceMode === "deployment" ? "Model deployment" : "Model"}>
            <GroupedSelect value={draft.model} disabled={disabled}
              groups={modelGroups(cfg, draft.inferenceMode === "deployment")}
              onChange={(event) => update("model", event.target.value)} />
          </Field>
        ) : (
          <Field label="Target version" optional>
            <input type="text" value={draft.targetAgentVersion} placeholder="Latest version"
              disabled={disabled} onChange={(event) => update("targetAgentVersion", event.target.value)} />
          </Field>
        )}
      </div>
      {hosted ? (
        <>
          <Field label="Target hosted agent" hint="An existing, Voice Live-compatible hosted agent in this project.">
            <input type="text" value={draft.targetAgentName} placeholder="existing-hosted-agent"
              disabled={disabled} onChange={(event) => update("targetAgentName", event.target.value)} />
          </Field>
          <div className="info-note">
            The target owns its instructions, model, tools, and workflow.
            Configure the voice, greeting, and recording policy on this wrapper.
          </div>
        </>
      ) : (
        <>
          <div className="model-note">
            <span className="subtle-badge">{isCascaded(cfg, draft.model) ? "Cascaded" : "Realtime"}</span>
            <span>{draft.inferenceMode === "deployment"
              ? "Uses your Foundry deployment."
              : "Hosted and managed by Voice Live."}</span>
          </div>
          <Field label="Instructions" optional hint={draft.handoffEnabled
            ? "Leave blank to use the customer-care routing prompt. Custom instructions take precedence."
            : "Set the role, tone, and boundaries. Leave blank to use the helpful-assistant default."}>
            <textarea value={draft.instructions} rows={7} disabled={disabled}
              placeholder={draft.handoffEnabled ? HANDOFF_ENTRYPOINT_INSTRUCTIONS : DEFAULT_INSTRUCTIONS}
              onChange={(event) => update("instructions", event.target.value)} />
          </Field>
        </>
      )}
      <div className="form-divider" />
      <Field label="First message">
        <select value={greeting.mode} disabled={disabled}
          onChange={(event) => updateGreeting("mode", event.target.value)}>
          <option value={GREETING_MODES.NONE}>Wait for the user</option>
          <option value={GREETING_MODES.TEMPLATE}>Speak an exact greeting</option>
          <option value={GREETING_MODES.LLM_GENERATED}>Generate a greeting</option>
        </select>
      </Field>
      {greeting.mode === GREETING_MODES.TEMPLATE ? (
        <Field label="Greeting text" hint="Spoken exactly as written, without model generation.">
          <textarea rows={3} value={greeting.text} disabled={disabled}
            onChange={(event) => updateGreeting("text", event.target.value)} />
        </Field>
      ) : null}
      {greeting.mode === GREETING_MODES.LLM_GENERATED ? (
        <>
          <Field label="Greeting prompt">
            <textarea rows={3} value={greeting.prompt} disabled={disabled}
              onChange={(event) => updateGreeting("prompt", event.target.value)} />
          </Field>
          <Field label="Fallback greeting" optional hint="Used if generation fails before any greeting is spoken.">
            <textarea rows={2} value={greeting.fallbackText} disabled={disabled}
              onChange={(event) => updateGreeting("fallbackText", event.target.value)} />
          </Field>
          <Field label="Greeting tool choice" hint={hosted
            ? "Hosted wrappers cannot require wrapper-level tools."
            : "None is fastest. Auto or required can use the configured tools."}>
            <select value={greeting.toolChoice} disabled={disabled}
              onChange={(event) => updateGreeting("toolChoice", event.target.value)}>
              {GREETING_TOOL_CHOICES.filter((choice) => !hosted || choice !== "required").map((choice) => (
                <option key={choice} value={choice}>{choice}</option>
              ))}
            </select>
          </Field>
        </>
      ) : null}
      {!hosted ? (
        <section className="structured-input-settings" aria-label="Structured inputs">
          <h3>Structured inputs</h3>
          <p className="field-hint">
            Personalize instructions and greetings with variables. Defaults are saved with the agent
            and used by Runtime. Publish a new version to change them.
          </p>
          <StructuredInputsConfig configs={structuredInputConfigs} disabled={disabled} onChange={onStructuredInputsChange} />
        </section>
      ) : null}
      <details className="advanced-details">
        <summary>Agent details</summary>
        <Field label="Description" optional>
          <input type="text" value={draft.description} maxLength={LIMITS.description}
            placeholder="A short description of this agent" disabled={disabled || hosted}
            onChange={(event) => update("description", event.target.value)} />
        </Field>
        {hosted ? <p className="field-hint">Hosted wrappers use a standard description.</p> : null}
      </details>
      <div className="setting-block">
        <Toggle label="Save conversations" checked={draft.store} disabled={disabled}
          onChange={(value) => update("store", value)}
          description="Persist transcripts and audio for playback and review." />
        {!draft.store ? (
          <p className="field-hint">Conversations and recordings are not saved. Service tracing is separate.</p>
        ) : null}
      </div>
    </>
  );
}

export function VoiceConfig({ cfg, draft, update, disabled }) {
  const hosted = draft.inferenceMode === "hosted_agent";
  const cascaded = hosted || isCascaded(cfg, draft.model);
  const languageError = transcriptionLanguageError(draft.transcriptionModel, draft.transcriptionLanguage);
  return (
    <>
      <SectionHeading title="Speech input & output"
        description="Configure transcription and spoken output separately. STT never selects a voice." />
      <div className="speech-direction-card input">
        <div className="speech-direction-heading">
          <span className="speech-direction-arrow" aria-hidden="true">Caller →</span>
          <div><strong>Input transcription (STT)</strong><small>Speech becomes a transcript</small></div>
        </div>
        <Field label="Transcription model" hint={cascaded
          ? "This STT output is the text consumed by the cascaded model."
          : "The Realtime model understands audio directly; this selection still produces transcript events."}>
          <GroupedSelect value={draft.transcriptionModel}
            groups={transcriptionGroups(cfg)} disabled={disabled}
            onChange={(event) => update("transcriptionModel", event.target.value)} />
        </Field>
        <Field label="Input language" hint={INPUT_LANGUAGE_HINT}>
          <InputLanguagePicker model={draft.transcriptionModel} value={draft.transcriptionLanguage}
            disabled={disabled} aria-invalid={Boolean(languageError)}
            onChange={(language) => update("transcriptionLanguage", language || "Auto")} />
        </Field>
        {languageError ? <p role="alert" className="field-hint">{languageError}</p> : null}
      </div>
      <div className="speech-direction-card output">
        <div className="speech-direction-heading">
          <span className="speech-direction-arrow" aria-hidden="true">Agent →</span>
          <div><strong>Speech output (TTS / voice)</strong><small>The reply becomes audio</small></div>
        </div>
        <Field label="Output voice" hint="Grouped by voice locale, independently of the model. Service errors are shown if a configuration is rejected.">
          <VoicePicker cfg={cfg} value={draft.voice} disabled={disabled}
            onChange={(event) => update("voice", event.target.value)} />
        </Field>
        <p className="field-hint">{cfg.voiceCatalogNotice}</p>
      </div>
      <div className={`audio-compatibility-note ${cascaded ? "cascaded" : "realtime"}`}>
        <strong>{cascaded ? "Cascaded pipeline" : "Realtime audio pipeline"}</strong>
        <span>{cascaded
          ? "STT feeds text to the model. Voice controls spoken output separately."
          : "The model reads caller audio natively. STT runs alongside it for transcripts; voice controls output only."}</span>
      </div>
      <div className="audio-format-note"><span>24 kHz PCM</span><span>Server VAD</span><span>Audio response</span></div>
      <div className="setting-block">
        <Toggle label="Live-reference echo cancellation" checked={draft.clientReferenceEc}
          disabled={disabled || draft.avatarEnabled}
          onChange={(value) => update("clientReferenceEc", value)}
          description="Send microphone and playback audio on separate WebSocket channels." />
      </div>
      <div className="setting-block">
        <Toggle label="Video avatar" checked={draft.avatarEnabled} disabled={disabled}
          onChange={(value) => update("avatarEnabled", value)}
          description="Add a speaking avatar. Uses an Azure voice and disables live-reference echo cancellation." />
        {draft.avatarEnabled ? (
          <Field label="Avatar preset">
            <select value={draft.avatarPreset} disabled={disabled}
              onChange={(event) => update("avatarPreset", event.target.value)}>
              {AVATAR_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
            </select>
          </Field>
        ) : null}
      </div>
      <p className="field-hint">Additional audio settings remain available in the saved agent’s YAML definition.</p>
    </>
  );
}
