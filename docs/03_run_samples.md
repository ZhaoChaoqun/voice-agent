# 03 - Start and run the Finance samples

## Conclusion

The normal Portal Template workflow uses public no-auth MCP and needs no
local MCP setup. Follow the [Portal guide](../portal/README.md) for that path.
The CLI samples below still use customer-managed MCP connections. Local MCP,
Dev Tunnel, `setup-local-examples.sh`, and local E2E are **optional**: choose them
only when developing or hosting your own MCP on this machine. An already
deployed customer-owned MCP needs no Dev Tunnel.

The local setup and validation sequence below is for that opt-in CLI path,
not Portal onboarding. Start with the
[architecture and documentation index](./README.md) when choosing a
component or looking for a specific guide.

If you choose locally hosted MCP for the Finance CLIs, complete its one-time
prerequisites and run
`VoiceAgent/shared_mcp/scripts/e2e-local.sh` before publishing either Finance
example with its CLI. The command starts the MCP implementation as a native
Python process, exposes it to Microsoft Foundry through a persistent named Dev
Tunnel, creates the required Foundry connections, generates the shared local
config, and verifies both public MCP route contracts. Each sample CLI then
publishes the selected Agent independently.

That optional local path is:

```text
local Python process
  http://127.0.0.1:18003
       |
       v
persistent named Dev Tunnel
  https://<stable-tunnel>-18003.<region>.devtunnels.ms
       |
       v
two Foundry RemoteTool connections
       |
       v
generated example1.local.env / example2.local.env
       |
       +--> sample.py publish / check / run
```

Do not put `localhost` in a published Voice Agent. MCP calls are made from
Foundry, not from the local browser or Python client, so the Agent requires a
public HTTPS URL even when the MCP implementation runs on a developer machine.

For component-specific detail, use:

- [MCP implementation, local hosting, and Azure deployment](./02_mcp_settings.md)
- [Portal startup and configuration](../portal/README.md)
- [Example 1: Finance with Handoff - Realtime](../samples/example1_finance_with_handoff_realtime/README.md)
- [Example 1: Finance with Handoff - Cascade](../samples/example1_finance_with_handoff_cascade/README.md)
- [Example 2: Finance with OTP and Officer Search](../samples/example2_finance_with_OTP_and_Officer_Search/README.md)
- [Recorded session debugging](./04_debug_session.md)

## Components

| Component | Responsibility |
| --- | --- |
| [`shared_mcp/`](../shared_mcp/) | Customer-owned MCP code for the CLI samples, native local runtime, optional container packaging, Dev Tunnel, connections, and E2E; not used by the Portal |
| [`example1_finance_with_handoff_realtime/`](../samples/example1_finance_with_handoff_realtime/) | Original Realtime Handoff Agent, backup versions and CLI |
| [`example1_finance_with_handoff_cascade/`](../samples/example1_finance_with_handoff_cascade/) | Original Cascade Handoff Agent (`gpt-4.1-mini`), backup versions and CLI |
| [`example2_finance_with_OTP_and_Officer_Search/`](../samples/example2_finance_with_OTP_and_Officer_Search/) | Flat OTP/officer Agent definition and CLI publication/runtime entry point |
| [`portal/`](../portal/) | Browser template catalog, Try it now publication, authoring, and live Voice Agent session |
| [`voice_agent_sdk_common.py`](../samples/voice_agent_sdk_common.py) | Shared config materialization, publication, readback, and Voice WebSocket runtime |

The MCP host exposes separate routes because the two business packs have some
same-named tools with different schemas:

| Example | MCP route | Foundry connection |
| --- | --- | --- |
| Example 1 | `/mcp/finance-handoff` | `finance-handoff-local-e2e` |
| Example 2 | `/mcp/finance-otp-officer` | `finance-otp-officer-local-e2e` |

## Prerequisites

These are prerequisites for the optional local MCP/CLI path only. For the
default Portal, use the smaller prerequisite list in its
[README](../portal/README.md); Dev Tunnel, its GitHub sign-in, and local MCP
connection creation are not required.

- Python 3.10 or later.
- Azure CLI authenticated with `az login`.
- A GitHub identity that can authenticate Dev Tunnel by device code. The setup
  script installs a repository-local CLI when needed, but never performs the
  interactive login automatically.
- Access to a Microsoft Foundry Project with a compatible versioned managed
  realtime model.
- Permission to create Project connections and publish Voice Agents.

Azure Developer CLI is not required for this local workflow. It is required
only by the Azure Container Apps deployment path in guide 02.

This guide assumes the repository is already cloned. Set one reusable path to
its `VoiceAgent/samples` directory:

```bash
export VOICE_AGENT_ROOT=/path/to/Cognitive-Speech-TTS/VoiceAgent
export SAMPLES_ROOT="$VOICE_AGENT_ROOT/samples"
test -d "$VOICE_AGENT_ROOT/shared_mcp"
```

Verify that the Azure identity and Dev Tunnel identity are
ready before continuing:

```bash
az account show --output none
cd "$VOICE_AGENT_ROOT"
./scripts/setup-local-examples.sh --check
```

The local workflow does not require or invoke Docker. Install Docker only when
deliberately running the separate `shared_mcp/scripts/package.sh` image
packaging command. Azure Container Apps deployment uses a remote build.

If `devtunnel` is missing or authentication fails, follow the install and
device-code steps in
[02: MCP settings and E2E](./02_mcp_settings.md#install-dev-tunnel-cli-on-linux-or-wsl).

## Create the sample and Portal Python environments

For Portal only, follow the [Portal setup](../portal/README.md#set-up) and skip
the MCP/CLI installer below. It does not prepare the Portal environment.

The two Finance scenarios and portal have separate requirements and separate
virtual environments. Setup also creates `shared_mcp/.venv` for the native MCP
runtime. Create the environment for each component that you plan to run.

The recommended setup entry point is:

```bash
cd "$VOICE_AGENT_ROOT"
./scripts/setup-local-examples.sh \
  --project-endpoint "$AZURE_AI_PROJECT_ENDPOINT"
```

`setup-local-examples.sh` checks required command-line tools, installs a
repository-local Dev Tunnel CLI when missing, creates or reuses the CLI and MCP
Python environments, and creates the three sample `.env` files. On the first
normal setup it also
generates `shared_mcp/state/local/devtunnel-id`; later setup and E2E runs reuse
that fixed local ID. The file is ignored by Git. Use `--check` to
inspect readiness without installing, generating the ID, or changing
environments.

Repository-local tools live under ignored `.local-tools/`; setup and
the MCP E2E script add them to their own `PATH`, so later lifecycle commands
work in a fresh shell. On minimal Debian/Ubuntu Python installations
where `venv` exists but `ensurepip` does not, setup creates each `.venv` with
`--without-pip` and bootstraps `pip` inside that environment. Do not install
`python3.12-venv` with `sudo` merely to run this workflow.

The repository-local Dev Tunnel CLI is intentionally not added to the user's
interactive shell. Complete its one-time device-code login through the wrapper:

```bash
./scripts/login-devtunnel.sh
./scripts/setup-local-examples.sh --check
```

The wrapper uses GitHub and guarantees that identity state is resolved from the
`shared_mcp` working directory used by E2E.

When reusing an older sample `.env`, setup migrates MCP selection to the
canonical `VOICE_AGENT_MCP_CONFIG` file and removes legacy direct MCP URL and
connection overrides. This prevents an old connection from another Project
from overriding the connection created by the current E2E.

Set a package index once when the default PyPI file host is unavailable:

```bash
export PIP_INDEX_URL="${PIP_INDEX_URL:-https://pypi.org/simple}"
```

For example, a customer-approved mirror can be selected before running the
commands:

```bash
export PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
```

The commands below are a manual alternative for hosts with a complete Python
installation. Prefer `setup-local-examples.sh` on minimal Linux/WSL hosts;
direct `python3 -m venv` requires that interpreter's `ensurepip` support.

Install each example's Python dependencies before the first run:

```bash
cd "$SAMPLES_ROOT/example1_finance_with_handoff_realtime"
python3 -m venv .venv
.venv/bin/python -m pip install \
  --index-url "${PIP_INDEX_URL}" \
  -r requirements.txt

cd "$SAMPLES_ROOT/example1_finance_with_handoff_cascade"
python3 -m venv .venv
.venv/bin/python -m pip install \
  --index-url "${PIP_INDEX_URL}" \
  -r requirements.txt

cd "$SAMPLES_ROOT/example2_finance_with_OTP_and_Officer_Search"
python3 -m venv .venv
.venv/bin/python -m pip install \
  --index-url "${PIP_INDEX_URL}" \
  -r requirements.txt

cd "$VOICE_AGENT_ROOT/portal"
python3 -m venv .venv
.venv/bin/python -m pip install \
  --index-url "${PIP_INDEX_URL}" \
  -r requirements.txt

cd web
npm ci
npm test
npm run build:all
```

## Configure the Finance sample and portal environment files

Configure only the components you intend to run. The Finance CLI path uses the
sample `.env` files; Portal-only users need only `portal/.env`. Use the same
Foundry Project when intentionally comparing the CLI and Portal paths.

```bash
cd "$SAMPLES_ROOT"
[ -f example1_finance_with_handoff_realtime/.env ] || \
  cp example1_finance_with_handoff_realtime/.env.example \
  example1_finance_with_handoff_realtime/.env
[ -f example1_finance_with_handoff_cascade/.env ] || \
  cp example1_finance_with_handoff_cascade/.env.example \
  example1_finance_with_handoff_cascade/.env
[ -f example2_finance_with_OTP_and_Officer_Search/.env ] || \
  cp example2_finance_with_OTP_and_Officer_Search/.env.example \
  example2_finance_with_OTP_and_Officer_Search/.env

[ -f ../portal/.env ] || cp ../portal/.env.example ../portal/.env
```

Set a valid Project endpoint in each selected component's file. Portal uses
`AZURE_VOICE_AGENTS_ENDPOINT`; the samples use `AZURE_AI_PROJECT_ENDPOINT`.
Use `AZURE_CREDENTIAL_MODE=cli` in all four when the intended identity is the one
selected by `az login`. To find an existing endpoint rather than guessing it,
use [01: Existing Project fast path](./01_setup_subscription.md#existing-project-fast-path).

The endpoint must be a full Project endpoint, not an Azure portal URL or
account endpoint:

```dotenv
AZURE_AI_PROJECT_ENDPOINT=https://<account>.services.ai.azure.com/api/projects/<project>
AZURE_CREDENTIAL_MODE=cli
```

The samples use the standard service-managed Voice Agent model:

```dotenv
VOICE_AGENT_MODEL=gpt-realtime-2.1
```

`model_type: managed` remains in each committed `agent.json`. Start with the
default `gpt-realtime-2.1`. If that exact model is unsupported, set
`VOICE_AGENT_MODEL=gpt-realtime-1.5` in both Finance sample `.env` files and
the portal `.env`, then retry publication. If the Project exposes another
managed variant, use its exact identifier instead. This workflow does not
require a customer-created model deployment.

The checked-in `.env.example` files already select the canonical local MCP
configs:

```dotenv
# Example 1
VOICE_AGENT_MCP_CONFIG=../../shared_mcp/config/generated/example1.local.env
```

```dotenv
# Example 2
VOICE_AGENT_MCP_CONFIG=../../shared_mcp/config/generated/example2.local.env
```

These generated files do not exist until the local MCP E2E starts.

## Start the local MCP path for CLI samples

**Optional: skip this section for default Portal Templates or an already
deployed customer-owned MCP.** Dev Tunnel is used here only so Foundry can
reach the MCP running on this developer machine.

This path is only for the CLI samples. It does not start or configure the
Portal, whose default Templates use the public no-auth MCP.

```bash
cd "$VOICE_AGENT_ROOT/shared_mcp"
PIP_INDEX_URL="${PIP_INDEX_URL}" ./scripts/e2e-local.sh
```

The command performs all of the following:

1. Runs the MCP tests using `shared_mcp/.venv`.
2. Starts `python -m shared_mcp.server` on local port `18003`.
3. Persists active business state under `shared_mcp/state/local/runtime/`.
4. Creates or reuses the setup-initialized named Dev Tunnel recorded in
   `state/local/devtunnel-id`.
5. Creates or reuses the bearer token recorded in `state/local/token`.
6. Verifies public health and that unauthenticated MCP requests return HTTP
   401.
7. Creates or updates the two fixed Foundry connections.
8. Writes the two non-secret `config/generated/*.local.env` files.
9. Runs authenticated `initialize` and `tools/list` against both public routes
   and verifies the tool inventory against both `agent.json` contracts.
10. Keeps the native MCP process and Dev Tunnel host running for CLI sample
    publication.

The named tunnel, local port, token, connection names, and generated config are
reused on later runs. This gives the local MCP a stable Foundry-facing URL
instead of a new temporary URL on every invocation.

Leave this command running while using either CLI sample. Pressing `Ctrl+C`
stops the local Python server and tunnel host process. The named tunnel,
generated config, Foundry connections, and published Agent versions remain,
but MCP calls cannot succeed until the local host starts again.

Wait for all of these final lines before opening another terminal:

```text
e2e_local=passed artifacts=...
fixed_tunnel_id=...
example1_config=...
example2_config=...
local_runtime=ready base_url=https://...
mcp_runtime=native
Press Ctrl+C to stop the local MCP runtime and dev tunnel.
```

For CI, run the same E2E without keeping the runtime alive:

```bash
SHARED_MCP_E2E_KEEP_RUNNING=0 ./scripts/e2e-local.sh
```

The optional `package.sh` only creates a Docker image. It does not generate the
Project connections, `state/local/token`, or `config/generated/*.local.env`.
The sample CLIs publish Agents only after this MCP process is ready; their
model or Agent validation failures do not stop MCP hosting.

## Authentication model

The Dev Tunnel permits anonymous network access so Foundry can reach it, but
the MCP routes are not anonymous. Every Streamable HTTP MCP request requires a
bearer token.

The local workflow makes this transparent:

1. `e2e-local.sh` generates the token once and keeps it under ignored local
   state.
2. The token is stored in the two Foundry connections.
3. Generated example configs contain only the MCP URL and connection name.
4. `agent.json` and the CLI never receive the token.

An unauthenticated HTTP 401 is expected and proves that the public endpoint is
gated. Do not disable the bearer gate merely because the implementation runs
locally; the Dev Tunnel URL is still public.

## How a Voice Agent uses the MCP

The committed `agent.json` files intentionally leave `server_url` and
`project_connection_id` empty. They are portable source definitions, not
developer-specific deployed definitions.

At publication time:

1. `VOICE_AGENT_MCP_CONFIG` selects one generated config.
2. `voice_agent_sdk_common.py` reads its route URL and connection name.
3. Every MCP tool in the Agent definition receives the same route-specific
   values.
4. No authorization header or token is written into the Agent definition.
5. The SDK publishes and enables an immutable Voice Agent version.
6. Readback verifies the model, graph shape, and connection reference.

At runtime:

1. The client opens the published Agent's Voice WebSocket.
2. Foundry reads the MCP tool's public `server_url`.
3. Foundry obtains the authorization value from `project_connection_id`.
4. Foundry calls the local MCP through the Dev Tunnel.
5. The MCP executes the business state machine and returns the tool result.
6. The Voice Agent continues the conversation or handoff using that result.

## Publish and run from the CLI

Publish or run either example from another terminal while E2E remains running:

### Example 1: Finance with handoff

```bash
cd "$SAMPLES_ROOT/example1_finance_with_handoff_realtime"

.venv/bin/python sample.py publish

.venv/bin/python sample.py check

.venv/bin/python sample.py run \
    --message "Hello, who is calling?" \
    --expect-handoff \
    --expect-mcp
```

For Cascade, run the same commands from
`$SAMPLES_ROOT/example1_finance_with_handoff_cascade`. Each directory publishes
its own root `agent.json`; `--variant` and the old shared builder are no longer
needed.

### Example 2: OTP and officer search

```bash
cd "$SAMPLES_ROOT/example2_finance_with_OTP_and_Officer_Search"

VOICE_AGENT_NAME=finance-otp-officer-local-e2e \
  .venv/bin/python sample.py publish

VOICE_AGENT_NAME=finance-otp-officer-local-e2e \
  .venv/bin/python sample.py check

VOICE_AGENT_NAME=finance-otp-officer-local-e2e \
  .venv/bin/python sample.py run \
    --message "Hello, I need to reach my loan officer." \
    --message "12345007" \
    --expect-mcp
```

If a sample `.env` does not contain the canonical
`VOICE_AGENT_MCP_CONFIG`, set it on the command line explicitly:

```bash
VOICE_AGENT_MCP_CONFIG=../../shared_mcp/config/generated/example1.local.env \
  .venv/bin/python sample.py publish
```

## Load and publish the examples from the local Portal

The Portal is an independent local UI and does not use the local MCP E2E above.
Start it from another terminal:

```bash
cd "$VOICE_AGENT_ROOT/portal"
.venv/bin/python demo_server.py
```

Open `http://127.0.0.1:9527`. If it runs on a VS Code Remote-SSH host, forward
remote port `9527` and open the exact forwarded address shown by VS Code.

The default [`portal/templates.config.json`](../portal/templates.config.json)
maps each Template to its sibling `agent.json` and a fixed public no-auth MCP
route. On **Try it now**, the UI configures the selected Template MCP URL without
creating a Project connection for public mode, submits the authored Agent
definition to Foundry, reads the published version back, and opens Runtime.
Local diagnostics are advisory. A public MCP probe or voice/region discovery is
not a prerequisite for submission; explicit connection probes are separate
diagnostic actions.

The Portal initially uses `AZURE_VOICE_AGENTS_ENDPOINT` from `portal/.env`.
Project selection, local startup, and Remote-SSH guidance are maintained in
the [Portal README](../portal/README.md).

## Verify the closed loop

The MCP runtime and generated-config checks below apply only to the optional
locally hosted CLI workflow. Skip them for the default Portal.

### MCP runtime

```bash
cd "$VOICE_AGENT_ROOT"
curl -sS http://127.0.0.1:18003/healthz
```

Expected:

```text
{"status":"ok"}
```

Inspect the persistent tunnel:

```bash
./scripts/setup-local-examples.sh --check
```

### Generated config

```bash
test -s shared_mcp/config/generated/example1.local.env
test -s shared_mcp/config/generated/example2.local.env
test -s shared_mcp/state/local/token
```

The files must contain an HTTPS MCP URL and a connection name, but no bearer
token.

The script creates `state/local/token` with owner-only permissions under a
directory ignored by Git. Do not use real customer data with this public
development tunnel.

### Agent publication

`.venv/bin/python sample.py check` should report:

- the expected Agent name and active version;
- the intended Foundry connection;
- matching requested/readback fingerprints for the current generated config.

### Portal

The independently started Portal Editor should:

- offer Finance examples in **Load from templates**;
- require no local MCP token, generated config, or Dev Tunnel login;
- allow **Try it now**, showing the actual Foundry publication result;
- read the published version back and open Runtime on success.

The Portal does not depend on local E2E or generated MCP config. A successful
public no-auth probe proves reachability and tool inventory only; it is not a
startup or publication gate, nor proof that a business conversation succeeds.

## Troubleshooting

For cross-layer diagnosis, use the shared
[`debug-local-session` Skill](../skills/debug-local-session/):

```bash
cd VoiceAgent
python skills/debug-local-session/scripts/analyze_session.py --list
python skills/debug-local-session/scripts/analyze_session.py <session-id>
```

It covers setup, Project/model deployment, Agent publication/version,
MCP route/tools, Portal bridge, and session recordings.

| Symptom | Cause | Resolution |
| --- | --- | --- |
| `files.pythonhosted.org` TLS or connection failure during setup | The host cannot reach the configured Python package index | Set `PIP_INDEX_URL` to a customer-approved mirror and rerun setup |
| `devtunnel is required` | Repository-local Dev Tunnel CLI is missing | Run normal `setup-local-examples.sh` without `--check` |
| Dev Tunnel is not logged in | GitHub device-code login has not completed | Run `./scripts/login-devtunnel.sh`, complete the browser prompt, then run setup `--check` |
| A sample command cannot import its requirements | That scenario's `.venv` was not created | Install that scenario's requirements; the UI `.venv` is not a substitute |
| E2E cannot find the Project | The active Azure CLI subscription is wrong or the endpoint was guessed | Select the exact subscription and discover the Project through Azure CLI as documented in guide 01 |
| `Model '<name>' is not supported in managed mode in this region` | The exact managed model identifier is unavailable in the selected Project, or the Project is not eligible | Try the documented versioned fallback (`gpt-realtime-2.1`, then `gpt-realtime-1.5`), use another exact identifier confirmed for that Project, or move to an eligible Project; do not switch to self-deployed mode merely to bypass the error |
| CLI Agent using a local MCP cannot list tools | Local Python server or tunnel host stopped | Restart the optional `shared_mcp/scripts/e2e-local.sh` and leave it running; default Portal Templates use the public service instead |
| Tool returns `unknown_call` after a runtime replacement | The call started before state persistence was enabled, or `state/local/runtime` was removed | End that Voice Agent session and reconnect; retain the native state directory |
| HTTP 401 from a customer-owned managed MCP | Request omitted the bearer token | Foundry supplies it from the configured connection; the default public no-auth MCP should not require this token |
| Generated config is missing | Local E2E has not completed CLI connection setup | Run `e2e-local.sh` to its final success lines |
| UI publish reports Agent write permission denied | UI used the wrong Azure identity | Set `AZURE_CREDENTIAL_MODE=cli`, run `az login` with the intended identity, and restart UI |
| Port 18003 is already allocated | An older E2E/native process is still running | Stop the older owning script, then start the canonical E2E |
| Agent check fingerprints differ | Active Agent was published with another tunnel/config | Republish using the current canonical `*.local.env` |
| New immutable versions appear | Foundry Agent versions are append-only | Expected after each successful publish |

## Rotate or revoke local access

This applies only to the optional local MCP, not the shared public no-auth
service or normal Portal startup.

Stop the running E2E with `Ctrl+C` before rotating its credential. From
`VoiceAgent/shared_mcp/`, remove only the local token and rerun E2E:

```bash
rm -f state/local/token
./scripts/e2e-local.sh
```

The script creates a new token and replaces the credential in both fixed
Foundry connections. Previously copied token values no longer authenticate.

To revoke the endpoint completely, stop the local host and delete or disable
the two `*-local-e2e` connections in the Foundry Project. The guide does not
delete connections or immutable Agent versions automatically.

## Local versus Azure-hosted MCP

This guide describes local debugging:

- Native Python executes MCP locally.
- A persistent named Dev Tunnel provides Foundry reachability.
- Samples select `example1.local.env` and `example2.local.env`.

For a customer-owned Azure Container Apps deployment, use
`VoiceAgent/shared_mcp/scripts/deploy.sh`. That path writes
`example1.shared.env` and `example2.shared.env`; select those configs instead
of the local files.

## Sample limitations

- Loan-officer name search is deliberately a fake implementation that returns
  a random available fictional officer.
- State is stored locally and is not production durable.
- The local E2E uses one native MCP process.
- Dev Tunnel is a development bridge, not a production ingress.

See [02: MCP settings](./02_mcp_settings.md) for packaging, infrastructure,
security, modification, and persistence details.
