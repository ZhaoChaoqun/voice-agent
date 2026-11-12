/** Server-only Foundry configuration; no credential is returned to the browser. */
import type { DemoConfig, ModelOption } from "@shared/protocol";
import { z } from "zod";
import { HomeStore } from "#server/home";
import { KnowledgeStore } from "#server/knowledge";

const nameSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,80}$/);

export interface RuntimeConfig {
  projectEndpoint?: string;
  tenantId?: string;
  models: ModelOption[];
}

/** Accept only Foundry project URLs; clients cannot choose an upstream endpoint. */
export function runtimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const projectEndpoint = env.FOUNDRY_PROJECT_ENDPOINT?.replace(/\/$/, "");
  if (
    projectEndpoint &&
    !/^https:\/\/[a-zA-Z0-9-]+\.services\.ai\.azure\.com\/api\/projects\/[a-zA-Z0-9_-]+$/.test(
      projectEndpoint,
    )
  ) {
    throw new Error(
      "FOUNDRY_PROJECT_ENDPOINT must be a public Foundry project HTTPS endpoint.",
    );
  }
  const verified = new Set(
    (env.HAIER_VERIFIED_MODELS ?? "").split(",").map((entry) => entry.trim()),
  );
  const secondaryModelId =
    env.HAIER_SECONDARY_MODEL_ID ?? "microsoft-realtime-flash-1";
  if (
    ![
      "microsoft-realtime-flash-1",
      "microsoft-realtime-flash",
      "gpt-realtime-2.1-mini",
    ].includes(secondaryModelId)
  )
    throw new Error(
      "HAIER_SECONDARY_MODEL_ID must be microsoft-realtime-flash-1, microsoft-realtime-flash, or gpt-realtime-2.1-mini.",
    );
  const isFlash = secondaryModelId.startsWith("microsoft-realtime-flash");
  const models: ModelOption[] = [
    {
      id: "gpt-live",
      label: "GPT Live",
      available: false,
      reason:
        "GPT Live is not integrated into this sample. It is not silently mapped to another model.",
    },
    {
      id: "gpt-realtime-2.1",
      label: "GPT Realtime 2.1",
      available: false,
      agentName: nameSchema.parse(env.HAIER_REALTIME_AGENT ?? "home-realtime"),
    },
    {
      id: secondaryModelId,
      label: isFlash ? "Microsoft Realtime Flash" : "GPT Realtime 2.1 Mini",
      available: false,
      agentName: nameSchema.parse(
        isFlash
          ? (env.HAIER_FLASH_AGENT ?? "home-flash")
          : (env.HAIER_MINI_AGENT ?? "home-mini"),
      ),
    },
  ];
  for (const model of models) {
    if (model.id === "gpt-live") continue;
    model.available = Boolean(projectEndpoint && verified.has(model.id));
    if (!model.available)
      model.reason =
        "This managed agent has not passed the opt-in live verification for this project.";
  }
  return { projectEndpoint, tenantId: env.AZURE_TENANT_ID, models };
}

/** Build the browser-safe configuration and truthful connectivity indicator. */
export function demoConfig(
  config: RuntimeConfig,
  home: HomeStore,
  knowledge: KnowledgeStore,
): DemoConfig {
  const configured = Boolean(
    config.projectEndpoint && config.models.some((model) => model.available),
  );
  return {
    models: config.models.map((model) => ({ ...model })),
    home: home.snapshot(),
    knowledge: knowledge.sources(),
    backend: {
      configured,
      mode: "foundry-voice-agent",
      message: configured
        ? "Real managed Foundry Voice Agents; appliance controls and sensor readings are simulated."
        : "Deploy and verify the managed Voice Agents, then configure the local server. No simulated AI fallback.",
    },
  };
}
