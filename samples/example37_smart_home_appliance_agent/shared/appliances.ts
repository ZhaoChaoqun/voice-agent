/** Fictional appliances and approximate proportions for the procedural room. */
import type { Language } from "@shared/protocol";

type ReferencedAppliance = {
  model: string;
  name: Record<Language, string>;
  sizeMm: { width: number; height: number; depth: number };
  url: string;
};

export const APPLIANCE_CATALOG: Record<
  "tv" | "fridge" | "ac",
  ReferencedAppliance
> = {
  tv: {
    model: "SAMPLE-TV-01",
    name: { zh: "示例客厅电视", en: "Sample living-room TV" },
    sizeMm: { width: 1600, height: 900, depth: 40 },
    url: "https://github.com/microsoft/voice-agent/blob/main/samples/example37_smart_home_appliance_agent/knowledge/products.json",
  },
  fridge: {
    model: "SAMPLE-FRIDGE-01",
    name: { zh: "示例四门冰箱", en: "Sample four-door fridge" },
    sizeMm: { width: 800, height: 1800, depth: 600 },
    url: "https://github.com/microsoft/voice-agent/blob/main/samples/example37_smart_home_appliance_agent/knowledge/products.json",
  },
  ac: {
    model: "SAMPLE-AC-01",
    name: { zh: "示例空调", en: "Sample air conditioner" },
    sizeMm: { width: 900, height: 300, depth: 200 },
    url: "https://github.com/microsoft/voice-agent/blob/main/samples/example37_smart_home_appliance_agent/knowledge/products.json",
  },
};
