/** Render private ACA input only. This command never contacts Azure. */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value || /REPLACE_|<|>/.test(value))
    throw new Error(`${name} must be explicitly configured.`);
  return value;
}

const subscription = required("AZURE_SUBSCRIPTION_ID");
const location = required("AZURE_LOCATION");
const appName = required("SMART_HOME_CONTAINER_APP_NAME");
const environmentId = required("SMART_HOME_CONTAINER_APP_ENVIRONMENT_ID");
const identityId = required("SMART_HOME_MANAGED_IDENTITY_ID");
const registry = required("SMART_HOME_REGISTRY_SERVER");
const image = required("SMART_HOME_IMAGE");
const origin = required("SMART_HOME_PUBLIC_ORIGIN");
const projectEndpoint = required("FOUNDRY_PROJECT_ENDPOINT");
const accessCode = required("SMART_HOME_ACCESS_CODE");
const sessionSecret = required("SMART_HOME_SESSION_SECRET");
const verifiedModels = required("SMART_HOME_VERIFIED_MODELS");
if (
  verifiedModels
    .split(",")
    .some(
      (model) =>
        !["microsoft-realtime-flash-1", "gpt-realtime-2.1"].includes(
          model.trim(),
        ),
    )
)
  throw new Error(
    "SMART_HOME_VERIFIED_MODELS must contain only microsoft-realtime-flash-1, gpt-realtime-2.1.",
  );
const minimum = process.env.SMART_HOME_MIN_REPLICAS ?? "1";
const webRoot = process.env.SMART_HOME_WEB_ROOT ?? "editions/habitat/dist";
if (!["0", "1"].includes(minimum))
  throw new Error("SMART_HOME_MIN_REPLICAS must be 0 or 1.");
if (
  !["dist", "editions/modern/dist", "editions/habitat/dist"].includes(webRoot)
)
  throw new Error("SMART_HOME_WEB_ROOT must select a source-built edition.");
if (!/^[a-z][a-z0-9-]{0,30}[a-z0-9]$/.test(appName))
  throw new Error("SMART_HOME_CONTAINER_APP_NAME must be a valid ACA name.");
for (const [name, id, type] of [
  [
    "SMART_HOME_CONTAINER_APP_ENVIRONMENT_ID",
    environmentId,
    "Microsoft.App/managedEnvironments",
  ],
  [
    "SMART_HOME_MANAGED_IDENTITY_ID",
    identityId,
    "Microsoft.ManagedIdentity/userAssignedIdentities",
  ],
]) {
  if (
    !id.startsWith(`/subscriptions/${subscription}/resourceGroups/`) ||
    !id.includes(`/providers/${type}/`)
  )
    throw new Error(`${name} must belong to AZURE_SUBSCRIPTION_ID.`);
}
const url = new URL(origin);
if (
  url.protocol !== "https:" ||
  url.origin !== origin ||
  url.username ||
  url.password
)
  throw new Error("SMART_HOME_PUBLIC_ORIGIN must be an exact HTTPS origin.");
if (
  !/^https:\/\/[a-zA-Z0-9-]+\.services\.ai\.azure\.com\/api\/projects\/[a-zA-Z0-9_-]+$/.test(
    projectEndpoint,
  )
)
  throw new Error(
    "FOUNDRY_PROJECT_ENDPOINT must be a Foundry project HTTPS endpoint.",
  );
if (!/^[a-zA-Z0-9.-]+$/.test(registry) || !image.startsWith(`${registry}/`))
  throw new Error(
    "SMART_HOME_IMAGE must belong to SMART_HOME_REGISTRY_SERVER.",
  );
if (accessCode.length < 24 || sessionSecret.length < 32)
  throw new Error(
    "Use a new random access code (24+) and independent session secret (32+).",
  );
if (
  process.env.SMART_HOME_PUBLIC_GUEST_ACCESS &&
  process.env.SMART_HOME_PUBLIC_GUEST_ACCESS !== "0"
)
  throw new Error(
    "The deployment renderer deliberately disables public guest access.",
  );
const env = {
  NODE_ENV: "production",
  HOST: "0.0.0.0",
  PORT: "8080",
  SMART_HOME_PUBLIC_ORIGIN: origin,
  SMART_HOME_PUBLIC_GUEST_ACCESS: "0",
  SMART_HOME_DATA_PATH: "/data/sessions",
  SMART_HOME_WEB_ROOT: webRoot,
  FOUNDRY_PROJECT_ENDPOINT: projectEndpoint,
  SMART_HOME_FLASH_AGENT: required("SMART_HOME_FLASH_AGENT"),
  SMART_HOME_VERIFIED_MODELS: verifiedModels,
  AZURE_CLIENT_ID: required("AZURE_CLIENT_ID"),
};
if (
  verifiedModels.split(",").some((model) => model.trim() === "gpt-realtime-2.1")
)
  env.SMART_HOME_REALTIME_AGENT = required("SMART_HOME_REALTIME_AGENT");
const manifest = {
  name: appName,
  type: "Microsoft.App/containerApps",
  location,
  identity: {
    type: "UserAssigned",
    userAssignedIdentities: { [identityId]: {} },
  },
  properties: {
    managedEnvironmentId: environmentId,
    configuration: {
      activeRevisionsMode: "Single",
      ingress: {
        external: true,
        targetPort: 8080,
        transport: "auto",
        allowInsecure: false,
      },
      registries: [{ server: registry, identity: identityId }],
      secrets: [
        { name: "access-code", value: accessCode },
        { name: "session-secret", value: sessionSecret },
      ],
    },
    template: {
      containers: [
        {
          name: "web",
          image,
          resources: { cpu: 0.5, memory: "1Gi" },
          env: [
            ...Object.entries(env).map(([name, value]) => ({ name, value })),
            { name: "SMART_HOME_ACCESS_CODE", secretRef: "access-code" },
            { name: "SMART_HOME_SESSION_SECRET", secretRef: "session-secret" },
          ],
          volumeMounts: [{ volumeName: "data", mountPath: "/data" }],
          probes: ["Startup", "Readiness", "Liveness"].map((type) => ({
            type,
            httpGet: { path: "/api/health", port: 8080 },
            initialDelaySeconds: 5,
            periodSeconds: 10,
            failureThreshold: 10,
          })),
        },
      ],
      volumes: [
        {
          name: "data",
          storageType: "AzureFile",
          storageName: required("SMART_HOME_ENVIRONMENT_STORAGE"),
        },
      ],
      scale: { minReplicas: Number(minimum), maxReplicas: 1 },
    },
  },
};
const output = resolve(".local/container-app.json");
mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, {
  mode: 0o600,
});
console.info(
  "Rendered .local/container-app.json (contains secrets); no Azure requests made.",
);
