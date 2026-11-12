/** Bounded household context and source-dated entertainment for the home concierge. */
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { LifestyleState } from "@shared/protocol";

// Used by lifestyle validation, HomeStore's accumulated bound, and ToolRunner's
// public function schema so repeated additions cannot bypass the list limit.
export const MAX_RESTOCK_QUANTITY = 10; // Maximum units of one replenishment item; no checkout exists.
const CATALOG_FRESH_DAYS = 7; // Older snapshots must not be described as a current popularity chart.
const DAY_MS = 86_400_000; // Convert a source snapshot's age to whole days.
export const shoppingSchema = z
  .object({
    action: z.enum(["add", "remove"]),
    itemId: z.enum(["milk", "apples", "strawberries", "eggs"]),
    quantity: z.number().int().min(1).max(MAX_RESTOCK_QUANTITY).default(1),
  })
  .strict();
export const lifestyleSchema = z
  .object({
    simulated: z.literal(true),
    inventory: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.object({ zh: z.string(), en: z.string() }),
            quantity: z.number().nonnegative(),
            unit: z.string(),
            storedDays: z.number().int().nonnegative(),
            reminder: z.enum(["low_stock", "use_soon", "none"]),
          })
          .strict(),
      )
      .max(40),
    shoppingList: z
      .array(
        z
          .object({
            itemId: z.string(),
            quantity: z.number().int().min(1).max(MAX_RESTOCK_QUANTITY),
          })
          .strict(),
      )
      .max(40),
  })
  .strict();
const catalogSchema = z
  .object({
    asOf: z.string().datetime(),
    items: z.array(
      z
        .object({
          id: z.string(),
          title: z.string(),
          kind: z.enum(["series", "movie"]),
          platform: z.string(),
          sourceUrl: z.string().url(),
          sourceDate: z.iso.date().nullable(),
          description: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
const catalog = catalogSchema.parse(
  JSON.parse(
    readFileSync(
      new URL("../knowledge/entertainment.json", import.meta.url),
      "utf8",
    ),
  ),
);

/**
 * Create independent illustrative records, never presented as sensor observations.
 *
 * Returns
 * -------
 * LifestyleState
 *     Fresh records and an empty replenishment list for one household.
 */
export function initialLifestyle(): LifestyleState {
  return {
    simulated: true,
    inventory: [
      {
        id: "milk",
        name: { zh: "牛奶", en: "milk" },
        quantity: 0.25,
        unit: "L",
        storedDays: 2,
        reminder: "low_stock",
      },
      {
        id: "apples",
        name: { zh: "苹果", en: "apples" },
        quantity: 3,
        unit: "pieces",
        storedDays: 6,
        reminder: "use_soon",
      },
      {
        id: "strawberries",
        name: { zh: "草莓", en: "strawberries" },
        quantity: 1,
        unit: "box",
        storedDays: 3,
        reminder: "use_soon",
      },
      {
        id: "eggs",
        name: { zh: "鸡蛋", en: "eggs" },
        quantity: 6,
        unit: "pieces",
        storedDays: 4,
        reminder: "none",
      },
    ],
    shoppingList: [],
  };
}

/**
 * Return a traceable snapshot rather than an invented live ranking.
 *
 * Parameters
 * ----------
 * kind : "series" | "movie"
 *     Category requested by the user.
 * options : object, optional
 *     Clock override for deterministic snapshot-age checks.
 *
 * Returns
 * -------
 * Record<string, unknown>
 *     Dated selections, individual source freshness and displayable references.
 */
export function mediaRecommendations(
  kind: "series" | "movie",
  { now = Date.now() }: { now?: number } = {},
): Record<string, unknown> {
  const ageMs = Math.max(0, now - Date.parse(catalog.asOf));
  return {
    asOf: catalog.asOf,
    stale: ageMs > CATALOG_FRESH_DAYS * DAY_MS,
    liveRanking: false,
    items: catalog.items
      .filter((item) => item.kind === kind)
      .map((item) => ({
        ...item,
        sourceStale:
          item.sourceDate === null ||
          now - Date.parse(item.sourceDate) > CATALOG_FRESH_DAYS * DAY_MS,
      })),
    sources: catalog.items
      .filter((item) => item.kind === kind)
      .map((item) => ({
        id: item.id,
        title: `${item.platform} · ${item.title} · ${item.sourceDate ?? "undated reference"}`,
        model: "MEDIA",
        kind: "uploaded" as const,
        url: item.sourceUrl,
      })),
    note: "Curated, source-dated selections, not a live chart or a streaming entitlement. Do not invent ranks, membership, release dates, or playback availability.",
  };
}
