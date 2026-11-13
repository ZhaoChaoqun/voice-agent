/** Habitat is an independent composition reusing only proven transport and controls. */
import { lazy, Suspense, useEffect, useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  Globe2,
  Moon,
  Sun,
  Sunset,
} from "lucide-react";

import type { DeviceId, Language, SceneId } from "@shared/protocol";
import { Knowledge } from "@/components/Knowledge";
import { useHome } from "@/hooks/useHome";
import { useVoice } from "@/hooks/useVoice";
import { DevicePanel } from "@v2/components/Devices";
import { VoiceDock } from "@v2/components/VoiceDock";
import { copy } from "@v2/copy";
import type { Atmosphere } from "@v2/scene/math";
import { defaultModel } from "@v2/model";

const Stage = lazy(() =>
  import("@habitat/Stage").then((module) => ({ default: module.Stage })),
);
const LOOKS = [
  { id: "day", Icon: Sun },
  { id: "dusk", Icon: Sunset },
  { id: "cinema", Icon: Moon },
] as const; // Icons never replace readable bilingual labels.
const SCENES: SceneId[] = ["comfort", "movie", "away"]; // These are the existing server-validated household presets.

/**
 * Compose the fourth experience without forking voice or appliance business logic.
 *
 * Returns
 * -------
 * React.JSX.Element
 *     Accessible bilingual room, controls, model chooser and real voice dock.
 */
export function App(): React.JSX.Element {
  const [language, setLanguage] = useState<Language>("zh");
  const [model, setModel] = useState("");
  const [mode, setMode] = useState<Atmosphere>("day");
  const [selected, setSelected] = useState<DeviceId | null>(null);
  const [paused] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [knowledge, setKnowledge] = useState(false);
  const [conversation, setConversation] = useState(false);
  const home = useHome();
  const voice = useVoice({ model, language, onHome: home.updateHome });
  const t = copy(language);
  const zh = language === "zh";
  useEffect(() => {
    document.documentElement.lang = zh ? "zh-CN" : "en";
  }, [zh]);
  useEffect(() => {
    if (!model && home.config) setModel(defaultModel(home.config.models));
  }, [model, home.config]);
  useEffect(() => {
    if (home.config?.home.activeScene === "movie") setMode("cinema");
    if (home.config?.home.activeScene === "comfort") setMode("dusk");
  }, [home.config?.home.activeScene]);
  return (
    <main className="habitat" data-mode={mode}>
      <header className="habitat-header">
        <a className="habitat-brand" href="/" aria-label="Smart Home Habitat">
          <strong>Smart Home</strong>
          <i />
          <span>
            HABITAT<small>INTELLIGENT LIVING / 04</small>
          </span>
        </a>
        <nav className="habitat-looks" aria-label={t.atmosphere}>
          {LOOKS.map(({ id, Icon }) => (
            <button
              key={id}
              aria-label={t[id]}
              aria-pressed={mode === id}
              onClick={() => setMode(id)}
            >
              <Icon size={16} />
              <span>{t[id]}</span>
            </button>
          ))}
        </nav>
        <div className="habitat-language">
          <Globe2 size={16} />
          <button aria-pressed={zh} onClick={() => setLanguage("zh")}>
            中文
          </button>
          <span>/</span>
          <button aria-pressed={!zh} onClick={() => setLanguage("en")}>
            EN
          </button>
        </div>
      </header>
      <section className="habitat-title">
        <div>
          <p className="habitat-kicker">A HOME IN THE LIGHT</p>
          <h1>
            {zh ? "住进光里，与家对话。" : "Live in the light. Feel at home."}
          </h1>
        </div>
        <p>
          {zh
            ? "自然的材质，真实的光影。\n一个听得懂你的智慧之家。"
            : "Natural materials. A new perspective.\nA living space that listens."}
        </p>
      </section>
      <div className="habitat-grid">
        <section
          className="habitat-room"
          aria-label={zh ? "平视室内空间" : "Eye-level interior"}
        >
          <div className="habitat-room-caption">
            <span>
              <i />
              {zh ? "客厅 · 开放式厨房" : "LIVING ROOM · OPEN KITCHEN"}
            </span>
            <span>01 — 06</span>
          </div>
          <Suspense
            fallback={
              <div className="habitat-loading">
                {zh ? "正在构建光影空间…" : "Preparing the room…"}
              </div>
            }
          >
            {home.config && (
              <Stage
                home={home.config.home}
                language={language}
                selected={selected}
                mode={mode}
                paused={paused}
                onSelect={setSelected}
              />
            )}
          </Suspense>
          <div className="habitat-scenes" aria-label={t.scenes}>
            {SCENES.map((id) => (
              <button
                key={id}
                disabled={home.busy}
                aria-pressed={home.config?.home.activeScene === id}
                onClick={() => void home.scene(id)}
              >
                {home.config?.home.activeScene === id && <Check size={14} />}
                {t[id]}
              </button>
            ))}
          </div>
        </section>
        <aside className="habitat-controls">
          {home.config && (
            <>
              <div className="habitat-balance">
                <span>
                  {zh ? "舒适，恰到好处。" : "YOUR SPACE, IN BALANCE"}
                </span>
                <div>
                  <strong>
                    {home.config.home.environment.temperature}
                    <small>°C</small>
                  </strong>
                  <strong>
                    {home.config.home.environment.humidity}
                    <small>%</small>
                  </strong>
                  <strong>
                    {t.fresh}
                    <small>AQI {home.config.home.environment.airQuality}</small>
                  </strong>
                </div>
                <div className="habitat-metric-labels">
                  <span>{t.temperature}</span>
                  <span>{t.humidity}</span>
                  <span>{t.air}</span>
                </div>
              </div>
              <DevicePanel
                devices={home.config.home.devices}
                language={language}
                selected={selected}
                busy={home.busy}
                onSelect={setSelected}
                onControl={home.control}
              />
              <div className="habitat-engine">
                <label htmlFor="atelier-model">{t.model}</label>
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
                      {!option.available &&
                        (zh ? " · 暂不可用" : " · unavailable")}
                    </option>
                  ))}
                </select>
                <small>{t.modelHint}</small>
                <button onClick={() => setKnowledge(true)}>
                  <BookOpen size={16} />
                  {t.knowledge}
                  <ArrowUpRight size={15} />
                </button>
              </div>
            </>
          )}
        </aside>
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
      </div>
      {(home.error || !home.config) && (
        <div className="habitat-notice" role="alert">
          {home.error || t.connecting}
          {home.error && (
            <button onClick={() => void home.refresh()}>
              {zh ? "重新连接" : "Retry"}
            </button>
          )}
        </div>
      )}
      <footer className="habitat-footer">
        <span>HABITAT / 04 — LIGHT, MATERIAL, LIFE.</span>
        <p>{t.disclaimer}</p>
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
