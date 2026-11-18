/** Server-only Foundry configuration; no credential is returned to the browser. */
import type { DemoConfig, ModelOption } from "@shared/protocol";
import { GPT_LIVE_MODEL_ID, SUPPORTED_MODEL_IDS } from "@shared/protocol";
import { z } from "zod";
import { HomeStore } from "#server/home";
import { KnowledgeStore } from "#server/knowledge";

const nameSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,80}$/);
const PROJECT_ENDPOINT_PATTERN =
  /^https:\/\/[a-zA-Z0-9-]+\.services\.ai\.azure\.com\/api\/projects\/[a-zA-Z0-9_-]+$/;

export interface RuntimeConfig {
  projectEndpoint?: string;
  /** Project that hosts the GPT Live Agent; defaults to projectEndpoint. */
  liveProjectEndpoint?: string;
  tenantId?: string;
  models: ModelOption[];
}

function projectEndpointSetting(
  env: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const endpoint = env[name]?.replace(/\/$/, "");
  if (endpoint && !PROJECT_ENDPOINT_PATTERN.test(endpoint))
    throw new Error(`${name} must be a public Foundry project HTTPS endpoint.`);
  return endpoint || undefined;
}

/** Accept only Foundry project URLs; clients cannot choose an upstream endpoint. */
export function runtimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const projectEndpoint = projectEndpointSetting(
    env,
    "FOUNDRY_PROJECT_ENDPOINT",
  );
  const liveProjectEndpoint =
    projectEndpointSetting(env, "SMART_HOME_GPT_LIVE_PROJECT_ENDPOINT") ??
    projectEndpoint;
  const verifiedIds = (env.SMART_HOME_VERIFIED_MODELS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const verifiedModels = z
    .array(z.enum(SUPPORTED_MODEL_IDS))
    .safeParse(verifiedIds);
  if (!verifiedModels.success)
    throw new Error(
      `SMART_HOME_VERIFIED_MODELS must contain only ${SUPPORTED_MODEL_IDS.join(", ")}.`,
    );
  const verified = new Set<string>(verifiedModels.data);
  const models: ModelOption[] = [
    {
      id: "gpt-realtime-2.1",
      label: "GPT Realtime 2.1",
      available: false,
      agentName: nameSchema.parse(
        env.SMART_HOME_REALTIME_AGENT ?? "home-realtime",
      ),
    },
    {
      id: "microsoft-realtime-flash-1",
      label: "Microsoft Realtime Flash",
      available: false,
      agentName: nameSchema.parse(env.SMART_HOME_FLASH_AGENT ?? "home-flash"),
    },
  ];
  for (const model of models) {
    model.available = Boolean(projectEndpoint && verified.has(model.id));
    if (!model.available)
      model.reason =
        "This managed agent has not passed the opt-in live verification for this project.";
  }
  models.push(gptLiveOption(env, liveProjectEndpoint, verified));
  return {
    projectEndpoint,
    liveProjectEndpoint,
    tenantId: env.AZURE_TENANT_ID,
    models,
  };
}

/** GPT Live has no default Agent name; every prerequisite must be explicit. */
function gptLiveOption(
  env: NodeJS.ProcessEnv,
  endpoint: string | undefined,
  verified: Set<string>,
): ModelOption {
  const agentName = env.SMART_HOME_GPT_LIVE_AGENT
    ? nameSchema.parse(env.SMART_HOME_GPT_LIVE_AGENT)
    : undefined;
  const available = Boolean(
    endpoint && agentName && verified.has(GPT_LIVE_MODEL_ID),
  );
  return {
    id: GPT_LIVE_MODEL_ID,
    label: "GPT Live",
    available,
    agentName,
    ...(available
      ? {}
      : {
          reason:
            "GPT Live needs a Foundry project endpoint, SMART_HOME_GPT_LIVE_AGENT and opt-in live verification of your own gpt-live-1 Agent.",
        }),
  };
}

/** Build the browser-safe configuration and truthful connectivity indicator. */
export function demoConfig(
  config: RuntimeConfig,
  home: HomeStore,
  knowledge: KnowledgeStore,
): DemoConfig {
  // Availability already requires the endpoint that serves each model.
  const configured = config.models.some((model) => model.available);
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
