/** Accessible semantic markers sit above the full-screen cinematic WebGL scene. */
import { useEffect, useRef, useState } from "react";

import type { DeviceId, HomeState, Language } from "@shared/protocol";
import { Atelier, type SceneSnapshot } from "@v2/scene/Atelier";
import type { Atmosphere } from "@v2/scene/math";

interface Props {
  home: HomeState;
  language: Language;
  selected: DeviceId | null;
  mode: Atmosphere;
  paused: boolean;
  resetKey: number;
  onSelect: (device: DeviceId) => void;
}

declare global {
  interface Window {
    __atelier?: { snapshot: () => SceneSnapshot };
  }
}

/** Only this component owns the scene; React never rebuilds geometry on a tool result. */
export function Stage(props: Props): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const markers = useRef(new Map<DeviceId, HTMLButtonElement>());
  const scene = useRef<Atelier | null>(null);
  const select = useRef(props.onSelect);
  const [failed, setFailed] = useState(false);
  select.current = props.onSelect;
  useEffect(() => {
    if (!host.current) return;
    try {
      const current = new Atelier(host.current, markers.current, (id) =>
        select.current(id),
      );
      scene.current = current;
      window.__atelier = { snapshot: () => current.snapshot() };
    } catch (error) {
      console.error("Atelier WebGL initialization failed", error);
      setFailed(true);
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
      delete window.__atelier;
    };
  }, []);
  useEffect(() => {
    scene.current?.update(props.home);
  }, [props.home]);
  useEffect(() => {
    scene.current?.setAtmosphere(props.mode);
  }, [props.mode]);
  useEffect(() => {
    if (scene.current) scene.current.paused = props.paused;
  }, [props.paused]);
  useEffect(() => {
    if (props.selected) scene.current?.focus(props.selected);
    else scene.current?.reset();
  }, [props.selected]);
  useEffect(() => {
    scene.current?.reset();
  }, [props.resetKey]);
  return (
    <div className="stage" ref={host} data-testid="stage">
      {failed && (
        <div className="webgl-error" role="alert">
          {props.language === "zh"
            ? "当前浏览器无法启动 3D 渲染，请开启硬件加速。设备和语音控制仍然可用。"
            : "Enable browser hardware acceleration for the 3D experience. Device and voice controls still work."}
        </div>
      )}
      {!failed &&
        props.home.devices.map((device, index) => (
          <button
            key={device.id}
            className={`hotspot ${device.power ? "on" : ""} ${props.selected === device.id ? "selected" : ""}`}
            ref={(element) => {
              if (element) markers.current.set(device.id, element);
              else markers.current.delete(device.id);
            }}
            onClick={() => props.onSelect(device.id)}
            aria-label={`${device.name[props.language]} · ${props.language === "zh" ? "控制设备" : "Control device"}`}
            aria-pressed={props.selected === device.id}
          >
            <i>{String(index + 1).padStart(2, "0")}</i>
            <span>
              {device.name[props.language]}
              <small>{device.power ? "●" : "○"}</small>
            </span>
          </button>
        ))}
    </div>
  );
}
