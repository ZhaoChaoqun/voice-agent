# Finance with Handoff - Realtime, Hindi (India)

## Overview

This is an independent Hindi version of the [English Realtime sample](../example1_finance_with_handoff_realtime/README.md).
The English sample is unchanged. The business instructions remain in English;
the customer speaks and hears Hindi.

The [Agent definition](agent.json) retains `gpt-realtime-regional`. It selects
Azure Speech transcription with `language: hi-IN` instead of Whisper so that the
input explicitly uses the India Hindi locale. Output uses Diya Hindi Dragon
(`hi-IN-Diya:DragonLatestNeural`), inherited by all nodes.
Every handoff node has the Hindi response policy. Fixed greetings, transfer
messages, disclosures, and decision phrases are also Hindi.

The graph, tool names, argument keys, policy gates, and silent tool-call behavior
match the English Realtime sample. `spoken_words` and `date_of_birth` preserve
the original Hindi evidence; the Agent must not translate audit evidence into
English. Exact numeric digits from tools are retained for Hindi TTS rather than
asking the model to rewrite loan figures as Hindi words.
The [shared MCP source](../../shared_mcp/README.md) includes Hindi date
and explicit end-request handling. A separately hosted MCP must include these
changes before using Hindi birthday verification or early termination.

## Try these turns

- When asked whether you are Mengyou, say "हाँ, मैं Mengyou बोल रहा हूँ।"
- When asked for your date of birth, say "एक जनवरी।"
- To accept the final offer, say "मैं स्वीकार करता हूँ।"
- To authorize the credit-bureau check, say "मैं सहमति देता हूँ।"
- To decline, say "मैं अस्वीकार करता हूँ।"
- To request an early end, say "कॉल बंद कर दीजिए।"

## Configure and run

**Default Portal path:** start the [Portal](../../portal/README.md) and select
**Example 1: Finance with Handoff - Realtime (Hindi, hi-IN)**. The public no-auth
MCP is already configured; local MCP hosting, Dev Tunnel, setup scripts, and
local E2E are not required.

The following CLI workflow is optional and retains its generated managed MCP
configuration requirements. Dev Tunnel applies only to a locally hosted MCP,
not an already deployed server. Follow the [setup guide](../../docs/01_setup_subscription.md) and
[MCP configuration guide](../../docs/02_mcp_settings.md).

```bash
cd samples/example1_finance_with_handoff_realtime_hi_in
[ -f .env ] || cp .env.example .env
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

Set your project endpoint in `.env`. The same generated Finance MCP configuration
is used as in the English samples. The default Agent name is
`finance-example-realtime-hi-in`, so publication does not overwrite the English
Agent. Do not set `VOICE_AGENT_NAME` to the English Agent's name.

```bash
.venv/bin/python sample.py publish
.venv/bin/python sample.py check
.venv/bin/python sample.py connect
.venv/bin/python sample.py run \
  --message "नमस्ते, कौन बोल रहा है?" --expect-handoff --expect-mcp
```

In Portal, select **Example 1: Finance with Handoff - Realtime (Hindi, hi-IN)**.
The [Cascade Hindi sample](../example1_finance_with_handoff_cascade_hi_in/README.md)
has its own Agent name and retains Cascade's spoken waiting messages.

## Validation scope

The CLI sends text, not microphone audio. A successful text run does not establish
Hindi speech recognition, synthesis, or pronunciation quality. Validate audio
input/output separately before relying on business-flow text tests.

## Conclusion

This sample changes the conversation language to Hindi while retaining the
English Realtime sample's business workflow and leaving its files untouched.
