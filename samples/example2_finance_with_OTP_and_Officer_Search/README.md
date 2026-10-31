# Finance with OTP and Officer Search - Projects SDK sample

Start with the [architecture and documentation index](../../docs/README.md).
To try the Template, use the [Portal](../../portal/README.md) and its public
no-auth MCP. No local MCP, Dev Tunnel, setup script, or local E2E is required.
For the optional customer-managed CLI/local MCP workflow, use
[03: Start and run the samples](../../docs/03_run_samples.md).

## Conclusion

This sample publishes a customer-neutral, flat, MCP-only Finance Voice Agent
through the `azure-ai-projects` unified Agents API and runs a text-only
Voice WebSocket smoke test. It defaults to service-managed `gpt-realtime`,
`azure-speech` input transcription, American English, and business tools for OTP,
loan-offer discussion, explicit interest, loan-officer selection, callback,
and call disposition.

Because the definition has no handoff graph, publication constructs
`VoiceAgentDefinition(mapping)` before calling
`AIProjectClient.agents.create_version(...)`.

The committed `agent.json` is a self-contained wire definition with matching
MCP tool contracts. The customer-owned implementation is included in
`../../shared_mcp`; the internal authoring compiler and the former internal
`/mcp/umw-v3` compatibility route are not required at runtime.

## When to use this example

Use this example to validate a compact flat Agent driven by one MCP tool set:
OTP verification, loan calculation, interest capture, officer assignment or
search, confirmation, and call completion. It has no handoff graph.

Use [Example 1 Realtime](../example1_finance_with_handoff_realtime/README.md) or
[Example 1 Cascade](../example1_finance_with_handoff_cascade/README.md)
instead when the goal is to validate multi-node handoff topology, target
activation, and stage-specific tool access. Both handoff variants and this
example use the same shared MCP service; this example targets
`/mcp/finance-otp-officer`.

## Try these turns

- When asked for your access code, say "12345007". It is the fictional test code.
- When asked what you want to finance, say "A home purchase, about 600,000
  dollars, in three months." The test applicant's indicative limit is 950,000
  dollars.
- When asked for a loan officer, give any name, for example "Michael Brennan".
  The test directory returns one available fictional officer; confirm the name
  the Agent reads back.

## Prerequisites

These prerequisites apply to the optional CLI below, not to default Portal
Templates. The CLI retains its managed MCP URL/connection requirements.

- Python 3.10 or later and Git.
- Access to a Microsoft Foundry Project with a compatible realtime model.
- Permission to create a Project connection and either host the included MCP
  locally through Dev Tunnel or deploy it to Azure Container Apps.
- A local Azure identity with permission to manage and invoke Agents.

If you have only a new Azure subscription, complete
[Set up a Microsoft Foundry subscription](../../docs/01_setup_subscription.md)
before configuring this sample.

After that shared step, this README is the source of truth for this scenario's
MCP connection, `.env`, SDK publication, readback, and runtime validation.

## Deploy the included MCP service

Optional: deploy only if you want to host your own backend. Default Portal
Templates already have a public no-auth MCP. Reuse an existing compatible
customer-owned server/connection instead when available; neither option needs
Dev Tunnel. Local MCP development is the separate option in the
[MCP guide](../../docs/02_mcp_settings.md).

From `../../shared_mcp`, run:

```bash
export AZURE_AI_PROJECT_ENDPOINT="https://<account>.services.ai.azure.com/api/projects/<project>"
./scripts/deploy.sh
```

This deploys the customer-owned container and creates the route-specific
Foundry connection. The bearer token is stored in the Container App and the
Project connection, never in `agent.json` or this sample directory. See
`../../docs/02_mcp_settings.md` for local packaging and deployment details.

## Configure

```bash
cd /path/to/Cognitive-Speech-TTS/VoiceAgent/samples/example2_finance_with_OTP_and_Officer_Search
[ -f .env ] || cp .env.example .env
```

Set the Project endpoint, isolated Agent name, model, and
`VOICE_AGENT_MCP_CONFIG` in `.env`. The local E2E command writes the default
config at:

```dotenv
VOICE_AGENT_MCP_CONFIG=../../shared_mcp/config/generated/example2.local.env
```

Use the Project endpoint created by the subscription setup guide. The selected
MCP config must have been generated for that same Project.

The portable definition uses `model_type: managed` and defaults to
`VOICE_AGENT_MODEL=gpt-realtime`, with 400 ms Semantic VAD silence.
Confirm the Project supports that model rather than silently substituting
`gpt-realtime-2.1`. Keep the same value in the portal `.env`.

`AZURE_CREDENTIAL_MODE=default` uses `DefaultAzureCredential`. Set it to `cli`
only when local validation must use the identity selected by `az login`.

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

The dependency requires `azure-ai-projects>=2.7.0`
from PyPI. No Azure SDK source checkout is required.

## Publish and verify

```bash
python sample.py publish
python sample.py check
```

The `publish` command loads `agent.json`, injects environment-specific model
and MCP references, publishes and enables an immutable version, and verifies
its kind, model, and MCP connection IDs on readback.

## Run

Validate session readiness and the opening response:

```bash
python sample.py connect
```

Run the caller request and provide the synthetic test access code configured
by the target MCP environment:

```bash
python sample.py run \
  --message "Hello, I need to reach my loan officer." \
  --message "12345007" \
  --expect-mcp \
  --evidence-file validation/finance-otp-officer-search-smoke.json
```

`12345007` is a reserved fictional test code. Never replace it in
documentation with a real customer credential.

The included loan-officer name search is deliberately fake: it returns one
random available fictional officer so the portable sample can exercise the
end-to-end flow without the production phonetic-search dependency.

The client prints turn indexes, not message contents. It does not capture a
microphone or play audio; it validates the published Voice Agent, MCP, and
model response path over the production Voice WebSocket protocol.

`sample.py` is the single Python entry point for publication, readback, session
connection, and text turns. `agent.json` remains separate because the local
template dashboard also consumes that definition directly.

## Debug

Use the shared [`debug-local-session` Skill](../../skills/debug-local-session/)
for Project/model publication, OTP/officer MCP, portal, or recorded-session
failures:

```bash
cd VoiceAgent
python skills/debug-local-session/scripts/analyze_session.py --list
python skills/debug-local-session/scripts/analyze_session.py <session-id>
```

The Skill knows this example targets `/mcp/finance-otp-officer` and correlates
the Foundry MCP item ID with the OTP/officer business state.

## Boundaries

- The sample does not create the Foundry Project or deploy the model.
- Project connection provisioning is a management-plane prerequisite.
- The Finance OTP and officer-search backend is included under `../../shared_mcp`;
  deployment remains a separate customer-owned step.
- Name search is a fake random implementation and the filesystem state store is
  not production-grade.
- Re-running publish creates another immutable Agent version.
- Cleanup is intentionally manual to avoid deleting an unrelated Agent.

## Template versions

The root [`agent.json`](agent.json) is the only version: revised candidate-03,
using `gpt-realtime` and 400 ms Semantic VAD, chosen because it performed best
in hands-on use. Its earlier evaluation still noted repeated messages,
premature pricing and added waiting, and the evaluated MCP backend did not
persist incomplete or invalid OTP state. Earlier versions were removed on 2026-10-21 and remain in Git history.
