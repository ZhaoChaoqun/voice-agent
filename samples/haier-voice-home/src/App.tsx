/** A bilingual, original Three.js home connected to a real Voice Agent. */
import { lazy, Suspense, useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  CircleAlert,
  Droplets,
  Globe2,
  Info,
  Leaf,
  LoaderCircle,
  RotateCcw,
  Thermometer,
  X,
} from "lucide-react";

import type {
  DemoConfig,
  DeviceId,
  HomeState,
  Language,
} from "@shared/protocol";
import { Assistant } from "@/components/Assistant";
import { Devices } from "@/components/Devices";
import { Knowledge } from "@/components/Knowledge";
import { Scenes } from "@/components/Scenes";
import { useHome } from "@/hooks/useHome";
import { useDialog } from "@/hooks/useDialog";
import { useVoice } from "@/hooks/useVoice";
import { text } from "@/i18n";

const Room = lazy(() =>
  import("@/components/Room").then((module) => ({ default: module.Room })),
);

export function App(): React.JSX.Element {
  const [language, setLanguage] = useState<Language>("zh");
  const [model, setModel] = useState("");
  const [selected, setSelected] = useState<DeviceId | null>(null);
  const [modal, setModal] = useState<"knowledge" | "about" | null>(null);
  const home = useHome();
  const voice = useVoice({ model, language, onHome: home.updateHome });
  const copy = text(language);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language]);
  useEffect(() => {
    if (!model && home.config)
      setModel(
        home.config.models.find((option) => option.available)?.id ??
          home.config.models[0]?.id ??
          "",
      );
  }, [home.config, model]);

  return (
    <div className="app-shell">
      <Header
        language={language}
        onLanguage={setLanguage}
        onAbout={() => setModal("about")}
      />
      {!home.config ? (
        <Loading
          error={home.error}
          language={language}
          onRetry={() => void home.refresh()}
        />
      ) : (
        <main className="dashboard">
          <div className="home-column">
            <Welcome language={language} home={home.config.home} />
            {(home.error || !home.config.backend.configured) && (
              <div className="page-alert" role="alert">
                <CircleAlert size={17} />
                <span>
                  {home.error || home.config.backend.message || copy.noBackend}
                </span>
                <button aria-label={copy.close} onClick={home.dismissError}>
                  <X size={15} />
                </button>
              </div>
            )}
            <Suspense
              fallback={
                <div className="room-panel room-loading">
                  <LoaderCircle className="spin" />
                  {copy.loading}
                </div>
              }
            >
              <Room
                home={home.config.home}
                language={language}
                selected={selected}
                onSelect={setSelected}
              />
            </Suspense>
            <Scenes
              language={language}
              active={home.config.home.activeScene}
              busy={home.busy}
              onScene={home.scene}
            />
            <Devices
              devices={home.config.home.devices}
              language={language}
              selected={selected}
              busy={home.busy}
              onSelect={setSelected}
              onControl={home.control}
            />
            <div className="home-footer">
              <span>
                <Info size={12} />
                {copy.simulation}
              </span>
              <button
                onClick={() => void home.reset()}
                disabled={home.busy}
                title={copy.resetHint}
              >
                <RotateCcw size={12} />
                {copy.reset}
              </button>
            </div>
          </div>
          <Assistant
            language={language}
            models={home.config.models}
            model={model}
            onModel={setModel}
            voice={voice}
            onKnowledge={() => setModal("knowledge")}
          />
        </main>
      )}
      <footer className="site-footer">
        <span>
          Haier <span>×</span> Voice Live
        </span>
        <p>{copy.disclaimer}</p>
        <span>HOME, IN HARMONY.</span>
      </footer>
      {modal === "knowledge" && home.config && (
        <Knowledge
          language={language}
          sources={home.config.knowledge}
          onAdd={home.addKnowledge}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "about" && home.config && (
        <About
          language={language}
          config={home.config}
          onClose={() => setModal(null)}
          onKnowledge={() => setModal("knowledge")}
        />
      )}
    </div>
  );
}

function Header(props: {
  language: Language;
  onLanguage: (language: Language) => void;
  onAbout: () => void;
}): React.JSX.Element {
  const copy = text(props.language);
  return (
    <header className="site-header">
      <div className="brand">
        <span className="haier-wordmark">Haier</span>
        <span className="brand-divider" />
        <span>{copy.brand}</span>
      </div>
      <nav aria-label={copy.navigation}>
        <span className="nav-active">{copy.navigation}</span>
        <span className="nav-concept">EXPERIENCE CONCEPT</span>
      </nav>
      <div className="header-actions">
        <div className="language-toggle" aria-label="Interface language">
          <Globe2 size={14} />
          <button
            aria-pressed={props.language === "zh"}
            onClick={() => props.onLanguage("zh")}
          >
            中文
          </button>
          <span>/</span>
          <button
            aria-pressed={props.language === "en"}
            onClick={() => props.onLanguage("en")}
          >
            EN
          </button>
        </div>
        <button
          className="icon-button about-button"
          aria-label={copy.settingsTitle}
          onClick={props.onAbout}
        >
          <Info size={19} />
        </button>
      </div>
    </header>
  );
}

function Welcome({
  language,
  home,
}: {
  language: Language;
  home: HomeState;
}): React.JSX.Element {
  const copy = text(language);
  return (
    <section className="welcome">
      <div>
        <span className="eyebrow">{copy.eyebrow}</span>
        <h1>{copy.title}</h1>
        <p>{copy.subtitle}</p>
      </div>
      <div
        className="environment"
        aria-label={
          language === "zh" ? "模拟环境读数" : "Simulated sensor readings"
        }
      >
        <div>
          <Thermometer size={16} />
          <strong>
            {home.environment.temperature}
            <small>°C</small>
          </strong>
          <span>{copy.temperature}</span>
        </div>
        <div>
          <Droplets size={16} />
          <strong>
            {home.environment.humidity}
            <small>%</small>
          </strong>
          <span>{copy.humidity}</span>
        </div>
        <div>
          <Leaf size={16} />
          <strong className="air-label">{copy.good}</strong>
          <span>
            {copy.airQuality} {home.environment.airQuality}
          </span>
        </div>
      </div>
    </section>
  );
}

function Loading({
  error,
  language,
  onRetry,
}: {
  error: string;
  language: Language;
  onRetry: () => void;
}): React.JSX.Element {
  const copy = text(language);
  return (
    <main className="loading-screen">
      {error ? (
        <>
          <CircleAlert size={28} />
          <h1>{copy.loadFailed}</h1>
          <p>{error}</p>
          <button className="primary-button" onClick={onRetry}>
            {copy.retry}
            <ArrowRight size={14} />
          </button>
        </>
      ) : (
        <>
          <LoaderCircle className="spin" size={28} />
          <p>{copy.loading}</p>
        </>
      )}
    </main>
  );
}

function About(props: {
  language: Language;
  config: DemoConfig;
  onClose: () => void;
  onKnowledge: () => void;
}): React.JSX.Element {
  const copy = text(props.language);
  const dialog = useDialog(props.onClose);
  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <section
        ref={dialog}
        tabIndex={-1}
        className="about-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <span className="section-icon">
            <Info size={22} />
          </span>
          <div>
            <h2 id="about-title">{copy.settingsTitle}</h2>
            <p>Three.js + Foundry Voice Agent + Voice Live</p>
          </div>
          <button
            className="icon-button"
            aria-label={copy.close}
            onClick={props.onClose}
          >
            <X size={20} />
          </button>
        </div>
        <div className="about-status">
          <span
            className={`status-dot ${props.config.backend.configured ? "live" : ""}`}
          />
          <strong>{copy.backend}</strong>
          <span>{props.config.backend.mode}</span>
        </div>
        <p>{props.config.backend.message}</p>
        <p>{copy.simulation}</p>
        <div className="about-models">
          {props.config.models.map((model) => (
            <div key={model.id}>
              {model.available ? (
                <Check size={15} />
              ) : (
                <CircleAlert size={15} />
              )}
              <strong>{model.label}</strong>
              <small>{model.reason ?? model.agentName}</small>
            </div>
          ))}
        </div>
        <button className="knowledge-link" onClick={props.onKnowledge}>
          <BookOpen size={15} />
          <span>{copy.knowledge}</span>
          <ArrowRight size={15} />
        </button>
        <p className="knowledge-notice">{copy.disclaimer}</p>
      </section>
    </div>
  );
}
