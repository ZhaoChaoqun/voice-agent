/** Validated, persistent state for one explicitly simulated demo household. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { CONTROL_LIMITS } from "@shared/controls";
import { APPLIANCE_CATALOG } from "@shared/appliances";
import {
  initialLifestyle,
  lifestyleSchema,
  MAX_RESTOCK_QUANTITY,
  shoppingSchema,
} from "#server/lifestyle";
import type {
  Device,
  DeviceCommand,
  DeviceId,
  HomeState,
  SceneId,
} from "@shared/protocol";

const deviceIdSchema = z.enum([
  "tv",
  "fridge",
  "ac",
  "humidifier",
  "lights",
  "curtains",
]);
export const sceneSchema = z
  .object({ scene: z.enum(["movie", "comfort", "away"]) })
  .strict();
export const commandSchema = z
  .object({
    deviceId: deviceIdSchema,
    power: z.boolean().optional(),
    settings: z
      .record(
        z.string(),
        z.union([z.string(), z.number().finite(), z.boolean()]),
      )
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.power !== undefined || Object.keys(value.settings ?? {}).length > 0,
  );

const settingsSchemas = {
  tv: z
    .object({
      mediaTitle: z.string().trim().min(1).max(120),
      volume: z
        .number()
        .int()
        .min(CONTROL_LIMITS.tv.volume.min)
        .max(CONTROL_LIMITS.tv.volume.max),
      channel: z.enum(["home", "movie", "music"]),
    })
    .partial()
    .strict(),
  fridge: z
    .object({
      fridgeTemp: z
        .number()
        .int()
        .min(CONTROL_LIMITS.fridge.fridgeTemp.min)
        .max(CONTROL_LIMITS.fridge.fridgeTemp.max),
      freezerTemp: z
        .number()
        .int()
        .min(CONTROL_LIMITS.fridge.freezerTemp.min)
        .max(CONTROL_LIMITS.fridge.freezerTemp.max),
    })
    .partial()
    .strict(),
  ac: z
    .object({
      temperature: z
        .number()
        .min(CONTROL_LIMITS.ac.temperature.min)
        .max(CONTROL_LIMITS.ac.temperature.max),
      mode: z.enum(["cool", "heat", "auto", "fan"]),
      fanSpeed: z.enum(["low", "medium", "high", "auto"]),
    })
    .partial()
    .strict(),
  humidifier: z
    .object({
      targetHumidity: z
        .number()
        .int()
        .min(CONTROL_LIMITS.humidifier.targetHumidity.min)
        .max(CONTROL_LIMITS.humidifier.targetHumidity.max),
      mistLevel: z.enum(["low", "medium", "high", "auto"]),
    })
    .partial()
    .strict(),
  lights: z
    .object({
      brightness: z
        .number()
        .int()
        .min(CONTROL_LIMITS.lights.brightness.min)
        .max(CONTROL_LIMITS.lights.brightness.max),
      warmth: z.number().int().min(2700).max(6500),
    })
    .partial()
    .strict(),
  curtains: z
    .object({ position: z.enum(["open", "closed"]) })
    .partial()
    .strict(),
};

/** Expected user-facing validation errors; never wrap upstream exception details. */
export class InputError extends Error {}

function initialHome(): HomeState {
  return {
    devices: [
      {
        id: "tv",
        name: APPLIANCE_CATALOG.tv.name,
        model: APPLIANCE_CATALOG.tv.model,
        power: false,
        settings: { volume: 35, channel: "home" },
      },
      {
        id: "fridge",
        name: APPLIANCE_CATALOG.fridge.name,
        model: APPLIANCE_CATALOG.fridge.model,
        power: true,
        settings: { fridgeTemp: 4, freezerTemp: -18 },
      },
      {
        id: "ac",
        name: APPLIANCE_CATALOG.ac.name,
        model: APPLIANCE_CATALOG.ac.model,
        power: false,
        settings: { temperature: 24, mode: "auto", fanSpeed: "auto" },
      },
      {
        id: "humidifier",
        name: { zh: "智能加湿器", en: "Humidifier" },
        model: "Generic humidifier",
        power: false,
        settings: { targetHumidity: 50, mistLevel: "auto" },
      },
      {
        id: "lights",
        name: { zh: "氛围灯", en: "Ambient lights" },
        model: "Ambient lighting",
        power: true,
        settings: { brightness: 75, warmth: 3200 },
      },
      {
        id: "curtains",
        name: { zh: "智能窗帘", en: "Smart curtains" },
        model: "Motorized curtains",
        power: true,
        settings: { position: "open" },
      },
    ],
    environment: {
      temperature: 26.4,
      humidity: 42,
      airQuality: 18,
      simulated: true,
    },
    activeScene: null,
    revision: 0,
    lifestyle: initialLifestyle(),
  };
}

function applyCommand(home: HomeState, command: DeviceCommand): void {
  const parsed = commandSchema.safeParse(command);
  if (!parsed.success) throw new InputError("Invalid device command.");
  const settings = settingsSchemas[command.deviceId].safeParse(
    command.settings ?? {},
  );
  if (!settings.success)
    throw new InputError(
      "Unsupported setting or value outside the appliance's demo range.",
    );
  const device = home.devices.find((entry) => entry.id === command.deviceId);
  if (!device) throw new InputError("Unknown device.");
  if (command.deviceId === "fridge" && command.power === false) {
    throw new InputError(
      "For food safety, the demo does not switch off the refrigerator.",
    );
  }
  if (command.deviceId === "curtains") {
    applyCurtainState(device, command);
    return;
  }
  if (command.power !== undefined) device.power = command.power;
  Object.assign(device.settings, settings.data);
}

function applyCurtainState(device: Device, command: DeviceCommand): void {
  const position = command.settings?.position;
  if (
    position !== undefined &&
    command.power !== undefined &&
    command.power !== (position === "open")
  ) {
    throw new InputError(
      "Curtain power and position must describe the same open or closed state.",
    );
  }
  const open =
    position !== undefined ? position === "open" : command.power === true;
  device.power = open;
  device.settings.position = open ? "open" : "closed";
}

function sceneCommands(scene: SceneId): DeviceCommand[] {
  if (scene === "movie") {
    return [
      {
        deviceId: "tv",
        power: true,
        settings: { channel: "movie", volume: 30 },
      },
      {
        deviceId: "lights",
        power: true,
        settings: { brightness: 20, warmth: 2700 },
      },
      { deviceId: "curtains", settings: { position: "closed" } },
    ];
  }
  if (scene === "comfort") {
    return [
      {
        deviceId: "ac",
        power: true,
        settings: { temperature: 24, mode: "auto" },
      },
      { deviceId: "humidifier", power: true, settings: { targetHumidity: 50 } },
      {
        deviceId: "lights",
        power: true,
        settings: { brightness: 65, warmth: 3200 },
      },
    ];
  }
  return [
    { deviceId: "tv", power: false },
    { deviceId: "ac", power: false },
    { deviceId: "humidifier", power: false },
    { deviceId: "lights", power: false },
    { deviceId: "curtains", settings: { position: "closed" } },
  ];
}

/** State writes are atomic; environmental readings never jump with setpoints. */
export class HomeStore {
  private home = initialHome();
  private listeners = new Set<(home: HomeState) => void>();

  constructor(private readonly statePath?: string) {
    if (!statePath) return;
    try {
      const saved = JSON.parse(readFileSync(statePath, "utf8")) as HomeState;
      const restored = initialHome();
      if (
        !Number.isSafeInteger(saved.revision) ||
        saved.revision < 0 ||
        !Array.isArray(saved.devices)
      )
        return;
      for (const device of saved.devices)
        applyCommand(restored, {
          deviceId: device.id,
          power: device.power,
          settings: device.settings,
        });
      if (
        saved.activeScene !== null &&
        !sceneSchema.safeParse({ scene: saved.activeScene }).success
      )
        return;
      restored.activeScene = saved.activeScene;
      restored.revision = saved.revision;
      if (saved.lifestyle)
        restored.lifestyle = lifestyleSchema.parse(saved.lifestyle);
      else
        console.info(
          "Initialized household concierge records for an existing saved home",
        );
      this.home = restored;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        console.warn("Saved demo state was invalid; using safe defaults.");
    }
  }

  /** Return an isolated state snapshot without sharing mutable device references. */
  snapshot(): HomeState {
    return structuredClone(this.home);
  }

  /** Apply one validated command and publish it only after durable persistence. */
  control(command: DeviceCommand): HomeState {
    const next = this.snapshot();
    applyCommand(next, command);
    next.activeScene = null;
    return this.commit(next);
  }

  /** Apply an entire scene atomically, retaining refrigerator power and settings. */
  scene(scene: SceneId): HomeState {
    if (!sceneSchema.safeParse({ scene }).success)
      throw new InputError("Unknown scene.");
    const next = this.snapshot();
    for (const command of sceneCommands(scene)) applyCommand(next, command);
    next.activeScene = scene;
    return this.commit(next);
  }

  /**
   * Prepare a chosen title and its reversible viewing environment atomically.
   *
   * Parameters
   * ----------
   * title : string
   *     User-selected title; this does not start licensed video streaming.
   *
   * Returns
   * -------
   * HomeState
   *     Persisted TV, lighting and curtain state.
   *
   * Raises
   * ------
   * InputError
   *     If the title is empty or longer than the supported bound.
   */
  prepareMedia(title: string): HomeState {
    const checked = z.string().trim().min(1).max(120).safeParse(title);
    if (!checked.success)
      throw new InputError("Provide a title of 1–120 characters.");
    const next = this.snapshot();
    for (const command of sceneCommands("movie")) applyCommand(next, command);
    applyCommand(next, {
      deviceId: "tv",
      settings: { mediaTitle: checked.data },
    });
    next.activeScene = "movie";
    return this.commit(next);
  }

  /**
   * Update a private replenishment list without placing a merchant order.
   *
   * Parameters
   * ----------
   * input : unknown
   *     Confirmed item, quantity and add/remove action.
   *
   * Returns
   * -------
   * HomeState
   *     Persisted household including the updated list.
   *
   * Raises
   * ------
   * InputError
   *     For invalid items, quantities or an accumulated quantity overflow.
   */
  updateShopping(input: unknown): HomeState {
    const checked = shoppingSchema.safeParse(input);
    if (!checked.success)
      throw new InputError("Choose a known item and quantity from 1 to 10.");
    const next = this.snapshot();
    if (!next.lifestyle)
      throw new InputError("Household concierge context is unavailable.");
    const { action, itemId, quantity } = checked.data;
    const previous =
      next.lifestyle.shoppingList.find((item) => item.itemId === itemId)
        ?.quantity ?? 0;
    const total = previous + quantity;
    if (action === "add" && total > MAX_RESTOCK_QUANTITY)
      throw new InputError(
        `A replenishment item cannot exceed ${MAX_RESTOCK_QUANTITY} units.`,
      );
    next.lifestyle.shoppingList = next.lifestyle.shoppingList.filter(
      (item) => item.itemId !== itemId,
    );
    if (action === "add")
      next.lifestyle.shoppingList.push({ itemId, quantity: total });
    return this.commit(next);
  }

  /** Restore demonstration defaults while keeping a monotonically increasing revision. */
  reset(): HomeState {
    return this.commit(initialHome());
  }

  /** Subscribe to successful state changes; return an unsubscribe function. */
  subscribe(listener: (home: HomeState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private commit(next: HomeState): HomeState {
    next.revision = this.home.revision + 1;
    if (this.statePath) {
      mkdirSync(dirname(this.statePath), { recursive: true });
      const stagingPath = `${this.statePath}.next`;
      writeFileSync(stagingPath, JSON.stringify(next), { mode: 0o600 });
      renameSync(stagingPath, this.statePath);
    }
    this.home = next;
    console.info("Demo household updated", {
      revision: next.revision,
      scene: next.activeScene,
    });
    for (const listener of this.listeners) listener(this.snapshot());
    return this.snapshot();
  }
}

export type { Device, DeviceId };
