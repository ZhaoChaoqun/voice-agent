/** Curated scenes are atomic backend actions, not local optimistic illusions. */
import { Armchair, Clapperboard, DoorOpen, ArrowUpRight } from "lucide-react";

import type { Language, SceneId } from "@shared/protocol";
import { text } from "@/i18n";

interface SceneProps {
  language: Language;
  active: SceneId | null;
  busy: boolean;
  onScene: (scene: SceneId) => Promise<void>;
}

export function Scenes(props: SceneProps): React.JSX.Element {
  const copy = text(props.language);
  const scenes = [
    {
      id: "movie" as const,
      Icon: Clapperboard,
      detail:
        props.language === "zh"
          ? "柔光 · 好温度 · 沉浸"
          : "Soft lights. Just-right comfort.",
    },
    {
      id: "comfort" as const,
      Icon: Armchair,
      detail:
        props.language === "zh"
          ? "温度刚好，湿度也刚好"
          : "Your own little comfort zone.",
    },
    {
      id: "away" as const,
      Icon: DoorOpen,
      detail:
        props.language === "zh" ? "关掉牵挂，安心出门" : "Less to worry about.",
    },
  ];
  return (
    <section className="scenes-section">
      <div className="section-heading">
        <h2>{copy.sceneTitle}</h2>
        <span>SCENES</span>
      </div>
      <div className="scene-grid">
        {scenes.map(({ id, Icon, detail }) => (
          <button
            key={id}
            className={`scene-card scene-${id} ${props.active === id ? "active" : ""}`}
            onClick={() => void props.onScene(id)}
            disabled={props.busy}
            aria-pressed={props.active === id}
          >
            <Icon size={23} strokeWidth={1.4} />
            <ArrowUpRight size={15} className="scene-arrow" />
            <strong>{copy[id]}</strong>
            <span>{detail}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
