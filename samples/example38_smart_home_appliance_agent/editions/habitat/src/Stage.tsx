/** React owns accessible semantic controls; Habitat owns its own WebGL resources. */
import { useEffect, useRef, useState } from "react";

import type { DeviceId, HomeState, Language } from "@shared/protocol";
import type { Atmosphere } from "@v2/scene/math";
import { Habitat, type HabitatSnapshot } from "@habitat/scene/Habitat";

interface StageProps {
  home: HomeState;
  language: Language;
  selected: DeviceId | null;
  mode: Atmosphere;
  paused: boolean;
  onSelect: (id: DeviceId) => void;
}

declare global {
  interface Window {
    __habitat?: { snapshot: () => HabitatSnapshot };
  }
}

/**
 * Mount the original fourth-edition renderer with visible failure handling.
 *
 * Parameters
 * ----------
 * props : StageProps
 *     Authoritative state and presentation settings.
 *
 * Returns
 * -------
 * React.JSX.Element
 *     WebGL pane and keyboard-accessible appliance hotspots.
 */
export function Stage(props: StageProps): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const markers = useRef(new Map<DeviceId, HTMLButtonElement>());
  const scene = useRef<Habitat | null>(null);
  const select = useRef(props.onSelect);
  const [failure, setFailure] = useState("");
  select.current = props.onSelect;
  useEffect(() => {
    if (!host.current) return;
    try {
      const current = new Habitat(
        host.current,
        markers.current,
        (id) => select.current(id),
        setFailure,
      );
      scene.current = current;
      window.__habitat = { snapshot: () => current.snapshot() };
    } catch (error) {
      console.error("Habitat initialization failed", error);
      setFailure(error instanceof Error ? error.message : "WebGL unavailable");
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
      delete window.__habitat;
    };
  }, []);
  useEffect(() => scene.current?.update(props.home), [props.home]);
  useEffect(() => scene.current?.setAtmosphere(props.mode), [props.mode]);
  useEffect(() => {
    if (scene.current) scene.current.paused = props.paused;
  }, [props.paused]);
  useEffect(() => scene.current?.select(props.selected), [props.selected]);
  return (
    <div
      className={`habitat-stage ${failure ? "failed" : ""}`}
      ref={host}
      data-testid="habitat-stage"
    >
      {failure ? (
        <div className="habitat-webgl-error" role="alert">
          <strong>
            {props.language === "zh"
              ? "3D 渲染暂不可用"
              : "3D rendering unavailable"}
          </strong>
          <p>
            {props.language === "zh"
              ? "请开启硬件加速并刷新页面。设备与真实语音控制仍然可用。"
              : "Enable hardware acceleration and reload. Device and real voice controls remain available."}
          </p>
        </div>
      ) : (
        props.home.devices.map((device, index) => (
          <button
            key={device.id}
            className={`hotspot ${device.power ? "on" : ""} ${props.selected === device.id ? "selected" : ""}`}
            ref={(element) => {
              if (element) markers.current.set(device.id, element);
              else markers.current.delete(device.id);
            }}
            aria-label={`${device.name[props.language]} · ${props.language === "zh" ? "控制设备" : "Control device"}`}
            aria-pressed={props.selected === device.id}
            onClick={() => props.onSelect(device.id)}
          >
            <i>{String(index + 1).padStart(2, "0")}</i>
            <span>
              {device.name[props.language]}
              <small>{device.power ? "●" : "○"}</small>
            </span>
          </button>
        ))
      )}
    </div>
  );
}
