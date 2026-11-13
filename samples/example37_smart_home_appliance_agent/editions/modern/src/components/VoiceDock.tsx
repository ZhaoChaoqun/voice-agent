/** Minimal live voice dock and a separate, readable conversation sheet. */
import { useState } from "react";
import {
  ArrowUp,
  AudioLines,
  BookOpen,
  Check,
  ChevronUp,
  CircleAlert,
  LoaderCircle,
  MessageCircle,
  Mic,
  MicOff,
  PhoneOff,
  Sparkles,
  Square,
  X,
} from "lucide-react";

import type { Language } from "@shared/protocol";
import type { VoiceSession } from "@/hooks/useVoice";
import { readableTranscript } from "@/lib/conversation";
import { copy } from "@v2/copy";

interface Props {
  language: Language;
  voice: VoiceSession;
  available: boolean;
  expanded: boolean;
  onExpanded: (expanded: boolean) => void;
  onKnowledge: () => void;
}

/** Keep microphone and typed turns on the same real, auditable session. */
export function VoiceDock(props: Props): React.JSX.Element {
  const { voice, language } = props;
  const t = copy(language);
  const [draft, setDraft] = useState("");
  const active = voice.status !== "idle" && voice.status !== "error";
  const pending = voice.status === "connecting" || voice.status === "thinking";
  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!draft.trim() || pending) return;
    props.onExpanded(true);
    if (await voice.sendText(draft)) setDraft("");
  };
  const start = (): void => {
    if (active && voice.hasMicrophone) voice.stop();
    else void voice.connect(true);
  };
  return (
    <div className={`voice-dock ${voice.status}`}>
      {props.expanded && <Conversation {...props} />}
      <div className="dock-status">
        <span className="tiny-dot" />
        <span>{t[voice.status]}</span>
        <button
          aria-label={t.conversation}
          aria-expanded={props.expanded}
          onClick={() => props.onExpanded(!props.expanded)}
        >
          <MessageCircle size={13} />
          <ChevronUp size={12} className={props.expanded ? "flipped" : ""} />
        </button>
      </div>
      {voice.error && (
        <div className="dock-error" role="alert">
          <CircleAlert size={14} />
          {voice.error.startsWith("MICROPHONE_ACCESS:")
            ? t.microphoneError
            : voice.error}
        </div>
      )}
      <div className="dock-body">
        <button
          className={`microphone ${active && voice.hasMicrophone ? "live" : ""}`}
          onClick={start}
          disabled={!props.available || voice.status === "connecting"}
          aria-label={active && voice.hasMicrophone ? t.end : t.start}
        >
          {voice.status === "connecting" ? (
            <LoaderCircle className="spin" size={22} />
          ) : active && voice.hasMicrophone ? (
            <Square size={16} fill="currentColor" />
          ) : (
            <Mic size={24} strokeWidth={1.5} />
          )}
        </button>
        <div className="dock-content">
          <span className="companion-label">
            <Sparkles size={11} />
            {t.brand}
            <small>VOICE LIVE</small>
          </span>
          <form onSubmit={(event) => void submit(event)}>
            <input
              id="atelier-message"
              value={draft}
              maxLength={4000}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t.placeholder}
              aria-label={t.placeholder}
              disabled={!props.available}
            />
            <button
              type="submit"
              disabled={!draft.trim() || pending || !props.available}
              aria-label={t.send}
            >
              <ArrowUp size={17} />
            </button>
          </form>
        </div>
        <div className="waveform" aria-hidden="true">
          {Array.from({ length: 11 }, (_, index) => (
            <i key={index} style={{ "--i": index } as React.CSSProperties} />
          ))}
        </div>
        {active && (
          <button
            className="dock-small-button"
            onClick={
              voice.hasMicrophone
                ? voice.toggleMute
                : () => void voice.connect(true)
            }
            aria-label={voice.muted || !voice.hasMicrophone ? t.unmute : t.mute}
          >
            {voice.muted ? <MicOff size={16} /> : <Mic size={16} />}
          </button>
        )}
        {active && (
          <button
            className="dock-small-button"
            onClick={voice.cancel}
            aria-label={t.interrupt}
          >
            <Square size={13} />
          </button>
        )}
        {active && (
          <button
            className="dock-small-button"
            onClick={voice.stop}
            aria-label={t.end}
          >
            <PhoneOff size={14} />
          </button>
        )}
      </div>
      <div className="dock-meta">
        <span>{t.auto}</span>
        <span>{t.companion}</span>
      </div>
    </div>
  );
}

function Conversation(props: Props): React.JSX.Element {
  const { voice, language } = props;
  const t = copy(language);
  const [tab, setTab] = useState<"conversation" | "activity">("conversation");
  return (
    <section className="conversation-sheet">
      <div className="sheet-tabs">
        <button
          className={tab === "conversation" ? "chosen" : ""}
          onClick={() => setTab("conversation")}
        >
          {t.conversation}
        </button>
        <button
          className={tab === "activity" ? "chosen" : ""}
          onClick={() => setTab("activity")}
        >
          {t.activity}
          <small>{voice.activities.length}</small>
        </button>
        <button
          className="sheet-close"
          aria-label={t.close}
          onClick={() => props.onExpanded(false)}
        >
          <X size={15} />
        </button>
      </div>
      <div className="transcript" role="log" aria-live="polite">
        {tab === "conversation" && voice.messages.length === 0 && (
          <div className="empty-sheet">
            <AudioLines size={23} />
            <p>{t.empty}</p>
            {[t.prompt1, t.prompt2].map((prompt) => (
              <button
                key={prompt}
                disabled={!props.available}
                onClick={() => void voice.sendText(prompt)}
              >
                {prompt}
                <ArrowUp size={13} />
              </button>
            ))}
          </div>
        )}
        {tab === "conversation" &&
          voice.messages.map((message) => (
            <div key={message.id} className={`chat-message ${message.role}`}>
              <span>
                {message.role === "assistant" ? (
                  <Sparkles size={12} />
                ) : language === "zh" ? (
                  "你"
                ) : (
                  "You"
                )}
              </span>
              <p>{readableTranscript(message.text)}</p>
            </div>
          ))}
        {tab === "activity" && voice.activities.length === 0 && (
          <p className="empty-activity">{t.noActivity}</p>
        )}
        {tab === "activity" &&
          [...voice.activities].reverse().map((activity) => (
            <div key={activity.id} className={`tool-entry ${activity.status}`}>
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
        {tab === "conversation" &&
          voice.sources.map((source) => (
            <div className="citation" key={source.id}>
              <BookOpen size={12} />
              <span>{source.title}</span>
              {source.url?.startsWith("https://") && (
                <a href={source.url} target="_blank" rel="noreferrer">
                  ↗
                </a>
              )}
            </div>
          ))}
      </div>
      <button className="knowledge-shortcut" onClick={props.onKnowledge}>
        <BookOpen size={12} />
        {t.source}
        <span>↗</span>
      </button>
    </section>
  );
}
