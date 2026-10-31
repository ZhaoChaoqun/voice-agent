# Add an example to Portal Templates

## Conclusion

Every new example intended for the portal **must** follow this contract:

1. keep a portable `agent.json`, or generated `agent.<variant>.json` files backed
   by one committed base, in a self-contained directory under `VoiceAgent/samples/`;
2. add an explicit allowlist entry to
   `VoiceAgent/portal/templates.config.json`;
3. keep MCP credentials out of source and choose one supported connection
   mode;
4. add catalog and behavior tests before treating the example as supported.

Default examples use `connection_mode: public` with the public no-auth MCP
configured in `portal/templates.config.json`. They work in a newly created
Foundry Project without local files, bearer tokens, or Project connections.
Local MCP hosting, Dev Tunnel, setup scripts, and local E2E are optional
developer workflows, not requirements for adding or using a public-mode
Template that reuses the existing hosted service.
The business-pack reference implementation remains in this repository's
`shared_mcp` directory. A checked-in example must never assume that a
connection already exists in a Microsoft test Project.

The portal does not scan `samples/` automatically. A directory that is not
allowlisted in `portal/templates.config.json` is not a portal Template.

## 1. Create a self-contained sample directory

Use a stable, descriptive directory name:

```text
VoiceAgent/samples/<example_name>/
  README.md
  agent.json
  sample.py              # optional CLI publisher or smoke test
  requirements.txt       # optional; required only by sample.py
  .env.example           # optional; never put secrets here
  validation/            # optional dated evidence
```

The portal reads only the allowlisted Agent document. It does not read the
sample's `.env`, README, validation output, or Python dependencies.

When one workflow has multiple runtime profiles, keep the workflow in one base
document and generate each portable Agent document deterministically. Add one
allowlist entry per generated file, give every variant a distinct Agent name,
and add a `--check` mode plus tests that fail when generated files drift.

The directory must remain under `VoiceAgent/samples/`, including after symlink
resolution. The catalog rejects paths that escape this root.

## 2. Author a portable `agent.json`

Use this top-level shape:

```json
{
  "name": "finance-example",
  "description": "What this Voice Agent does and when to use it.",
  "definition": {
    "kind": "voice",
    "model_type": "managed",
    "model": "gpt-realtime-2.1",
    "instructions": "Complete Agent instructions.",
    "audio": {
      "input": {},
      "output": {
        "voice": {
          "type": "azure-standard",
          "name": "en-US-AvaNeural"
        }
      }
    },
    "tools": [],
    "store": false
  }
}
```

Requirements:

- `definition` must be a JSON object and `definition.kind` must be `voice`.
- Keep the source name customer-neutral. Do not add `local-only-` to
  `agent.json`; the portal adds that prefix to every Template-published Agent.
- Keep service URLs, Project connection IDs, tokens, API keys, subscription
  IDs, tenant-specific values, and real customer data out of the file.
- If the Agent uses MCP, keep `server_url` and `project_connection_id` empty
  or portable in the source definition. The portal materializes the selected
  Template's configured values at publish time.
- Declare every expected MCP tool in `allowed_tools`. Portal readiness checks
  compare this list with the live server's `tools/list` response.
- A handoff example may include `definition.handoff.nodes` and
  `definition.handoff.edges`; use stable node and edge IDs so the workflow
  graph and recorded events remain correlatable.
- Set `store` deliberately. Local portal session recording is a separate
  setting and does not change the Agent's Azure persistence policy.

Use only fictional identities and business data in committed examples.

## 3. Add the Template allowlist entry

Edit `VoiceAgent/portal/templates.config.json`:

```json
{
  "id": "finance-example-realtime",
  "folder": "../samples/example1_finance_with_handoff_realtime",
  "name": "Example 1: Finance with Handoff - Realtime",
  "category": "Financial services",
  "summary": "A short customer-facing summary.",
  "accent_color": "#147d64",
  "mcp": {
    "connection_mode": "public",
    "server_url": "https://voice-agent-noauth-mcp.lemonsky-36682081.westus2.azurecontainerapps.io/mcp/finance-handoff",
    "source_label": "Public no-auth MCP",
    "source_reference": "VoiceAgent/shared_mcp"
  }
}
```

Field rules:

| Field | Rule |
| --- | --- |
| `id` | Required, unique lowercase DNS label, maximum 63 characters. |
| `folder` | Required, relative to `portal/templates.config.json`, and must resolve under `VoiceAgent/samples/`. |
| `agent_file` | Optional; defaults to `agent.json` and must remain inside the selected sample directory. |
| `name` | Optional display name; defaults to the Agent document's `name`. |
| `category` | Optional; defaults to `Voice Agent`. |
| `summary` | Optional; defaults to the Agent document's `description`. |
| `accent_color` | Optional card accent; use a readable CSS color. |
| `enabled` | Optional; defaults to `true`. Set `false` to retain an entry without exposing it. |
| `lock_runtime` | Optional; defaults to `false`. Set `true` when sibling cards intentionally pin different model/audio pipelines and Portal overrides must not collapse them. |
| `mcp` | Required only when the Agent definition contains MCP tools. |

The portal reload button re-reads both this allowlist and every enabled
`agent.json`.

### Keep experimental versions separate from the default

Keep the intended default in the sample root's `agent.json`. The existing
Version selector discovers matching filenames recursively, so a snapshot can
use `backups/<timestamp>/original/agent.json` and
`backups/<timestamp>/revised/agent.json` without another catalog entry.
Record file SHA-256, provenance and validation limitations in a manifest;
backup availability does not imply acceptance. Keep all snapshots portable and
credential-free. Realtime and Cascade Finance use separate sample directories
so one runtime's backup cannot be selected by the other's card.

## 4. Choose the MCP connection mode

### `public` — default Template mode

Use a public HTTPS `server_url` with no `connection_id`, `config_file`, or
`token_file`. Readiness must complete unauthenticated `initialize` and
`tools/list`, including every declared tool; HTTP 401/403 is a failure.
Publishing writes the URL to every MCP tool, including handoff nodes, and
removes `project_connection_id`, `authorization`, and `headers`.
No Foundry Project connection is created.

### `managed` — customer-owned MCP mode

This is an optional customer-owned development mode, not the default Template
path. Use it when deliberately selecting this repository's native `shared_mcp`
runtime and Dev Tunnel. Reusing a deployed public no-auth MCP requires neither.

- `config_file` must resolve under `VoiceAgent/shared_mcp/` and provide:

  ```dotenv
  VOICE_AGENT_MCP_SERVER_URL=https://<tunnel>/mcp/<route>
  VOICE_AGENT_MCP_CONNECTION_ID=<connection-name>
  ```

- `token_file` must resolve under `VoiceAgent/shared_mcp/`.
- The server reads the token, verifies `initialize` and `tools/list`, and
  creates or updates the selected Foundry Project connection.
- Neither the token nor connection credential is returned to the browser.
- Agents published through this mode receive the `local-only-` prefix because
  they depend on this machine's native MCP process and Dev Tunnel.

Only when an example introduces a new business pack implemented in this repository,
add it to `shared_mcp` before allowlisting it:

1. create or extend a business pack under `shared_mcp/app/shared_mcp/`;
2. register an isolated route in `shared_mcp/server.py`;
3. update `shared_mcp/scripts/configure-agent.sh` and
   `shared_mcp/scripts/e2e-local.sh`;
4. generate a non-secret route config under `shared_mcp/config/generated/`;
5. add route inventory and authenticated probe tests.

Do not run local E2E, generate local connection files, or install Dev Tunnel
for an example that simply reuses the existing public service.

An example may instead reuse an existing external hosted MCP contract, as the
[Front Desk sample](example4_frontdesk_with_fluency_and_handoff/README.md) does.
Keep its Agent definition portable, identify that external source accurately in
the catalog, verify the exact tool inventory, and document service limitations.
Do not add a duplicate business implementation to Portal hosting infrastructure.

### `existing` — framework capability, not for checked-in examples

This mode remains available for private Portal deployments where the selected
Foundry Project already owns the required connection. Do not use it for any
example checked into this repository.

The portal may treat direct HTTP 401/403 as proof that the endpoint is
reachable because authentication remains in the existing Project connection.
Publishing does not replace that connection.

### `user_provided`

Do not use this mode for public portal examples. The standalone portal rejects
browser-supplied MCP credentials by policy. This mode exists in the shared
source dashboard contract and requires a separate approved credential design.

Optional `mcp.allowed_backends` restricts a Template to named Agent backends.
Leave it empty unless the example has an explicit backend dependency.

## 5. Preserve security and portability

- Never commit `.env`, bearer tokens, API keys, connection secrets, recordings,
  real customer data, or generated local state.
- Keep ignored local tokens under `VoiceAgent/shared_mcp/state/`.
- Keep generated non-secret route mappings under
  `VoiceAgent/shared_mcp/config/generated/`.
- Do not put `localhost` in a published Agent definition. Foundry calls MCP
  from the cloud and needs a public HTTPS endpoint.
- Do not weaken the portal's path checks, SSRF protection, header allowlists,
  same-origin boundary, or authenticated redirect rejection for one example.
- New examples must not silently fall back to mocks or another Project.

## 6. Add tests

Update `VoiceAgent/portal/tests/test_templates.py`:

- add the new Template ID to the expected catalog;
- verify catalog loading has no errors;
- verify important graph nodes, edges, and tool inventories;
- verify the intended `connection_mode`, backend restrictions, and token
  policy;
- add HTTP route coverage when the example introduces new behavior.

If shared browser behavior changes, update the portal Playwright tests under
`VoiceAgent/portal/web/tests/`.

If the example adds an MCP route, update
`VoiceAgent/shared_mcp/tests/test_shared_mcp.py` so every Agent
`allowed_tools` entry must exist in the route inventory.

## 7. Validate the complete workflow

Start the local Portal as described in its [README](../portal/README.md); the
default Templates need no Dev Tunnel or local MCP process. Validate changes to
the customer-owned `shared_mcp` implementation independently with the commands
in its [README](../shared_mcp/README.md).

Verify catalog and detail:

```bash
curl -fsS http://127.0.0.1:9527/api/templates?reload=1
curl -fsS http://127.0.0.1:9527/api/templates/<template-id>
curl -fsS \
  http://127.0.0.1:9527/api/templates/<template-id>/mcp/probe
```

Run regressions:

```bash
cd portal
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m pip check

cd web
npm test
npm run test:ui
npm run test:local
```

For an MCP-backed example, the workflow is not complete until:

- public MCP `/healthz` returns HTTP 200;
- default public `initialize` and `tools/list` succeed without Authorization;
- for a customer-owned `managed` configuration, unauthenticated MCP returns
  HTTP 401 and authenticated `initialize` and `tools/list` succeed;
- every declared `allowed_tools` item exists;
- every published MCP tool targets the expected route; public mode has no
  Project connection, while managed mode has the selected Project connection;
- Template publish creates a `local-only-*` Agent;
- that Agent opens in Live session and can execute its business flow.

## Completion checklist

- [ ] Self-contained sample directory under `VoiceAgent/samples/`
- [ ] Portable `agent.json` with no credentials or customer data
- [ ] Explicit `portal/templates.config.json` allowlist entry
- [ ] MCP route/config/token policy selected and documented
- [ ] Catalog, route, browser, and MCP inventory tests updated
- [ ] Portal Reload shows the new Template with no catalog errors
- [ ] MCP readiness and tool inventory pass
- [ ] `local-only-*` Agent publishes and runs successfully
- [ ] README and dated validation evidence updated
