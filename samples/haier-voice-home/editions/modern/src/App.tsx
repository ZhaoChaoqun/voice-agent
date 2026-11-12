/** Atelier: an independent immersive frontend sharing V1's proven real AI transport. */
import { lazy, Suspense, useEffect, useState } from "react";
import {
  Armchair,
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  Clapperboard,
  DoorOpen,
  Droplets,
  Globe2,
  LoaderCircle,
  Maximize,
  Moon,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  Sun,
  Sunset,
  Thermometer,
  Wind,
  X,
} from "lucide-react";

import type { DeviceId, Language, SceneId } from "@shared/protocol";
import { useHome } from "@/hooks/useHome";
import { useVoice } from "@/hooks/useVoice";
import { Knowledge } from "@/components/Knowledge";
import { copy } from "@v2/copy";
import { DevicePanel } from "@v2/components/Devices";
import { VoiceDock } from "@v2/components/VoiceDock";
import type { Atmosphere } from "@v2/scene/math";
import { defaultModel } from "@v2/model";

const Stage = lazy(() =>
  import("@v2/components/Stage").then((module) => ({ default: module.Stage })),
);
const atmosphereIcons = { day: Sun, dusk: Sunset, cinema: Moon }; // Distinguish daylight, sunset and night even without labels.

/** Own the new composition while keeping household and voice transport shared with V1. */
export function App(): React.JSX.Element {
  const [language, setLanguage] = useState<Language>("zh");
  const [model, setModel] = useState("");
  const [mode, setMode] = useState<Atmosphere>("day");
  const [paused, setPaused] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [selected, setSelected] = useState<DeviceId | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [knowledge, setKnowledge] = useState(false);
  const [conversation, setConversation] = useState(false);
  const [settings, setSettings] = useState(false);
  const [panel, setPanel] = useState(true);
  const home = useHome();
  const voice = useVoice({ model, language, onHome: home.updateHome });
  const t = copy(language);
  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language]);
  useEffect(() => {
    if (!model && home.config) setModel(defaultModel(home.config.models));
  }, [model, home.config]);
  useEffect(() => {
    if (home.config?.home.activeScene === "movie") setMode("cinema");
    if (home.config?.home.activeScene === "comfort") setMode("dusk");
  }, [home.config?.home.activeScene]);
  const resetView = (): void => {
    setSelected(null);
    setResetKey((current) => current + 1);
  };
  const scene = async (id: SceneId): Promise<void> => {
    await home.scene(id);
  };
  return (
    <main className="atelier" data-mode={mode}>
      {home.config && (
        <Suspense
          fallback={
            <div className="stage-loading">
              <LoaderCircle className="spin" />
            </div>
          }
        >
          <Stage
            home={home.config.home}
            language={language}
            selected={selected}
            mode={mode}
            paused={paused}
            resetKey={resetKey}
            onSelect={(id) => {
              setSelected(id);
              setPanel(true);
            }}
          />
        </Suspense>
      )}
      <div className="cinematic-shade" />
      <header className="masthead">
        <a className="atelier-brand" href="/" aria-label="Haier Atelier">
          <strong>Haier</strong>
          <i />
          <span>
            ATELIER<small>INTELLIGENT LIVING</small>
          </span>
        </a>
        <div className="atmosphere-picker" aria-label={t.atmosphere}>
          {(["day", "dusk", "cinema"] as const).map((value) => {
            const Icon = atmosphereIcons[value];
            return (
              <button
                key={value}
                aria-label={t[value]}
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
              >
                <Icon size={13} />
                <span>{t[value]}</span>
              </button>
            );
          })}
        </div>
        <div className="masthead-actions">
          <div className="language-picker">
            <Globe2 size={13} />
            <button
              aria-pressed={language === "zh"}
              onClick={() => setLanguage("zh")}
            >
              中文
            </button>
            <span>/</span>
            <button
              aria-pressed={language === "en"}
              onClick={() => setLanguage("en")}
            >
              EN
            </button>
          </div>
          <button
            className="icon-btn"
            onClick={() => setSettings(!settings)}
            aria-label={t.settings}
            aria-expanded={settings}
          >
            <Settings2 size={18} />
          </button>
        </div>
      </header>
      <section className="editorial">
        <span className="eyebrow">
          <i />
          {t.live}
        </span>
        <h1>{t.title}</h1>
        <p>{t.subtitle}</p>
        <div className="edition-label">
          {t.edition}
          <span>DESIGNED TO FEEL.</span>
        </div>
      </section>
      {home.config && (
        <div className="climate">
          <span className="climate-caption">{t.environment}</span>
          <div>
            <span>
              <Thermometer size={14} />
              <strong>
                {home.config.home.environment.temperature}
                <small>°C</small>
              </strong>
              <label>{t.temperature}</label>
            </span>
            <i />
            <span>
              <Droplets size={14} />
              <strong>
                {home.config.home.environment.humidity}
                <small>%</small>
              </strong>
              <label>{t.humidity}</label>
            </span>
            <i />
            <span>
              <Wind size={14} />
              <strong className="air-value">{t.fresh}</strong>
              <label>
                {t.air} · {home.config.home.environment.airQuality}
              </label>
            </span>
          </div>
        </div>
      )}
      <div className="right-rail">
        <div className="rail-heading">
          <span>SMART LIVING / 01</span>
          <button
            onClick={() => setPanel(!panel)}
            aria-label={t.devices}
            aria-expanded={panel}
          >
            <ChevronDown size={14} className={!panel ? "flipped" : ""} />
          </button>
        </div>
        {home.config && panel && (
          <DevicePanel
            devices={home.config.home.devices}
            language={language}
            selected={selected}
            busy={home.busy}
            onSelect={setSelected}
            onControl={home.control}
          />
        )}
        {home.config && (
          <div className="engine-panel">
            <label htmlFor="atelier-model">
              {t.model}
              <span>✦</span>
            </label>
            <div>
              <select
                id="atelier-model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                title={t.modelHint}
              >
                {home.config.models.map((option) => (
                  <option
                    key={option.id}
                    value={option.id}
                    disabled={!option.available}
                  >
                    {option.label}
                    {!option.available
                      ? language === "zh"
                        ? " · 暂不可用"
                        : " · unavailable"
                      : ""}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} />
            </div>
            <button onClick={() => setKnowledge(true)}>
              <BookOpen size={13} />
              <span>{t.knowledge}</span>
              <ArrowUpRight size={12} />
            </button>
          </div>
        )}
      </div>
      {settings && (
        <section className="settings-sheet" aria-label={t.settings}>
          <div>
            <strong>{t.settings}</strong>
            <button
              className="icon-btn"
              aria-label={t.close}
              onClick={() => setSettings(false)}
            >
              <X size={16} />
            </button>
          </div>
          <p>{t.modelHint}</p>
          {home.config?.models
            .filter((option) => !option.available)
            .map((option) => (
              <p key={option.id}>
                <strong>{option.label}</strong>
                <br />
                {option.reason}
              </p>
            ))}
          <a
            href={import.meta.env.VITE_CLASSIC_URL ?? "http://127.0.0.1:5178"}
            target="_blank"
            rel="noreferrer"
          >
            {t.original}
          </a>
          <button onClick={() => void home.reset()} disabled={home.busy}>
            <RotateCcw size={12} />
            {t.reset}
          </button>
          <small>{t.disclaimer}</small>
        </section>
      )}
      {(home.error || !home.config) && (
        <div className="connection-notice" role="alert">
          {home.error ||
            (language === "zh"
              ? "正在连接智慧之家…"
              : "Connecting to your home…")}
          {home.error && (
            <button onClick={() => void home.refresh()}>
              <RotateCcw size={12} />
            </button>
          )}
        </div>
      )}
      <div className="bottom-left">
        <div className="scene-collection">
          <small>{t.scenes}</small>
          <div>
            {(
              [
                { id: "movie", Icon: Clapperboard },
                { id: "comfort", Icon: Armchair },
                { id: "away", Icon: DoorOpen },
              ] as const
            ).map(({ id, Icon }) => (
              <button
                key={id}
                onClick={() => void scene(id)}
                disabled={home.busy}
                aria-pressed={home.config?.home.activeScene === id}
              >
                <Icon size={16} strokeWidth={1.3} />
                <span>{t[id]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="view-tools">
          <span>{t.view}</span>
          <button aria-label={t.resetView} onClick={resetView}>
            <RotateCcw size={14} />
          </button>
          <button
            aria-label={paused ? t.resume : t.pause}
            aria-pressed={paused}
            onClick={() => setPaused(!paused)}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
          <button
            aria-label={t.fullscreen}
            onClick={() => {
              if (!document.fullscreenElement)
                void document.documentElement
                  .requestFullscreen()
                  .catch((error: unknown) =>
                    console.error("Fullscreen unavailable", error),
                  );
              else void document.exitFullscreen();
            }}
          >
            <Maximize size={14} />
          </button>
          <i />
          <small>{t.controls}</small>
        </div>
      </div>
      <VoiceDock
        language={language}
        voice={voice}
        available={
          home.config?.models.find((option) => option.id === model)
            ?.available ?? false
        }
        expanded={conversation}
        onExpanded={setConversation}
        onKnowledge={() => setKnowledge(true)}
      />
      <footer className="stage-footer">
        <span>HOME IS A FEELING.</span>
        <span>{t.disclaimer}</span>
        <span>02 / IMMERSIVE EDITION</span>
      </footer>
      {knowledge && home.config && (
        <Knowledge
          language={language}
          sources={home.config.knowledge}
          onAdd={home.addKnowledge}
          onClose={() => setKnowledge(false)}
        />
      )}
    </main>
  );
}
