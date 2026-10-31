# Voice Agent Finance examples

## Conclusion

Start the [local Portal](../portal/README.md) to try the default Templates.
They use the public no-auth MCP; no local MCP, Dev Tunnel, local E2E, or
`setup-local-examples.sh` is required. Foundry project access is still required.

The numbered guides are references, not a mandatory installation checklist:

1. [Set up the subscription and Foundry Project](./01_setup_subscription.md).
2. [Optional: configure, host, or develop your own MCP for CLI samples](./02_mcp_settings.md).
3. [Start and run the CLI samples or local Portal](./03_run_samples.md).
4. [Debug a portal session](./04_debug_session.md).
5. [Use real tools with Templates that use mock tools](./05_connect_real_tools.md).
6. [Create Salesforce, Zendesk, and Work IQ MCP servers with Azure Logic Apps](./06_logic_apps_mcp_servers.md).

The scenario-specific source of truth remains with each example:

- [Example 1: Finance with Handoff - Realtime](../samples/example1_finance_with_handoff_realtime/README.md)
- [Example 1: Finance with Handoff - Cascade](../samples/example1_finance_with_handoff_cascade/README.md)
- [Example 2: Finance with OTP and Officer Search](../samples/example2_finance_with_OTP_and_Officer_Search/README.md)
- [Voice Agent portal](../portal/README.md)

Using only the local Portal and its Templates? Skip guide 02 and the local
MCP/Dev Tunnel sections of guide 03: every Template
calls the public no-auth MCP, so `shared_mcp` does not need to be started or
deployed. Step 2 applies to the Finance CLI samples and to hosting the Finance
MCP yourself. An existing customer-hosted MCP or an Azure deployment does not
need a local server or Dev Tunnel. The Finance CLI examples still require the
managed MCP URL/connection configuration described in their own READMEs.

This `README.md` owns only the architecture and navigation. The numbered
documents own procedures.

> [!IMPORTANT]
> The optional local MCP runtime for CLI samples is always native Python plus
> Dev Tunnel. Setup,
> readiness checks, E2E, and lifecycle commands do not require, inspect, or
> invoke Docker. Docker is used only when explicitly running the separate
> container-image packaging command; Azure Container Apps uses a remote build.

## Setup and troubleshooting map

| Need or failure | Source of truth |
| --- | --- |
| Select a subscription, find or create a Project, or verify the exact managed realtime model and region support | [01: Subscription and Foundry Project](./01_setup_subscription.md) |
| Set up the optional customer-owned local MCP: package mirror, Dev Tunnel, Project connections, or `*.local.env` files | [02: MCP settings and E2E](./02_mcp_settings.md) |
| Prepare Finance CLI environments for that optional local workflow (not the Portal installer) | [`setup-local-examples.sh`](../scripts/setup-local-examples.sh) and [03: Run samples](./03_run_samples.md) |
| Install and start the local Portal UI | [Portal README](../portal/README.md) |
| Optionally start or inspect a customer-owned local MCP + Dev Tunnel | [02: MCP settings and E2E](./02_mcp_settings.md) |
| Diagnose a session that reached the Voice WebSocket | [04: Debug a portal session](./04_debug_session.md) and [`skills/debug-local-session/`](../skills/debug-local-session/) |

The local MCP E2E path uses the identity from `az login` for Project discovery
and connection creation. It does not publish Agents and does not require
`azd auth login`. Each CLI sample publishes its selected Agent after MCP
readiness. The local Portal is independent and uses the configured public
no-auth MCP. Azure Developer CLI remains a prerequisite only for the Azure
Container Apps deployment path.

## Architecture

The local Portal and the Finance CLIs both publish or invoke a Voice Agent in
Microsoft Foundry, but they use different MCP bindings:

```text
Default: local Portal -> Foundry Voice Agent -> public no-auth MCP
```

The following is the optional customer-owned CLI path, not Portal startup:

```text
                              management and publication
  sample.py              ------------------------------------+
       |                                                      |
       | Voice WebSocket                                      v
       +------------------------------------------> Foundry Voice Agent
                                                          |
                                                          | server_url
                                                          | project_connection_id
                                                          v
                                                Foundry RemoteTool connection
                                                          |
                                                          | Authorization: Bearer ...
                                                          v
                            +---------------- public HTTPS MCP host ----------------+
                            |                                                       |
                 local: named Dev Tunnel                         Azure: Container App
                            |                                                       |
                            +------------------------+------------------------------+
                                                     |
                                                     v
                                      one shared MCP server
                                                     |
                         +---------------------------+---------------------------+
                         |                                                       |
             /mcp/finance-handoff                            /mcp/finance-otp-officer
                         |                                                       |
             Finance handoff business pack                      OTP/officer business pack
```

The diagram above is the customer-owned CLI path. The local Portal follows a
separate path: it injects the fixed public no-auth MCP URL from
`portal/templates.config.json` and does not create or reference a Foundry
Project connection.

One MCP server contains both Finance implementations. The routes remain
separate because they contain some same-named tools with different schemas.
The optional container image is a packaging/deployment artifact, not a local
runtime option.

## Components and ownership

| Component | Owns | Does not own |
| --- | --- | --- |
| [`shared_mcp/`](../shared_mcp/) | Both Finance MCP implementations, fictional data, auth, native local runtime, optional container image, Dev Tunnel, Azure Container Apps IaC, protocol probes, and Foundry connection configuration | Foundry Project creation, model deployment, Agent publication |
| [`example1_finance_with_handoff_realtime/`](../samples/example1_finance_with_handoff_realtime/) | Realtime Finance Agent definition, backups and CLI publication/readback/runtime validation | MCP hosting or Cascade source generation |
| [`example1_finance_with_handoff_cascade/`](../samples/example1_finance_with_handoff_cascade/) | Cascade Luna Finance Agent definition, backups and independent CLI | MCP hosting or Realtime source generation |
| [`example2_finance_with_OTP_and_Officer_Search/`](../samples/example2_finance_with_OTP_and_Officer_Search/) | Example 2 Agent definition, flat tool workflow, CLI publication/readback/runtime validation | MCP hosting |
| [`portal/`](../portal/) | Project and Agent selection, template publication, microphone/text sessions, handoff visualization, latency, MCP activity, authoring, WebRTC, and local session recording | MCP business execution |
| [`voice_agent_sdk_common.py`](../samples/voice_agent_sdk_common.py) | Shared config materialization, Agent publication/readback, and text Voice WebSocket runtime | Browser UI and MCP transport |

## Artifact flow

There are three distinct stages. Keeping them separate prevents credentials or
environment-specific URLs from leaking into the committed Agent definitions.

### 1. Source

- Each example owns a portable `agent.json`.
- MCP `server_url` and `project_connection_id` are intentionally empty.
- [`shared_mcp/`](../shared_mcp/) contains both business implementations and
  fictional fixtures.

### 2. CLI MCP hosting and connection configuration

Only for customer-owned CLI hosting, choose one:

- Local development: `VoiceAgent/shared_mcp/scripts/e2e-local.sh`
- Customer-owned Azure hosting: `VoiceAgent/shared_mcp/scripts/deploy.sh`

These workflows create route-specific generated config files containing only:

```dotenv
VOICE_AGENT_MCP_SERVER_URL=https://...
VOICE_AGENT_MCP_CONNECTION_ID=...
```

The bearer token remains in ignored local state or an Azure Container App
secret and in the Foundry Project connection. It is not written to
`agent.json` or returned to the browser.

### 3. Agent publication and session runtime

The CLI reads a generated config, injects the route URL and connection name
into every MCP declaration, publishes an immutable Agent version, and verifies
readback. During a CLI-created session, Foundry uses the connection credential
to call the selected MCP route.

The local Portal instead reads its checked-in Template catalog, injects the
fixed public no-auth MCP URL, omits `project_connection_id`, and publishes into
the Project selected by the developer.

## Fastest local Portal workflow

Follow the [Portal README](../portal/README.md). In summary:

```bash
az login
cd /path/to/VoiceAgent/portal
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
[ -f .env ] || cp .env.example .env
# Set AZURE_VOICE_AGENTS_ENDPOINT in .env.
.venv/bin/python demo_server.py
```

Open `http://127.0.0.1:9527`. The default Templates use the public no-auth MCP;
no local MCP, Dev Tunnel, bearer token, or Project connection setup is needed.

## Finance CLI workflow

This is the optional, locally hosted customer-owned MCP path. Skip this section
for default Portal use or when reusing an already deployed MCP. Select the exact
subscription and Project endpoint, then prepare the local reference runtime:

```bash
cd /path/to/VoiceAgent
az login
./scripts/setup-local-examples.sh \
  --project-endpoint "https://<account>.services.ai.azure.com/api/projects/<project>"
./scripts/login-devtunnel.sh
./scripts/setup-local-examples.sh --check
cd shared_mcp
./scripts/e2e-local.sh
```

The CLI workflow is fully ready when both layers pass:

1. MCP: `e2e-local.sh` prints `e2e_local=passed` and
  `local_runtime=ready`, then remains running.
2. Sample CLI: each scenario's `sample.py publish` and `sample.py check`
  report matching requested/readback fingerprints.

## Local and Azure deployment boundaries

`e2e-local.sh` is the MCP local closed loop: it tests and starts the native MCP
server, hosts it through a named Dev Tunnel, verifies both route contracts,
creates connections, writes generated config, and remains running. Agent
publication for this path belongs to each sample CLI.

`deploy.sh` deploys the shared MCP image to Azure Container Apps and creates
the two Foundry connections and generated configs. It does not create the
Foundry Project, deploy the realtime model, or publish the two Agents. Publish
from the example CLI after deployment. The checked-in Portal Template catalog
is independent and always targets the configured public no-auth MCP.

Both paths validate authenticated MCP `initialize`, `tools/list`, and the
required tool inventory before declaring the MCP ready.

## Sample-only limitations

- The loan-officer name matcher deliberately returns a random available
  fictional officer; it is not the production phonetic matcher.
- OTP values and committed records are fictional test data.
- MCP state uses `shared_mcp/state/local/runtime/` for the native local workflow and ephemeral
  single-replica storage in the Azure sample deployment.
- Dev Tunnel is development ingress, not a production network design.
- Session recordings can contain transcript and tool data and have no
  automatic retention policy.

Use the numbered documents for procedures and troubleshooting rather than
extending this overview with component-specific detail.
