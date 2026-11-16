/** Manual controls and agent tools share the same validated server state. */
import {
  AirVent,
  Blinds,
  ChevronRight,
  Droplets,
  LampFloor,
  Minus,
  Plus,
  Power,
  Refrigerator,
  Tv,
  X,
} from "lucide-react";

import type {
  Device,
  DeviceCommand,
  DeviceId,
  Language,
} from "@shared/protocol";
import { text } from "@/i18n";
import { CONTROL_LIMITS } from "@shared/controls";

export const deviceIcons = {
  tv: Tv,
  fridge: Refrigerator,
  ac: AirVent,
  humidifier: Droplets,
  lights: LampFloor,
  curtains: Blinds,
};

interface DeviceProps {
  devices: Device[];
  language: Language;
  selected: DeviceId | null;
  busy: boolean;
  onSelect: (device: DeviceId | null) => void;
  onControl: (command: DeviceCommand) => Promise<void>;
}

export function Devices(props: DeviceProps): React.JSX.Element {
  const copy = text(props.language);
  const selected = props.devices.find((device) => device.id === props.selected);
  return (
    <section className="devices-section">
      <div className="section-heading">
        <h2>
          {copy.devices}
          <span>{String(props.devices.length).padStart(2, "0")}</span>
        </h2>
        <span>
          {props.devices.length} {copy.online}
        </span>
      </div>
      <div className="device-grid">
        {props.devices.map((device) => (
          <DeviceCard key={device.id} device={device} {...props} />
        ))}
      </div>
      {selected && <DeviceInspector device={selected} {...props} />}
    </section>
  );
}

function DeviceCard(
  props: DeviceProps & { device: Device },
): React.JSX.Element {
  const { device, language, onSelect, onControl, busy, selected } = props;
  const copy = text(language);
  const Icon = deviceIcons[device.id];
  return (
    <article
      className={`device-card ${device.power ? "is-on" : ""} ${selected === device.id ? "is-selected" : ""}`}
    >
      <button
        className="device-card-main"
        onClick={() => onSelect(selected === device.id ? null : device.id)}
        aria-expanded={selected === device.id}
      >
        <span className="device-icon">
          <Icon size={23} strokeWidth={1.5} />
        </span>
        <span className="device-card-name">
          {device.name[language]}
          <small>{deviceSummary(device, language)}</small>
        </span>
        <ChevronRight className="device-chevron" size={14} />
      </button>
      <button
        className={`power-switch ${device.power ? "active" : ""}`}
        role="switch"
        aria-checked={device.power}
        aria-label={`${device.name[language]} · ${device.power ? copy.turnOff : copy.turnOn}`}
        onClick={() =>
          void onControl({ deviceId: device.id, power: !device.power })
        }
        disabled={busy}
      >
        <span />
      </button>
    </article>
  );
}

function deviceSummary(device: Device, language: Language): string {
  const copy = text(language);
  if (!device.power) return copy.off;
  if (device.id === "ac") return `${device.settings.temperature ?? 24}°C`;
  if (device.id === "fridge")
    return `${device.settings.fridgeTemp ?? 4}°C / ${device.settings.freezerTemp ?? -18}°C`;
  if (device.id === "humidifier")
    return `${copy.targetHumidity} ${device.settings.targetHumidity ?? 50}%`;
  if (device.id === "lights")
    return `${copy.brightness} ${device.settings.brightness ?? 65}%`;
  if (device.id === "tv")
    return `${copy.volume} ${device.settings.volume ?? 20}%`;
  return device.settings.position === "closed" ? copy.closed : copy.open;
}

function DeviceInspector(
  props: DeviceProps & { device: Device },
): React.JSX.Element {
  const { device, language } = props;
  const copy = text(language);
  const fields = numericFields(device, language);
  return (
    <div className="device-inspector" data-testid="device-inspector">
      <div className="inspector-heading">
        <div>
          <small>{copy.manualControl}</small>
          <h3>
            {device.name[language]}
            <span>{device.model}</span>
          </h3>
        </div>
        <button
          className="icon-button"
          aria-label={copy.close}
          onClick={() => props.onSelect(null)}
        >
          <X size={17} />
        </button>
      </div>
      <div className="inspector-controls">
        {fields.map((field) => (
          <StepControl key={field.key} field={field} {...props} />
        ))}
        {device.id === "curtains" && (
          <div className="curtain-actions">
            <span>{copy.position}</span>
            {(["open", "closed"] as const).map((position) => (
              <button
                key={position}
                className={
                  device.settings.position === position ? "chosen" : ""
                }
                disabled={props.busy}
                onClick={() =>
                  void props.onControl({
                    deviceId: "curtains",
                    power: position === "open",
                    settings: { position },
                  })
                }
              >
                {copy[position]}
              </button>
            ))}
          </div>
        )}
        <button
          className="subtle-button"
          disabled={props.busy}
          onClick={() =>
            void props.onControl({ deviceId: device.id, power: !device.power })
          }
        >
          <Power size={14} />
          {device.power ? copy.turnOff : copy.turnOn}
        </button>
      </div>
    </div>
  );
}

interface NumericField {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}

function numericFields(device: Device, language: Language): NumericField[] {
  const copy = text(language);
  const fields: Partial<Record<DeviceId, NumericField[]>> = {
    ac: [
      {
        key: "temperature",
        label: copy.target,
        ...CONTROL_LIMITS.ac.temperature,
        step: 1,
        unit: "°C",
      },
    ],
    fridge: [
      {
        key: "fridgeTemp",
        label: copy.fridgeTemp,
        ...CONTROL_LIMITS.fridge.fridgeTemp,
        step: 1,
        unit: "°C",
      },
      {
        key: "freezerTemp",
        label: copy.freezerTemp,
        ...CONTROL_LIMITS.fridge.freezerTemp,
        step: 1,
        unit: "°C",
      },
    ],
    humidifier: [
      {
        key: "targetHumidity",
        label: copy.targetHumidity,
        ...CONTROL_LIMITS.humidifier.targetHumidity,
        step: 5,
        unit: "%",
      },
    ],
    lights: [
      {
        key: "brightness",
        label: copy.brightness,
        ...CONTROL_LIMITS.lights.brightness,
        step: 5,
        unit: "%",
      },
    ],
    tv: [
      {
        key: "volume",
        label: copy.volume,
        ...CONTROL_LIMITS.tv.volume,
        step: 5,
        unit: "%",
      },
    ],
  };
  return fields[device.id] ?? [];
}

function StepControl(
  props: DeviceProps & { device: Device; field: NumericField },
): React.JSX.Element {
  const { device, field } = props;
  const value = Number(device.settings[field.key] ?? field.min);
  const change = (direction: number): void => {
    const next = Math.max(
      field.min,
      Math.min(field.max, value + direction * field.step),
    );
    void props.onControl({
      deviceId: device.id,
      settings: { [field.key]: next },
    });
  };
  return (
    <div className="step-control">
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
