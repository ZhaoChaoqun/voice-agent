/** Parameterized regional WebRTC latency-lab deployment helper; fail-closed and offline by default. */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const ALLOWED_MODELS = new Set([
  "microsoft-realtime-flash-1",
  "microsoft-realtime-flash",
  "gpt-realtime-2.1",
  "gpt-realtime-2.1-mini",
]);
const appNamePattern = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value || /REPLACE_|<|>/.test(value))
    throw new Error(`${name} must be explicitly configured.`);
  return value;
}

const subscription = required("AZURE_SUBSCRIPTION_ID");
const tenant = required("AZURE_TENANT_ID");
const group = required("SMART_HOME_WEBRTC_RESOURCE_GROUP");
const environmentName = required("SMART_HOME_WEBRTC_ENVIRONMENT_NAME");
const registry = required("SMART_HOME_WEBRTC_REGISTRY_NAME");
const identityName = required("SMART_HOME_WEBRTC_IDENTITY_NAME");
const endpoint = required("SMART_HOME_WEBRTC_ENDPOINT").replace(/\/$/, "");
const location = required("SMART_HOME_WEBRTC_LOCATION");
const secondaryModel =
  process.env.SMART_HOME_WEBRTC_SECONDARY_MODEL_ID ??
  "microsoft-realtime-flash-1";
const secondaryApp =
  process.env.SMART_HOME_WEBRTC_SECONDARY_APP ?? "voice-webrtc-flash";
const primaryApp = process.env.SMART_HOME_WEBRTC_PRIMARY_APP?.trim();
const primaryModel =
  process.env.SMART_HOME_WEBRTC_PRIMARY_MODEL_ID ?? "gpt-realtime-2.1";
const minReplicasRaw = process.env.SMART_HOME_WEBRTC_MIN_REPLICAS ?? "0";
if (!["0", "1"].includes(minReplicasRaw))
  throw new Error("SMART_HOME_WEBRTC_MIN_REPLICAS must be 0 or 1.");
const minReplicas = Number(minReplicasRaw);
if (!/^https:\/\/[a-zA-Z0-9-]+\.services\.ai\.azure\.com$/.test(endpoint))
  throw new Error(
    "SMART_HOME_WEBRTC_ENDPOINT must be an Azure AI Services HTTPS origin.",
  );
if (!ALLOWED_MODELS.has(secondaryModel))
  throw new Error(
    "SMART_HOME_WEBRTC_SECONDARY_MODEL_ID is not an approved model.",
  );
if (!appNamePattern.test(secondaryApp))
  throw new Error("SMART_HOME_WEBRTC_SECONDARY_APP must be a valid ACA name.");

const variants = [];
if (primaryApp) {
  if (!appNamePattern.test(primaryApp) || primaryApp === secondaryApp)
    throw new Error(
      "SMART_HOME_WEBRTC_PRIMARY_APP must be a distinct valid ACA name.",
    );
  if (!ALLOWED_MODELS.has(primaryModel))
    throw new Error(
      "SMART_HOME_WEBRTC_PRIMARY_MODEL_ID is not an approved model.",
    );
  variants.push({ app: primaryApp, model: primaryModel });
}
variants.push({ app: secondaryApp, model: secondaryModel });

const statePath = resolve(
  process.env.SMART_HOME_WEBRTC_DEPLOY_STATE ?? ".local/webrtc-deployment.json",
);
const sampleRoot = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const confirmed = args[args.indexOf("--confirm-endpoint") + 1];
if (
  args.some(
    (arg, index) =>
      arg !== "--apply" &&
      arg !== "--confirm-endpoint" &&
      args[index - 1] !== "--confirm-endpoint",
  )
)
  throw new Error(
    "Supported options: [--apply --confirm-endpoint <voice-live-endpoint>]",
  );

function manifest(variant, context) {
  return {
    name: variant.app,
    type: "Microsoft.App/containerApps",
    location,
    tags: {
      purpose: "webrtc-latency-lab",
    },
    identity: {
      type: "UserAssigned",
      userAssignedIdentities: { [context.identity.id]: {} },
    },
    properties: {
      managedEnvironmentId: context.environment.id,
      workloadProfileName: "Consumption",
      configuration: {
        activeRevisionsMode: "Single",
        ingress: {
          external: true,
          targetPort: 8080,
          transport: "auto",
          allowInsecure: false,
        },
        registries: [
          { server: context.acr.loginServer, identity: context.identity.id },
        ],
      },
      template: {
        containers: [
          {
            name: "web",
            image: context.image,
            resources: { cpu: 0.5, memory: "1Gi" },
            env: [
              { name: "NODE_ENV", value: "production" },
              { name: "HOST", value: "0.0.0.0" },
              { name: "PORT", value: "8080" },
              { name: "VOICE_LIVE_ENDPOINT", value: endpoint },
              { name: "WEBRTC_MODEL", value: variant.model },
              { name: "AZURE_CLIENT_ID", value: context.identity.clientId },
              { name: "AZURE_TENANT_ID", value: tenant },
            ],
            probes: [
              {
                type: "Startup",
                httpGet: { path: "/api/health", port: 8080 },
                initialDelaySeconds: 3,
                periodSeconds: 5,
                failureThreshold: 30,
              },
              {
                type: "Readiness",
                httpGet: { path: "/api/health", port: 8080 },
                periodSeconds: 10,
                failureThreshold: 3,
              },
            ],
          },
        ],
        scale: {
          minReplicas,
          maxReplicas: 1,
          rules: [
            { name: "http", http: { metadata: { concurrentRequests: "10" } } },
          ],
        },
      },
    },
  };
}

if (!apply) {
  const tag = process.env.SMART_HOME_WEBRTC_IMAGE_TAG ?? "preview";
  const previewContext = {
    environment: {
      id: `/subscriptions/${subscription}/resourceGroups/${group}/providers/Microsoft.App/managedEnvironments/${environmentName}`,
    },
    identity: {
      id: `/subscriptions/${subscription}/resourceGroups/${group}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${identityName}`,
      clientId: process.env.AZURE_CLIENT_ID ?? "offline-preview-client-id",
    },
    acr: { loginServer: `${registry}.azurecr.io` },
    image: `${registry}.azurecr.io/voice-webrtc:${tag}`,
  };
  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
  const outputPath = resolve(dirname(statePath), "webrtc-manifests.json");
  writeFileSync(
    outputPath,
    `${JSON.stringify(
      variants.map((variant) => manifest(variant, previewContext)),
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  console.info(
    `Rendered ${outputPath}; pass --apply --confirm-endpoint <url> to deploy.`,
  );
  process.exit(0);
}

if (confirmed?.replace(/\/$/, "") !== endpoint)
  throw new Error(
    "Applying deployment requires --confirm-endpoint matching SMART_HOME_WEBRTC_ENDPOINT.",
  );

function az(commandArgs, { json = true } = {}) {
  const output = execFileSync(
    "az",
    [
      ...commandArgs,
      "--subscription",
      subscription,
      "--only-show-errors",
      "-o",
      json ? "json" : "none",
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  return json && output.trim() ? JSON.parse(output) : undefined;
}

async function waitReady(name, image) {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const app = az(["containerapp", "show", "-g", group, "-n", name]);
    const properties = app.properties;
    if (properties.provisioningState === "Failed")
      throw new Error(`ACA deployment failed: ${name}`);
    if (
      properties.provisioningState === "Succeeded" &&
      properties.template.containers[0].image === image &&
      properties.latestRevisionName === properties.latestReadyRevisionName
    )
      return app;
    await delay(15_000);
  }
  throw new Error(`ACA readiness timed out: ${name}`);
}

const environment = az([
  "containerapp",
  "env",
  "show",
  "-g",
  group,
  "-n",
  environmentName,
]);
const identity = az(["identity", "show", "-g", group, "-n", identityName]);
const acr = az(["acr", "show", "-g", group, "-n", registry]);
const tag =
  process.env.SMART_HOME_WEBRTC_IMAGE_TAG ??
  new Date().toISOString().replaceAll(/[-:.]/g, "").slice(0, 15);
if (!process.env.SMART_HOME_WEBRTC_SKIP_BUILD) {
  az([
    "acr",
    "build",
    "-r",
    registry,
    "-g",
    group,
    "--platform",
    "linux/amd64",
    "--image",
    `voice-webrtc:${tag}`,
    "--file",
    resolve(sampleRoot, "deploy/Dockerfile.webrtc"),
    "--no-logs",
    sampleRoot,
  ]);
}
const image = `${acr.loginServer}/voice-webrtc:${tag}`;
const context = { environment, identity, acr, image };
const state = { image, apps: {} };
mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
for (const variant of variants) {
  const manifestPath = resolve(
    dirname(statePath),
    `${variant.app}.private.json`,
  );
  writeFileSync(manifestPath, JSON.stringify(manifest(variant, context)), {
    mode: 0o600,
  });
  try {
    az(
      [
        "containerapp",
        "create",
        "-g",
        group,
        "-n",
        variant.app,
        "--yaml",
        manifestPath,
        "--no-wait",
      ],
      { json: false },
    );
  } finally {
    unlinkSync(manifestPath);
  }
  const app = await waitReady(variant.app, image);
  const url = `https://${app.properties.configuration.ingress.fqdn}`;
  state.apps[variant.app] = { model: variant.model, url };
  console.info(`${variant.app}: ${url}`);
}
writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
