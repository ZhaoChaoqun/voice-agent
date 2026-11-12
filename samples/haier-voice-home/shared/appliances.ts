/** Verified China-market references; these do not imply a real IoT connection. */
import type { Language } from "@shared/protocol";

type ReferencedAppliance = {
  model: string;
  name: Record<Language, string>;
  sizeMm: { width: number; height: number; depth: number };
  url: string;
};

// HomeStore owns household identity; V3/V4 authored meshes use these same official
// dimensions for proportions. Knowledge excerpts document the verified features.
export const APPLIANCE_CATALOG: Record<
  "tv" | "fridge" | "ac",
  ReferencedAppliance
> = {
  tv: {
    model: "75V80D",
    name: { zh: "Seeker 智慧屏", en: "Seeker 75-inch TV" },
    sizeMm: { width: 1669, height: 963, depth: 31 },
    url: "https://www.haier.com/televisions/20260423_289662.shtml",
  },
  fridge: {
    model: "BCD-480WGHTDEDXMU1",
    name: { zh: "小红花四门冰箱", en: "Xiaohonghua four-door fridge" },
    sizeMm: { width: 830, height: 1850, depth: 594 },
    url: "https://www.haier.com/cooling/20260914_294934.shtml",
  },
  ac: {
    model: "KFR-35GW/Z6A",
    name: { zh: "舒适风空调", en: "Comfort Wind air conditioner" },
    sizeMm: { width: 910, height: 315, depth: 215 },
    url: "https://www.haier.com/air_conditioners/20260915_294973.shtml",
  },
};
