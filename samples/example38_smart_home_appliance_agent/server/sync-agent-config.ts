/** Render offline by default; publish only to an explicitly confirmed project. */
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { AzureCliCredential } from "@azure/identity";
import { z } from "zod";
import { voiceAgentDefinition } from "#server/agent-config";
import { runtimeConfig } from "#server/config";
import { homeInstructions } from "#server/instructions";
import { tools } from "#server/tools";

const API_VERSION = "2025-11-15-preview";
const names = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,80}$/);
const versionSchema = z.object({
  version: z.string().min(1),
  status: z.string(),
  definition: z.record(z.string(), z.unknown()),
});
type Version = z.infer<typeof versionSchema>;
type Edition = "flash" | "realtime";
export type AuthoringRequest = (
  path: string,
  body?: object,
) => Promise<unknown>;

/** Expand the two supported templates without contacting the service. */
export function agentDefinitions(): Record<Edition, Record<string, unknown>> {
  const render = (edition: Edition): Record<string, unknown> =>
    voiceAgentDefinition(
      JSON.parse(
        readFileSync(
          new URL(`../agents/${edition}.json`, import.meta.url),
          "utf8",
        ),
      ),
      { instructions: homeInstructions(), tools },
    );
  return { flash: render("flash"), realtime: render("realtime") };
}

/** Select Flash by default or the explicitly requested Realtime comparison. */
export function publishSettings(
  env: NodeJS.ProcessEnv,
  confirmation: string | undefined,
  comparison = false,
): {
  endpoint: string;
  agents: { edition: Edition; name: string }[];
} {
  const endpoint = runtimeConfig(env).projectEndpoint;
  if (!endpoint || endpoint !== confirmation)
    throw new Error(
      "Publishing requires FOUNDRY_PROJECT_ENDPOINT and --confirm-project with the same exact HTTPS project URL.",
    );
  const editions: Edition[] = comparison ? ["realtime"] : ["flash"];
  const agents = editions.map((edition) => ({
    edition,
    name: names.parse(env[`SMART_HOME_${edition.toUpperCase()}_AGENT`]),
  }));
  if (
    /placeholder|replace|example/i.test(
      `${endpoint} ${agents.map((agent) => agent.name).join(" ")}`,
    )
  )
    throw new Error("Replace the example placeholders before publishing.");
  return { endpoint, agents };
}

function assertSaved(
  expected: unknown,
  actual: unknown,
  path = "definition",
): void {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length)
      throw new Error(`Saved configuration differs at ${path}.length`);
    expected.forEach((value, index) =>
      assertSaved(value, actual[index], `${path}[${index}]`),
    );
  } else if (expected !== null && typeof expected === "object") {
    if (actual === null || typeof actual !== "object")
      throw new Error(`Missing saved configuration at ${path}`);
    for (const [key, value] of Object.entries(expected))
      assertSaved(value, Reflect.get(actual, key), `${path}.${key}`);
  } else if (!isDeepStrictEqual(expected, actual)) {
    throw new Error(`Saved configuration differs at ${path}`);
  }
}

async function latest(
  request: AuthoringRequest,
  name: string,
): Promise<Version | undefined> {
  const result = await request(`/agents/${encodeURIComponent(name)}`);
  if (result === undefined) return undefined;
  return z
    .object({ versions: z.object({ latest: versionSchema }) })
    .parse(result).versions.latest;
}

export async function publishAgent(
  request: AuthoringRequest,
  name: string,
  template: Record<string, unknown>,
): Promise<void> {
  const base = await latest(request, name);
  if (
    base &&
    (base.definition.kind !== "voice" ||
      base.definition.model !== template.model ||
      base.definition.model_type !== template.model_type)
  )
    throw new Error(
      `Refusing to change an existing Agent's kind or model: ${name}`,
    );
  const definition = base
    ? voiceAgentDefinition(base.definition, {
        instructions: homeInstructions(),
        tools,
      })
    : template;
  if (base && (await latest(request, name))?.version !== base.version)
    throw new Error(`Agent changed concurrently: ${name}`);
  const created = versionSchema.parse(
    await request(`/agents/${encodeURIComponent(name)}/versions`, {
      definition,
    }),
  );
  const saved = await latest(request, name);
  if (
    !saved ||
    saved.status !== "active" ||
    saved.version !== created.version ||
    saved.version === base?.version
  )
    throw new Error(`New Agent version did not become active: ${name}`);
  assertSaved(definition, saved.definition);
  console.info("Published and read back the complete Agent definition", {
    name,
    version: saved.version,
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const publish = args.includes("--publish");
  const confirmation = args[args.indexOf("--confirm-project") + 1];
  if (
    args.some(
      (arg, index) =>
        arg !== "--publish" &&
        arg !== "--comparison" &&
        arg !== "--confirm-project" &&
        args[index - 1] !== "--confirm-project",
    )
  )
    throw new Error(
      "Supported options: --publish [--comparison] --confirm-project <project-url>",
    );
  const definitions = agentDefinitions();
  if (!publish) {
    const directory = new URL("../.local/", import.meta.url);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(
      new URL("agent-definitions.json", directory),
      `${JSON.stringify(definitions, null, 2)}\n`,
      { mode: 0o600 },
    );
    console.info(
      "Rendered .local/agent-definitions.json; no Azure requests made.",
    );
    return;
  }
  const settings = publishSettings(
    process.env,
    confirmation,
    args.includes("--comparison"),
  );
  const credential = new AzureCliCredential(
    process.env.AZURE_TENANT_ID
      ? { tenantId: process.env.AZURE_TENANT_ID }
      : {},
  );
  const request: AuthoringRequest = async (path, body) => {
    const token = await credential.getToken("https://ai.azure.com/.default");
    const response = await fetch(
      `${settings.endpoint}${path}?api-version=${API_VERSION}`,
      {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${token.token}`,
          "Content-Type": "application/json",
          "Foundry-Features": "VoiceAgents=V1Preview",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (!body && response.status === 404) return undefined;
    if (!response.ok)
      throw new Error(
        `Foundry authoring request failed: HTTP ${response.status}`,
      );
    return response.json();
  };
  for (const agent of settings.agents)
    await publishAgent(request, agent.name, definitions[agent.edition]!);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
