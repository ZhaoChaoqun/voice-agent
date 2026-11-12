/** Live assistant controls, streaming transcript, and auditable tool activity. */
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  AudioLines,
  BookOpen,
  Check,
  ChevronDown,
  CircleAlert,
  LoaderCircle,
  Mic,
  MicOff,
  Radio,
  Sparkles,
  Square,
  WandSparkles,
} from "lucide-react";

import type { Language, ModelOption } from "@shared/protocol";
import type { VoiceSession } from "@/hooks/useVoice";
import { text } from "@/i18n";
import { readableTranscript } from "@/lib/conversation";
import { SourceCard } from "@/components/Knowledge";

interface AssistantProps {
  language: Language;
  models: ModelOption[];
  model: string;
  onModel: (model: string) => void;
  voice: VoiceSession;
  onKnowledge: () => void;
}

export function Assistant(props: AssistantProps): React.JSX.Element {
  const { voice, language } = props;
  const copy = text(language);
  const [tab, setTab] = useState<"conversation" | "tools">("conversation");
  const modelAvailable =
    props.models.find((model) => model.id === props.model)?.available ?? false;
  const active = voice.status !== "idle" && voice.status !== "error";
  return (
    <aside className="assistant-panel" aria-label={copy.assistantCaption}>
      <header className="assistant-header">
        <span className="assistant-avatar">
          <Sparkles size={18} />
        </span>
        <div>
          <h2>
            {copy.assistant}
            <span className="ai-tag">AI</span>
          </h2>
          <p>{copy.assistantCaption}</p>
        </div>
        <span className="real-ai">
          <span />
          {copy.live}
        </span>
      </header>
      <ModelSelector {...props} />
      <div className={`voice-presence ${voice.status}`}>
        <div className="voice-orb" aria-hidden="true">
          <div className="orb-ring" />
          <div className="orb-core">
            <AudioLines size={42} strokeWidth={1.2} />
          </div>
          <span className="orb-sparkle">
            <Sparkles size={13} />
          </span>
        </div>
        <h3>{active ? copy[voice.status] : copy.greeting}</h3>
        {!active && <p>{copy.greetingDetail}</p>}
        <div className="voice-chips">
          <span>
            <Radio size={11} />
            {copy.auto}
          </span>
          <span>
            <Sparkles size={11} />
            {copy.expressive}
          </span>
        </div>
        <VoiceButtons
          voice={voice}
          language={language}
          available={modelAvailable}
        />
        <span className="voice-state">
          <span className={`status-dot ${active ? "live" : ""}`} />
          {voice.muted ? copy.muted : copy[voice.status]}
        </span>
      </div>
      {voice.error && (
        <div className="voice-error" role="alert">
          <CircleAlert size={15} />
          <span>{friendlyAudioError(voice.error, language)}</span>
        </div>
      )}
      <div className="assistant-tabs">
        <button
          className={tab === "conversation" ? "active" : ""}
          onClick={() => setTab("conversation")}
        >
          {copy.conversation}
          {voice.messages.length > 0 && <span>{voice.messages.length}</span>}
        </button>
        <button
          className={tab === "tools" ? "active" : ""}
          onClick={() => setTab("tools")}
        >
          {copy.tools}
          {voice.activities.length > 0 && (
            <span>{voice.activities.length}</span>
          )}
        </button>
      </div>
      {tab === "conversation" ? (
        <Conversation voice={voice} language={language} />
      ) : (
        <Activities voice={voice} language={language} />
      )}
      {voice.messages.length === 0 && (
        <Suggestions
          language={language}
          disabled={!modelAvailable}
          onSend={(value) => void voice.sendText(value)}
        />
      )}
      <MessageInput
        voice={voice}
        language={language}
        disabled={!modelAvailable}
      />
      <button className="knowledge-link" onClick={props.onKnowledge}>
        <BookOpen size={14} />
        <span>{copy.knowledge}</span>
        <ArrowUpRight size={14} />
      </button>
      <footer className="assistant-footer">
        {copy.powered}
        <span>✦</span>
      </footer>
    </aside>
  );
}

function ModelSelector(props: AssistantProps): React.JSX.Element {
  const copy = text(props.language);
  return (
    <div className="model-picker">
      <label htmlFor="voice-model">{copy.model}</label>
      <div>
        <span className="model-symbol">
          <WandSparkles size={14} />
        </span>
        <select
          id="voice-model"
          value={props.model}
          onChange={(event) => props.onModel(event.target.value)}
          title={copy.modelHint}
        >
          {props.models.map((model) => (
            <option key={model.id} value={model.id} disabled={!model.available}>
              {model.label}
              {!model.available ? ` · ${copy.unavailable}` : ""}
            </option>
          ))}
        </select>
        <ChevronDown size={14} />
      </div>
      <small>{props.models.find((model) => !model.available)?.reason}</small>
    </div>
  );
}

function VoiceButtons({
  voice,
  language,
  available,
}: {
  voice: VoiceSession;
  language: Language;
  available: boolean;
}): React.JSX.Element {
  const copy = text(language);
  const active = voice.status !== "idle" && voice.status !== "error";
  const starting = voice.status === "connecting";
  return (
    <div className="voice-buttons">
      {active && (
        <button
          className="round-button"
          onClick={() =>
            voice.hasMicrophone ? voice.toggleMute() : void voice.connect(true)
          }
          aria-label={
            !voice.hasMicrophone || voice.muted ? copy.unmute : copy.mute
          }
          disabled={starting}
        >
          {voice.muted ? <MicOff size={17} /> : <Mic size={17} />}
        </button>
      )}
      <button
        className={`talk-button ${active ? "active" : ""}`}
        disabled={!available || starting}
        onClick={() => (active ? voice.stop() : void voice.connect(true))}
      >
        {starting ? (
          <LoaderCircle size={17} className="spin" />
        ) : active ? (
          <Square size={12} fill="currentColor" />
        ) : (
          <Mic size={18} />
        )}
        <span>{active ? copy.stop : copy.start}</span>
      </button>
      {active && (
        <button
          className="round-button"
          onClick={voice.cancel}
          aria-label={copy.cancel}
          disabled={voice.status !== "speaking" && voice.status !== "thinking"}
        >
          <Square size={13} />
        </button>
      )}
    </div>
  );
}

function Conversation({
  voice,
  language,
}: {
  voice: VoiceSession;
  language: Language;
}): React.JSX.Element {
  const copy = text(language);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [voice.messages]);
  return (
    <div
      className={`conversation-list ${voice.messages.length ? "has-messages" : ""}`}
      role="log"
      aria-live="polite"
    >
      {voice.messages.length === 0 && (
        <p className="empty-conversation">{copy.noMessages}</p>
      )}
      {voice.messages.map((message) => (
        <div key={message.id} className={`message message-${message.role}`}>
          <span>
            {message.role === "assistant" ? (
              <Sparkles size={12} />
            ) : language === "zh" ? (
              "你"
            ) : (
              "You"
            )}
          </span>
          <p>
            {readableTranscript(message.text)}
            {!message.final && message.role === "assistant" && (
              <span className="typing-cursor" />
            )}
          </p>
        </div>
      ))}
      {voice.sources.length > 0 && (
        <div className="conversation-sources">
          <small>{copy.sources}</small>
          {voice.sources.map((source) => (
            <SourceCard key={source.id} source={source} language={language} />
          ))}
        </div>
      )}
      <div ref={bottom} />
    </div>
  );
}

function Activities({
  voice,
  language,
}: {
  voice: VoiceSession;
  language: Language;
}): React.JSX.Element {
  const copy = text(language);
  return (
    <div className="activity-list" role="log" aria-live="polite">
      {voice.activities.length === 0 && (
        <p className="empty-conversation">{copy.noTools}</p>
      )}
      {[...voice.activities].reverse().map((activity) => (
        <div className={`activity-item ${activity.status}`} key={activity.id}>
          <span>
            {activity.status === "success" ? (
              <Check size={14} />
            ) : activity.status === "running" ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <CircleAlert size={14} />
            )}
          </span>
          <div>
            <strong>{activity.name.replaceAll("_", " ")}</strong>
            <p>{activity.summary}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function Suggestions({
  language,
  disabled,
  onSend,
}: {
  language: Language;
  disabled: boolean;
  onSend: (value: string) => void;
}): React.JSX.Element {
  const copy = text(language);
  return (
    <div className="suggestions">
      <small>{copy.try}</small>
      {[copy.promptMovie, copy.promptClimate, copy.promptManual].map(
        (prompt) => (
          <button
            key={prompt}
            disabled={disabled}
            onClick={() => onSend(prompt)}
          >
            <span>{prompt}</span>
            <ArrowUpRight size={13} />
          </button>
        ),
      )}
    </div>
  );
}

function MessageInput({
  voice,
  language,
  disabled,
}: {
  voice: VoiceSession;
  language: Language;
  disabled: boolean;
}): React.JSX.Element {
  const copy = text(language);
  const [draft, setDraft] = useState("");
  const pending = voice.status === "connecting" || voice.status === "thinking";
  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!draft.trim() || pending) return;
    const message = draft;
    if (await voice.sendText(message))
      setDraft((current) => (current === message ? "" : current));
  };
  return (
    <form className="message-form" onSubmit={(event) => void submit(event)}>
      <label htmlFor="message" className="sr-only">
        {copy.placeholder}
      </label>
      <input
        id="message"
        autoComplete="off"
        maxLength={4000}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={copy.placeholder}
        disabled={disabled}
      />
      <button
        type="submit"
        aria-label={copy.send}
        disabled={disabled || pending || !draft.trim()}
      >
        <ArrowUp size={18} />
      </button>
      <small>{copy.textMode}</small>
    </form>
  );
}

function friendlyAudioError(error: string, language: Language): string {
  const copy = text(language);
  if (error === "AUDIO_UNSUPPORTED") return copy.audioUnsupported;
  if (error.startsWith("MICROPHONE_ACCESS:")) return copy.audioDenied;
  return error;
}
