# Foundry GPT Live samples

English-teacher GPT Live voice agents in an existing Foundry project, built with the
preview Azure AI Projects SDKs. Both versions create or reuse the agents, stream microphone
audio through a GPT Live session, and show the teacher's and your transcripts beside a
Delegation view. Both cover all three delegation types: Responses, a versioned Foundry-managed
prompt agent, and client delegation, where the app answers GPT Live itself. Every agent has a
template greeting and structured inputs (the learner's name and English level) that each
session fills in.

| Folder | Sample |
| --- | --- |
| [`python/`](python/README.md) | Terminal samples with the Python SDK: Responses delegation, managed prompt-agent delegation, a managed prompt agent with MCP and local function tools, and client delegation. |
| [`js/`](js/README.md) | A simple browser sample with the JavaScript SDK: the page connects to GPT Live directly with your microphone, and a local Node.js server creates the agents and gives the page an access token from `az login`. Its modes cover Responses, managed prompt-agent (with the MCP calculator and local date/time function), and client delegation. |

The GPT Live APIs are not in a PyPI or npm release yet, so each sample installs a bundled
preview SDK build from [`dist/`](../../dist/README.md).

## Shared settings

Both samples read `samples/gpt_live/.env`. From the repository root, in PowerShell:

```powershell
az login
if (-not (Test-Path -LiteralPath samples\gpt_live\.env)) { Copy-Item samples\gpt_live\.env.example samples\gpt_live\.env }
```

Set `FOUNDRY_PROJECT_ENDPOINT` and, for new agents, `GPT_LIVE_DEPLOYMENT` and
`RESPONSE_DELEGATION_DEPLOYMENT`. Set `AGENT_NAME` to reuse an existing GPT Live agent in
the Responses-delegation samples; the managed prompt-agent samples always create fresh
agents. Authentication uses your `az login` account; no API keys are needed. Never commit
`.env`.
