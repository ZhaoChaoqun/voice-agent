# Optional Azure Container Apps deployment

## Conclusion

This directory provides source-built Docker images and an **offline** manifest
renderer for the complete smart-home application. It has no default Azure
resources, does not automatically provision infrastructure or roles, and does
not publish the Voice Agent. The separate WebRTC lab helper has its own explicit
apply guard and a different security boundary.

These are optional operator-run instructions. Review the build and deployment
inputs and validate your target environment before applying any Azure changes.

## Prerequisites

Use your own subscription, region, resource group, ACA managed environment,
ACR, user-assigned managed identity, Foundry project, and Azure Files storage
already registered in the ACA environment. Confirm support for Flash
(`microsoft-realtime-flash-1`) and the [speech profile](../agents/README.md).
Comparison models are not deployment prerequisites.

First run the [local application](../README.md) and validate your Agent.
Use a distinct application/storage boundary for each demonstration; do not
overwrite another application's resources. Infrastructure provisioning,
resource deletion, and cross-region operations are not supplied here.

| Identity                           | Scope                        | Required capability                                  |
| ---------------------------------- | ---------------------------- | ---------------------------------------------------- |
| Image builder/publisher            | Your registry                | Push the source-built image.                         |
| ACA user-assigned managed identity | The same registry            | `AcrPull`.                                           |
| Runtime identity                   | The selected Foundry project | Project consumption, such as Foundry Agent Consumer. |
| Agent operator                     | The selected Foundry project | Creation/update, such as Foundry Agent Developer.    |

Use actual role definitions and service guidance. Runtime does not need Agent
creation, RBAC modification, API-key retrieval, or subscription Owner.
Manage Azure Files credentials in the ACA environment's storage binding, not
source, image layers, or ordinary application environment variables.

## Build from source

Use `samples/example37_smart_home_appliance_agent/` as Docker build context:

```bash
docker build -f deploy/Dockerfile -t "<your-registry>/voice-home:<your-tag>" .
```

The Dockerfile installs locked dependencies and builds Classic, Modern, then
Habitat. Production Node runs as the non-root `node` user. Build exclusions
omit `.env*`, `.azure`, `.local`, uploads, test results, and certificates.
The default UI is Habitat; `SMART_HOME_WEB_ROOT` may select another built
edition. The image does not run a Vite development server.
Push the resulting image to your own registry using your approved process.

## Configure and render offline

Replace all placeholders with your own values. Put these in the ignored
sample-root `.env`, or inject them into the renderer process. Do not print or
commit populated secrets:

```dotenv
AZURE_SUBSCRIPTION_ID=<your-subscription-id>
AZURE_LOCATION=<your-region>
SMART_HOME_CONTAINER_APP_NAME=<your-app-name>
SMART_HOME_CONTAINER_APP_ENVIRONMENT_ID=/subscriptions/<subscription>/resourceGroups/<group>/providers/Microsoft.App/managedEnvironments/<environment>
SMART_HOME_MANAGED_IDENTITY_ID=/subscriptions/<subscription>/resourceGroups/<group>/providers/Microsoft.ManagedIdentity/userAssignedIdentities/<identity>
AZURE_CLIENT_ID=<your-identity-client-id>
SMART_HOME_REGISTRY_SERVER=<your-registry>.azurecr.io
SMART_HOME_IMAGE=<your-registry>.azurecr.io/voice-home:<your-tag>
SMART_HOME_PUBLIC_ORIGIN=https://<your-app-fqdn>
FOUNDRY_PROJECT_ENDPOINT=https://<resource>.services.ai.azure.com/api/projects/<project>
SMART_HOME_FLASH_AGENT=<your-flash-agent>
SMART_HOME_VERIFIED_MODELS=microsoft-realtime-flash-1
SMART_HOME_ENVIRONMENT_STORAGE=<your-environment-storage-binding-name>
SMART_HOME_ACCESS_CODE=<new-random-value-at-least-24-characters>
SMART_HOME_SESSION_SECRET=<different-new-random-value-at-least-32-characters>
SMART_HOME_PUBLIC_GUEST_ACCESS=0
SMART_HOME_WEB_ROOT=editions/habitat/dist
SMART_HOME_MIN_REPLICAS=1
```

To enable the optional GPT Realtime comparison in the deployed UI, also set
`SMART_HOME_REALTIME_AGENT` and include `gpt-realtime-2.1` in
`SMART_HOME_VERIFIED_MODELS`. The renderer requires that explicit Agent name
when the comparison model is enabled.

Generate independent high-entropy access/signing values; do not use placeholders,
shared passwords, defaults, or test fixtures. `SMART_HOME_PUBLIC_ORIGIN` must be
the final exact HTTPS origin, without path, trailing slash, or wildcard.
Obtain or reserve the hostname through your infrastructure process first;
do not expose an unprotected instance just to discover it.

From the sample root:

```bash
node deploy/render-container-app.mjs
```

The renderer validates required fields, resource subscription alignment, image
registry, HTTPS origin, secret lengths, and edition. It writes
`.local/container-app.json` with file mode `0600` and creates the directory with
mode `0700`. The file contains **plaintext secrets** and is private deployment
input, not publishable documentation. Filesystem permissions do not replace
backup/deletion controls. Rendering prints no secrets, does not call `az`, and
has no implicit `--deploy` path.

After reviewing the manifest, an authorized operator may explicitly apply it:

```bash
# This creates/updates Azure state; confirm your subscription and group first.
az containerapp create \
  --subscription "<your-subscription-id>" \
  --resource-group "<your-resource-group>" \
  --yaml .local/container-app.json
```

JSON is a YAML subset; an approved IaC workflow may consume the same definition.
Use your own existing-app update strategy rather than assuming `create` replaces
every lifecycle operation. Verify the resulting FQDN matches the configured
origin, identity and storage permissions, the saved Flash Agent, greeting,
pre-control acknowledgement, actual-result completion, audio/barge-in, and
two-browser household isolation. `/api/health` proves process liveness, not
Foundry connectivity or full readiness.

## Replicas, persistence, and access

The full demo defaults to **`SMART_HOME_MIN_REPLICAS=1`** to avoid
scale-to-zero cold starts. Only `0` or `1` are accepted; explicit `0` reduces
idle cost but adds cold starts. Maximum replicas stay **one**, because
HomeStore/KnowledgeStore JSON files are not distributed transactional storage.
Before scaling, replace them with an appropriate database and tenant/transaction
model.

Mount the configured environment storage at `/data` with write access for
`node`. Signed browser sessions isolate household JSON and uploads; redeploys
should preserve mounted data. Expired session files are not automatically
deleted. Define retention and cleanup. Signing-secret rotation invalidates
cookies and affects users.

The renderer requires access-code protection and rejects
`SMART_HOME_PUBLIC_GUEST_ACCESS=1`. Source-level guest mode remains an explicit
evaluation option, **not authentication**: anyone with the URL can create a
household, consume paid AI capacity, and upload content. Signed cookies provide
integrity/isolation, not identity, rate limiting, or billing protection.
Public operation requires external identity or abuse protection, concurrency
and request limits, budgets, monitoring, audit, and data governance.

## Separate model-mode WebRTC lab

`Dockerfile.webrtc` and `deploy-webrtc.mjs` are only for a separate, tool-free
Voice Live **model-mode** latency experiment. They do not deploy the household
Voice Agent or connect Agent-mode WebRTC to the UIs. The lab has no access code
or end-user login; do not leave its externally exposed routes unprotected.

The helper requires your own settings, for example:

```dotenv
AZURE_SUBSCRIPTION_ID=<your-subscription-id>
AZURE_TENANT_ID=<your-tenant-id>
SMART_HOME_WEBRTC_RESOURCE_GROUP=<your-resource-group>
SMART_HOME_WEBRTC_ENVIRONMENT_NAME=<your-existing-environment>
SMART_HOME_WEBRTC_REGISTRY_NAME=<your-existing-registry-name>
SMART_HOME_WEBRTC_IDENTITY_NAME=<your-existing-identity-name>
SMART_HOME_WEBRTC_LOCATION=<your-region>
SMART_HOME_WEBRTC_ENDPOINT=https://<resource>.services.ai.azure.com
SMART_HOME_WEBRTC_SECONDARY_MODEL_ID=microsoft-realtime-flash-1
SMART_HOME_WEBRTC_SECONDARY_APP=<your-lab-app-name>
SMART_HOME_WEBRTC_MIN_REPLICAS=0
```

Only `microsoft-realtime-flash-1` and `gpt-realtime-2.1` are accepted by the lab
and its deployment helper. The lab defaults to Flash and
`SMART_HOME_WEBRTC_MIN_REPLICAS=0` (unlike the
full application's default `1`); maximum replicas remain one. Optional
`SMART_HOME_WEBRTC_PRIMARY_APP` and `SMART_HOME_WEBRTC_PRIMARY_MODEL_ID` add
a distinct comparison app/model. Model support must be checked in the target
resource. `SMART_HOME_WEBRTC_IMAGE_TAG` selects a tag, and
`SMART_HOME_WEBRTC_DEPLOY_STATE` selects the private state-file path.

```bash
# Default: offline rendering only, no Azure calls.
node deploy/deploy-webrtc.mjs
```

This writes `.local/webrtc-manifests.json` by default. Offline placeholder
identity context is not proof of a usable managed identity. Only an explicit
`--apply --confirm-endpoint` matching the configured resource endpoint invokes
Azure CLI operations:

```bash
# Optional and state-changing: only in an authorized, protected test environment.
export SMART_HOME_WEBRTC_ENDPOINT="https://<resource>.services.ai.azure.com"
node deploy/deploy-webrtc.mjs --apply --confirm-endpoint "$SMART_HOME_WEBRTC_ENDPOINT"
```

The apply path reads existing environment/identity/registry, builds unless
explicitly skipped, applies app manifests, and waits for revision readiness.
It is not an offline check and does not supply missing infrastructure or
end-user protection. `/api/sessions` disables tools and does not connect a
Foundry Voice Agent. Use `Dockerfile` plus `render-container-app.mjs` for the
complete application, not this lab.
