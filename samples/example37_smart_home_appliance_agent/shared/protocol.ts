/** Browser/server contract for the isolated, simulated appliance room. */
export type Language = "zh" | "en";
export type LocalizedText = Record<Language, string>;
export type DeviceId =
  "tv" | "fridge" | "ac" | "humidifier" | "lights" | "curtains";
export type SceneId = "movie" | "comfort" | "away";

export interface Device {
  id: DeviceId;
  name: LocalizedText;
  model: string;
  power: boolean;
  settings: Record<string, string | number | boolean>;
}

export interface HomeState {
  devices: Device[];
  environment: {
    temperature: number;
    humidity: number;
    airQuality: number;
    simulated: true;
  };
  activeScene: SceneId | null;
  revision: number;
  lifestyle?: LifestyleState;
}

export interface FridgeItem {
  id: string;
  name: LocalizedText;
  quantity: number;
  unit: string;
  storedDays: number;
  reminder: "low_stock" | "use_soon" | "none";
}

export interface ShoppingItem {
  itemId: string;
  quantity: number;
}

export interface LifestyleState {
  inventory: FridgeItem[];
  shoppingList: ShoppingItem[];
  simulated: true;
}

export interface ModelOption {
  id: string;
  label: string;
  available: boolean;
  reason?: string;
  agentName?: string;
}

export interface KnowledgeSource {
  id: string;
  title: string;
  model: string;
  url?: string;
  kind: "manufacturer" | "demo" | "uploaded";
}

export interface DemoConfig {
  models: ModelOption[];
  home: HomeState;
  knowledge: KnowledgeSource[];
  backend: { configured: boolean; mode: string; message?: string };
}

export interface DeviceCommand {
  deviceId: DeviceId;
  power?: boolean;
  settings?: Record<string, string | number | boolean>;
}

export interface ToolActivity {
  id: string;
  name: string;
  status: "running" | "success" | "error";
  summary: string;
  sources?: KnowledgeSource[];
}

export interface DemoEvent {
  type: string;
  home?: HomeState;
  activity?: ToolActivity;
  message?: string;
  sources?: KnowledgeSource[];
  [key: string]: unknown;
}
