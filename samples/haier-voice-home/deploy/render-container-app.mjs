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
const appName = required("HAIER_CONTAINER_APP_NAME");
const environmentId = required("HAIER_CONTAINER_APP_ENVIRONMENT_ID");
const identityId = required("HAIER_MANAGED_IDENTITY_ID");
const registry = required("HAIER_REGISTRY_SERVER");
const image = required("HAIER_IMAGE");
const origin = required("HAIER_PUBLIC_ORIGIN");
const projectEndpoint = required("FOUNDRY_PROJECT_ENDPOINT");
const accessCode = required("HAIER_ACCESS_CODE");
const sessionSecret = required("HAIER_SESSION_SECRET");
const minimum = process.env.HAIER_MIN_REPLICAS ?? "1";
const webRoot = process.env.HAIER_WEB_ROOT ?? "editions/habitat/dist";
if (!["0", "1"].includes(minimum))
  throw new Error("HAIER_MIN_REPLICAS must be 0 or 1.");
if (
  !["dist", "editions/modern/dist", "editions/habitat/dist"].includes(webRoot)
)
  throw new Error("HAIER_WEB_ROOT must select a source-built edition.");
if (!/^[a-z][a-z0-9-]{0,30}[a-z0-9]$/.test(appName))
  throw new Error("HAIER_CONTAINER_APP_NAME must be a valid ACA name.");
for (const [name, id, type] of [
  [
    "HAIER_CONTAINER_APP_ENVIRONMENT_ID",
    environmentId,
    "Microsoft.App/managedEnvironments",
  ],
  [
    "HAIER_MANAGED_IDENTITY_ID",
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
  throw new Error("HAIER_PUBLIC_ORIGIN must be an exact HTTPS origin.");
if (
  !/^https:\/\/[a-zA-Z0-9-]+\.services\.ai\.azure\.com\/api\/projects\/[a-zA-Z0-9_-]+$/.test(
    projectEndpoint,
  )
)
  throw new Error(
    "FOUNDRY_PROJECT_ENDPOINT must be a Foundry project HTTPS endpoint.",
  );
if (!/^[a-zA-Z0-9.-]+$/.test(registry) || !image.startsWith(`${registry}/`))
  throw new Error("HAIER_IMAGE must belong to HAIER_REGISTRY_SERVER.");
if (accessCode.length < 24 || sessionSecret.length < 32)
  throw new Error(
    "Use a new random access code (24+) and independent session secret (32+).",
  );
if (
  process.env.HAIER_PUBLIC_GUEST_ACCESS &&
  process.env.HAIER_PUBLIC_GUEST_ACCESS !== "0"
)
  throw new Error(
    "The deployment renderer deliberately disables public guest access.",
  );
const env = {
  NODE_ENV: "production",
  HOST: "0.0.0.0",
  PORT: "8080",
  HAIER_PUBLIC_ORIGIN: origin,
  HAIER_PUBLIC_GUEST_ACCESS: "0",
  HAIER_DATA_PATH: "/data/sessions",
  HAIER_WEB_ROOT: webRoot,
  FOUNDRY_PROJECT_ENDPOINT: projectEndpoint,
  HAIER_REALTIME_AGENT: required("HAIER_REALTIME_AGENT"),
  HAIER_MINI_AGENT: required("HAIER_MINI_AGENT"),
  HAIER_SECONDARY_MODEL_ID: "gpt-realtime-2.1-mini",
  HAIER_VERIFIED_MODELS: required("HAIER_VERIFIED_MODELS"),
  AZURE_CLIENT_ID: required("AZURE_CLIENT_ID"),
};
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
            { name: "HAIER_ACCESS_CODE", secretRef: "access-code" },
            { name: "HAIER_SESSION_SECRET", secretRef: "session-secret" },
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
          storageName: required("HAIER_ENVIRONMENT_STORAGE"),
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
