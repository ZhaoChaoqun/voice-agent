/** Accessible device markers complement the WebGL room's pointer controls. */
import { useEffect, useRef, useState } from "react";
import { Home, Minus, Plus, RotateCcw } from "lucide-react";

import type { DeviceId, HomeState, Language } from "@shared/protocol";
import { text } from "@/i18n";
import { RoomScene } from "@/scene/RoomScene";

interface RoomProps {
  home: HomeState;
  language: Language;
  selected: DeviceId | null;
  onSelect: (id: DeviceId) => void;
}

export function Room(props: RoomProps): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<RoomScene | null>(null);
  const markers = useRef(new Map<DeviceId, HTMLButtonElement>());
  const selection = useRef(props.onSelect);
  const [unavailable, setUnavailable] = useState(false);
  const copy = text(props.language);
  selection.current = props.onSelect;

  useEffect(() => {
    if (!container.current) return;
    try {
      scene.current = new RoomScene(
        container.current,
        (id) => selection.current(id),
        markers.current,
      );
    } catch (error) {
      console.error("Could not initialize the 3D room", error);
      setUnavailable(true);
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  useEffect(() => {
    scene.current?.update(props.home);
  }, [props.home]);

  return (
    <section className="room-panel" aria-label={copy.room}>
      <div className="room-header">
        <div className="room-name">
          <span className="room-icon">
            <Home size={17} />
          </span>
          <div>
            <h2>{copy.room}</h2>
            <p>{copy.roomCaption}</p>
          </div>
        </div>
        <span className="room-live">
          <span className="status-dot" />
          {copy.connected}
        </span>
      </div>
      <div className="room-viewport" ref={container} data-testid="room">
        {unavailable && (
          <div className="room-fallback">{copy.roomUnavailable}</div>
        )}
        {!unavailable &&
          props.home.devices.map((device) => (
            <button
              key={device.id}
              className={`device-marker ${props.selected === device.id ? "selected" : ""} ${device.power ? "powered" : ""}`}
              ref={(element) => {
                if (element) markers.current.set(device.id, element);
                else markers.current.delete(device.id);
              }}
              onClick={() => props.onSelect(device.id)}
              aria-label={`${device.name[props.language]} · ${device.power ? copy.on : copy.off}`}
              aria-pressed={props.selected === device.id}
            >
              <span className="marker-dot" />
              <span>{device.name[props.language]}</span>
            </button>
          ))}
        <span className="room-watermark">A LITTLE MORE COMFORT.</span>
      </div>
      <div className="room-bottom">
        <span className="room-drag">{copy.drag}</span>
        <div className="view-controls">
          <button
            aria-label={copy.zoomOut}
            onClick={() => scene.current?.zoom(-1)}
          >
            <Minus size={16} />
          </button>
          <button
            aria-label={copy.zoomIn}
            onClick={() => scene.current?.zoom(1)}
          >
            <Plus size={16} />
          </button>
          <button
            aria-label={copy.resetView}
            onClick={() => scene.current?.resetView()}
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>
    </section>
  );
}
