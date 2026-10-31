# Example 3: Elevator Service with Safety, Zendesk, and Handoff

## Conclusion

This sample publishes a fictional inbound elevator-service Voice Agent through
the preview `azure-ai-projects` unified Agents API. It demonstrates:

- a 9-node, 17-edge handoff graph;
- one shared policy inherited by every node, with only node-specific workflow
  instructions authored in each node;
- concise, specific emotional acknowledgement before the next workflow step,
  without invented emotions, facts, promises, or tool results;
- a deterministic five-question safety check;
- filesystem-backed mock Zendesk create and exact-ID status-query contracts;
- caller-visible ticket review and explicit confirmation before creation;
- caller-safe ticket responses;
- browser human-follow-up fallback;
- runtime-owned telephony transfer when the hosting platform injects
  `transfer_call`.

The committed `agent.json` is portable. It contains no MCP URL, Project
connection ID, bearer token, subscription ID, tenant ID, or real customer data.
Its top-level `instructions` hold the shared safety, truthfulness, and
conversational-response policy. Every handoff node enables
`inherit_from_base_instructions`, so its `instructions` contain only the
current node's objective, actions, and completion condition.
The sample and Portal publishers expand that inheritance at the publication
boundary for Foundry service deployments that do not yet accept the inheritance
field. The authored definition stays concise while the deployed Agent receives
the same combined instructions.
The default Portal Template uses the public no-auth `/mcp/elevator-service`
endpoint. It requires no local MCP, Dev Tunnel, setup script, local E2E, or
RemoteTool connection. The implementation in this repository's `shared_mcp`
is an optional customer-owned development/hosting path, not Portal setup.

## When to use this example

Use this example to study an inbound field-service workflow where safety,
external writes, status reads, and human escalation require different tool
scopes.

Use Example 1 for a larger outbound Finance handoff graph. Use Example 2 for a
flat MCP-only Finance Agent.

## Workflow

```text
open_call
  -> intent_router
     -> report_issue
        -> next_request
        -> human_handoff
     -> query_issue
        -> next_request
        -> human_handoff
     -> human_handoff
  -> finalize / human_finalize
  -> end
```

The report path does not create a Zendesk ticket immediately after collecting
an address. It first asks:

```text
Please confirm: I will create a Zendesk ticket for [issue summary]
at [address], postal code [postal code]. Is that correct?
```

Only an explicit approval permits `mock_zendesk_create_ticket` with
`caller_confirmed=true`.

The query path requires only the exact Zendesk ticket ID. It deliberately does
not ask for a ZIP code that the backend does not use for authorization.

## Try these turns

- To check an existing ticket, ask "What is the status of ticket 15?" The test
  ticket is open: the elevator door intermittently fails to close.
- To report a new fault, say "The elevator doors won't close." Answer "No" to
  each safety question.
- When asked for the location, give "100 Example Avenue", postal code "98052",
  then say "Yes" to create the ticket.

## MCP contract

The Agent declares these seven business tools:

```text
start_service_call
record_issue
assess_safety
mock_zendesk_create_ticket
mock_zendesk_get_ticket_status
request_human_handoff
end_service_call
```

The selected MCP server may expose the additional diagnostic tool
`get_call_state`, but it is not available to the Agent graph.

The default [Portal allowlist](../../portal/templates.config.json) uses
`connection_mode: public`; start the [Portal](../../portal/README.md), load this
Template, and choose **Try it now**. No generated local MCP config is needed.

## Configure the CLI sample

This is the optional customer-managed CLI path. It still needs an MCP URL and
Project connection. If you choose locally hosted MCP, run the local E2E to
generate `shared_mcp/config/generated/example3.local.env`; if you use an
already deployed MCP, select its managed configuration instead. Dev Tunnel is
only needed for the locally hosted option.

```bash
cd /path/to/Cognitive-Speech-TTS/VoiceAgent/samples/example3_elevator_service_with_safety_zendesk_and_handoff
[ -f .env ] || cp .env.example .env
```

Set the Project endpoint, then select the generated managed MCP config:

```dotenv
AZURE_AI_PROJECT_ENDPOINT=https://<account>.services.ai.azure.com/api/projects/<project>
VOICE_AGENT_MCP_CONFIG=../../shared_mcp/config/generated/example3.local.env
```

Use `AZURE_CREDENTIAL_MODE=default` for `DefaultAzureCredential`, or `cli` when
the sample must use the identity selected by `az login`.

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

## Publish and verify

```bash
python sample.py publish
python sample.py check
```

The publisher materializes the environment-specific Agent name, model, MCP
server URL, and Project connection ID without modifying `agent.json`.

## Run

Check session readiness:

```bash
python sample.py connect
```

Exercise an exact-ID status query:

```bash
python sample.py run \
  --message "Check Zendesk ticket 15." \
  --expect-handoff \
  --expect-mcp \
  --evidence-file validation/elevator-service-status-smoke.json
```

Ticket `15` is committed fictional mock data.

## Portal

The Portal Template is named:

```text
Example 3: Elevator Service with Safety, Zendesk, and Handoff
```

Reload Templates after changing the allowlist or `agent.json`. The Portal
publishes a `local-only-elevator-service-example` Agent in the selected Project.

`/mcp/elevator-service` always uses replica-local fictional ticket data. Local
state survives a native MCP process restart while its state directory remains,
but Azure Container Apps restarts or revisions can reset `/tmp` state. The
`mock_zendesk_*` names make that boundary visible in the Agent definition and
MCP inventory. To replace the mock with a customer-owned Zendesk adapter, keep
the same backend contract and follow
[the Zendesk integration guide](../../docs/integration_zendesk.md).

## Telephony boundary

The portable definition does not statically declare `transfer_call`. Real
telephone transfer is a hosting-platform capability:

```text
telephony binding
  -> configured transfer target
  -> runtime injects transfer_call
  -> model requests logical target
  -> provider executes transfer
```

This keeps the Portal/browser human-follow-up path from emitting an unhandled
telephone function call. A deployed runtime must preserve ingress-owned
call-control tools in the active graph node.

## Limitations

- The sample does not provision a Foundry Project, model deployment, Zendesk
  tenant, Logic App, or telephone number. The Portal does create or update the
  MCP connection after the customer selects a Project.
- Exact-ID ticket query is test-only until trusted caller and ticket-ownership
  authorization are added.
- The filesystem state model is not durable across Azure Container Apps
  replica or revision replacement and is not production multi-region storage.
- `request_human_handoff` records follow-up; it is not a PSTN transfer.
- Telephony transfer requires a real phone session and a compatible hosting
  runtime.
- Re-running publish creates another immutable Agent version.
- Cleanup is intentionally manual to avoid deleting an unrelated Agent.

## Template versions

The root [`agent.json`](agent.json) is the only version: revised candidate-04,
using `gpt-realtime` and 400 ms Semantic VAD, chosen because it performed best
in hands-on use. Acknowledgement and waiting failures observed in candidate-03
are not proven fixed, and live latency and listening have not been validated.
Earlier versions were removed on 2026-10-21 and remain in Git history.
