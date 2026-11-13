/** A new compact luxury control surface with the existing server's validated limits. */
import {
  AirVent,
  ArrowUpRight,
  Blinds,
  Droplets,
  LampFloor,
  Minus,
  Plus,
  Power,
  Refrigerator,
  Tv,
  X,
} from "lucide-react";

import { CONTROL_LIMITS } from "@shared/controls";
import type {
  Device,
  DeviceCommand,
  DeviceId,
  Language,
} from "@shared/protocol";
import { copy, type Copy } from "@v2/copy";

const icons = {
  tv: Tv,
  fridge: Refrigerator,
  ac: AirVent,
  humidifier: Droplets,
  lights: LampFloor,
  curtains: Blinds,
};
interface Props {
  devices: Device[];
  language: Language;
  selected: DeviceId | null;
  busy: boolean;
  onSelect: (id: DeviceId | null) => void;
  onControl: (command: DeviceCommand) => Promise<void>;
}

/** Provide a keyboard-accessible route to every appliance without relying on WebGL. */
export function DevicePanel(props: Props): React.JSX.Element {
  const t = copy(props.language);
  const selected = props.devices.find((device) => device.id === props.selected);
  return (
    <div className="device-panel">
      <div className="panel-caption">
        <span>{t.living}</span>
        <span className="tiny-dot" />
        {String(props.devices.length).padStart(2, "0")} {t.connected}
      </div>
      <div className="panel-title">
        <h2>{selected ? t.selected : t.devices}</h2>
        <span>↗</span>
      </div>
      {selected ? (
        <Detail {...props} device={selected} />
      ) : (
        <div className="device-list">
          {props.devices.map((device) => (
            <DeviceRow key={device.id} {...props} device={device} />
          ))}
        </div>
      )}
      <div className="panel-footnote">
        <span className="tiny-dot" />
        {t.simulated}
      </div>
    </div>
  );
}

function DeviceRow(props: Props & { device: Device }): React.JSX.Element {
  const { device, language } = props;
  const t = copy(language);
  const Icon = icons[device.id];
  return (
    <article className={`device-row ${device.power ? "powered" : ""}`}>
      <button
        className="device-select"
        onClick={() => props.onSelect(device.id)}
      >
        <Icon size={20} strokeWidth={1.3} />
        <span>
          <strong>{device.name[language]}</strong>
          <small>{summary(device, t)}</small>
        </span>
        <ArrowUpRight size={13} />
      </button>
      <button
        className="switch"
        role="switch"
        aria-checked={device.power}
        aria-label={`${device.name[language]} · ${t.power}`}
        disabled={props.busy}
        onClick={() =>
          void props.onControl({ deviceId: device.id, power: !device.power })
        }
      >
        <i />
      </button>
    </article>
  );
}

function summary(device: Device, t: Copy): string {
  if (!device.power) return t.off;
  if (device.id === "ac") return `${device.settings.temperature}°C`;
  if (device.id === "fridge")
    return `${device.settings.fridgeTemp}° / ${device.settings.freezerTemp}°`;
  if (device.id === "humidifier") return `${device.settings.targetHumidity}%`;
  if (device.id === "lights") return `${device.settings.brightness}%`;
  if (device.id === "curtains")
    return device.settings.position === "open" ? t.open : t.closed;
  if (
    device.id === "tv" &&
    device.settings.channel === "movie" &&
    device.settings.mediaTitle
  )
    return String(device.settings.mediaTitle);
  return `${t.volume} ${device.settings.volume}`;
}

interface Field {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}
function fields(device: Device, t: Copy): Field[] {
  const entries: Partial<Record<DeviceId, Field[]>> = {
    ac: [
      {
        key: "temperature",
        label: t.target,
        ...CONTROL_LIMITS.ac.temperature,
        step: 1,
        unit: "°C",
      },
    ],
    fridge: [
      {
        key: "fridgeTemp",
        label: t.fridgeTemp,
        ...CONTROL_LIMITS.fridge.fridgeTemp,
        step: 1,
        unit: "°C",
      },
      {
        key: "freezerTemp",
        label: t.freezerTemp,
        ...CONTROL_LIMITS.fridge.freezerTemp,
        step: 1,
        unit: "°C",
      },
    ],
    humidifier: [
      {
        key: "targetHumidity",
        label: t.targetHumidity,
        ...CONTROL_LIMITS.humidifier.targetHumidity,
        step: 5,
        unit: "%",
      },
    ],
    lights: [
      {
        key: "brightness",
        label: t.brightness,
        ...CONTROL_LIMITS.lights.brightness,
        step: 5,
        unit: "%",
      },
    ],
    tv: [
      {
        key: "volume",
        label: t.volume,
        ...CONTROL_LIMITS.tv.volume,
        step: 5,
        unit: "%",
      },
    ],
  };
  return entries[device.id] ?? [];
}

function Detail(props: Props & { device: Device }): React.JSX.Element {
  const { device, language } = props;
  const t = copy(language);
  const Icon = icons[device.id];
  return (
    <div className="device-detail" data-testid="device-detail">
      <button className="detail-back" onClick={() => props.onSelect(null)}>
        <X size={14} />
        {t.overview}
      </button>
      <div className="device-hero">
        <Icon size={52} strokeWidth={0.8} />
        <span className="device-halo" />
      </div>
      <h3>{device.name[language]}</h3>
      <span className="model-id">{device.model}</span>
      <div className="detail-power">
        <span>{t.power}</span>
        <button
          className={`power-icon ${device.power ? "on" : ""}`}
          onClick={() =>
            void props.onControl({ deviceId: device.id, power: !device.power })
          }
          disabled={props.busy}
          aria-label={`${device.name[language]} · ${t.power}`}
        >
          <Power size={16} />
        </button>
      </div>
      {fields(device, t).map((field) => (
        <Numeric key={field.key} field={field} {...props} />
      ))}
      {device.id === "curtains" && (
        <div className="curtain-buttons">
          {(["open", "closed"] as const).map((position) => (
            <button
              key={position}
              className={device.settings.position === position ? "chosen" : ""}
              disabled={props.busy}
              onClick={() =>
                void props.onControl({
                  deviceId: "curtains",
                  settings: { position },
                })
              }
            >
              {t[position]}
            </button>
          ))}
        </div>
      )}
      <p className="detail-note">{t.manual}</p>
    </div>
  );
}

function Numeric(
  props: Props & { device: Device; field: Field },
): React.JSX.Element {
  const { device, field } = props;
  const value = Number(device.settings[field.key]);
  const change = (direction: number): void => {
    const next = Math.min(
      field.max,
      Math.max(field.min, value + direction * field.step),
    );
    void props.onControl({
      deviceId: device.id,
      settings: { [field.key]: next },
    });
  };
  return (
    <div className="numeric-control">
      <span>{field.label}</span>
      <div>
        <button
          disabled={props.busy || value <= field.min}
          aria-label={`${field.label} -`}
          onClick={() => change(-1)}
        >
          <Minus size={13} />
        </button>
        <output>
          {value}
          <small>{field.unit}</small>
        </output>
        <button
          disabled={props.busy || value >= field.max}
          aria-label={`${field.label} +`}
          onClick={() => change(1)}
        >
          <Plus size={13} />
        </button>
      </div>
    </div>
  );
}
