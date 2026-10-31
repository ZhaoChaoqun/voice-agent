# Voice Agent sample debug system map

## Read this when

Use this reference for Project, model deployment, Agent publication,
RemoteTool connection, MCP deployment, portal, or cross-layer failures.

## Runtime topology

This reference covers the local Voice Agent Portal and the separate
customer-owned MCP path used by CLI samples.

```text
browser
  |
  | localhost / forwarded portal port
  v
Portal Python server
  |-- Azure identity: lists Projects and publishes Agent versions
  |-- Voice WebSocket proxy + session recorder
  |
  v
selected Foundry Project
  |-- immutable Voice Agent version
  |     |-- model_type + model deployment
  |     |-- MCP server_url
  |     +-- no project_connection_id
  |
  +--> public no-auth MCP configured by portal/templates.config.json

CLI sample
  |
  v
selected Foundry Project
  +-- immutable Voice Agent version with project_connection_id
  +-- RemoteTool connection
        -> native Python :18003 + named Dev Tunnel
        or customer Container App
        -> shared_mcp reference implementation
```

The default Portal path has no MCP token or Project connection. In the CLI
path, Foundry invokes MCP using the credential stored in the customer Project
connection; the CLI never receives the token.
Local MCP hosting and Dev Tunnel are optional developer choices. Neither
`setup-local-examples.sh` nor local MCP E2E is part of default Portal startup
or publication. Reusing an already deployed MCP also needs no tunnel.

## Project and Agent ownership

The repository does not hardcode one customer Project. Resolve the actual
Project from:

1. `meta.json` `backend` and `upstream` for an existing session;
2. the Project selected in the portal;
3. `AZURE_AI_PROJECT_ENDPOINT` in each sample and
   `AZURE_VOICE_AGENTS_ENDPOINT` in portal `.env`.

The sample `.env` files may target the same Project used by the UI, but their
customer-owned MCP connections are independent. The Portal may switch Projects,
but it does not create or update a Project connection for its public no-auth
MCP.

Agent publication is immutable:

- Example 1 Realtime source: `samples/example1_finance_with_handoff_realtime/agent.json`
- Example 1 Cascade source: `samples/example1_finance_with_handoff_cascade/agent.json`
- Example 2 source:
  `samples/example2_finance_with_OTP_and_Officer_Search/agent.json`
- CLI publication: each example's `sample.py`
- UI publication: `portal/demo_server.py`

`sample.py check` verifies the current active version against materialized
source settings. A matching Agent name does not prove a matching version.

## Model deployment relationship

The Python wire contract uses:

```json
{
  "model_type": "managed",
  "model": "gpt-realtime-2.1"
}
```

`managed` means the Voice Agent service owns model resolution, but the exact
model identifier must be enabled for the Project. If `gpt-realtime-2.1` is
unsupported, try `gpt-realtime-1.5`, then another exact managed identifier
confirmed for that Project. Do not use an account deployment list as proof for
managed mode. This failure is not MCP.

## MCP route relationship

One image contains two isolated tool inventories:

| Example | Route | Typical local connection |
| --- | --- | --- |
| Finance with Handoff | `/mcp/finance-handoff` | `finance-handoff-local-e2e` |
| Finance with OTP and Officer Search | `/mcp/finance-otp-officer` | `finance-otp-officer-local-e2e` |

Some tools share names but have different schemas, so route correctness matters
even when `tools/list` succeeds.

Generated configuration:

- Local: `shared_mcp/config/generated/example1.local.env` and
  `example2.local.env`
- Azure: `example1.shared.env` and `example2.shared.env`

Each file contains only route URL and connection name. Local bearer state is
under `shared_mcp/state/local/token`; do not print, commit, or paste it.

## Local process ownership

The Portal and customer-owned MCP are separate:

- `portal/demo_server.py` starts the local UI on port `9527`;
- `shared_mcp/scripts/e2e-local.sh` starts the native MCP on `18003` and its
  named Dev Tunnel for CLI samples.

MCP evidence:

```text
shared_mcp/state/e2e/<UTC-run>/
  native-mcp.log  # authoritative MCP HTTP/tool activity
```

## Evidence by boundary

| Boundary | Evidence |
| --- | --- |
| Optional local MCP/CLI dependencies/auth | `setup-local-examples.sh --check` (not a Portal prerequisite) |
| Local Portal process | `http://127.0.0.1:9527/healthz`, Portal terminal output |
| Local MCP process | `http://127.0.0.1:18003/healthz`, newest E2E artifacts |
| Public MCP/tools | Portal template probe JSON for the no-auth service |
| Customer-owned MCP auth/tools | E2E probe output and `native-mcp.log` |
| Project selection | UI config/cookie, session `meta.json`, sample `.env` |
| Model deployment | account deployment list, `model_type`, exact `model` |
| Agent publication | `sample.py publish/check`, version and fingerprints |
| Connection materialization | published definition and Project connection target |
| Voice session | `meta.json`, `timeline.log`, `events.jsonl` |
| Foundry internal service | `conv_*` with `samples/download_conversation_traces.py` |
| MCP business execution | MCP item/tool ID, MCP log, persisted sample state |

## Read-only control commands

Run from `VoiceAgent/`. These commands do not print the MCP bearer token.

```bash
# Optional local MCP/CLI readiness only; skip for default Portal Templates.
./scripts/setup-local-examples.sh --check

# Local Portal health.
curl -fsS http://127.0.0.1:9527/healthz

# Local MCP health only if this runtime was deliberately started.
curl -fsS http://127.0.0.1:18003/healthz

curl -fsS \
  http://127.0.0.1:9527/api/templates/finance-example-realtime/mcp/probe
curl -fsS \
  http://127.0.0.1:9527/api/templates/finance-example-cascade-luna/mcp/probe
curl -fsS \
  http://127.0.0.1:9527/api/templates/finance-with-otp-and-officer-search/mcp/probe
```

The Portal probes prove unauthenticated Streamable HTTP `initialize` and
`tools/list` for the configured public service. They do not prove the legacy
HTTP+SSE sequence used by a customer-owned Foundry RemoteTool connection. For
a CLI-created Agent handoff failure, correlate the session timestamp with
`native-mcp.log` and require `GET 200`, message `POST 202`, and
`ListToolsRequest` before declaring the transport healthy.

Verify the published Agent version using the same materialized settings:

```bash
cd samples/example1_finance_with_handoff_realtime
python sample.py check

cd ../example1_finance_with_handoff_cascade
python sample.py check

cd ../example2_finance_with_OTP_and_Officer_Search
python sample.py check
```

Inspect Project connection metadata without requesting credentials:

```bash
PROJECT_HOST="${AZURE_AI_PROJECT_ENDPOINT#https://}"
PROJECT_HOST="${PROJECT_HOST%%/*}"
ACCOUNT_NAME="${PROJECT_HOST%%.*}"
PROJECT_NAME="${AZURE_AI_PROJECT_ENDPOINT##*/}"
PROJECT_RESOURCE_ID="$(
  az resource list \
    --resource-type Microsoft.CognitiveServices/accounts/projects \
    --query "[?name=='${ACCOUNT_NAME}/${PROJECT_NAME}'].id | [0]" \
    --output tsv
)"
ACCOUNT_RESOURCE_ID="${PROJECT_RESOURCE_ID%/projects/*}"
az rest \
  --method get \
  --url "https://management.azure.com${ACCOUNT_RESOURCE_ID}/connections?api-version=2025-04-01-preview" \
  --query "value[].{name:name,category:properties.category,target:properties.target}" \
  --output table
```

## Fault-domain rule

Find the first boundary without expected evidence. Do not:

- change prompts when MCP authentication fails;
- redeploy MCP when model validation rejects publication;
- blame MCP when no tool call left Foundry;
- blame Foundry when MCP received the call and returned a business error;
- restart before preserving run/session/conversation/tool IDs.

When an MCP call appears in Foundry trace but not in MCP logs, first prove the
MCP endpoint was alive in the same time window. When `execute_tool` is followed
by no second `chat`, distinguish a missing tool result from a completed tool
whose response continuation failed.
