# Finance with Handoff - Cascade

## Overview

This sample owns the Cascade Finance template: an outbound personal-loan call
that verifies the customer, negotiates an indicative offer, discloses charges,
captures credit-bureau consent and books a loan-officer appointment. Its root
[`agent.json`](agent.json) uses `gpt-4.1-mini`, `azure-speech` transcription and `en-IN-Diya:DragonHDLatestNeural`, with 400 ms Semantic VAD and, like Realtime, no Smart Turn end-of-utterance detection.

The [Realtime sample](../example1_finance_with_handoff_realtime/README.md)
has its own directory and version history. Portal template IDs and Agent names
remain `finance-example-realtime` and `finance-example-cascade-luna`.

## Call flow

The greeting identifies Virtual Finance and the generic purpose. When the
customer first speaks, the call enters identity verification directly; there
is no dial assessment, IVR navigation or voicemail stage.

```text
rpc -> offer -> offer_decision -> charges_consent -> appointment -> offer_summary -> end
         \________________ wrap_up (decline, failed check, end request) _________/
```

| Stage | Behaviour |
| --- | --- |
| `rpc` | Silently calls `start_call`, asks "Am I speaking with <first name>?", then the date of birth, and calls `confirm_right_party`. |
| `offer` | Prices and negotiates with `calculate_indicative_loan_offer`; only an explicit "I accept" or "I decline" after the final readback is a decision. |
| `offer_decision` | Records the exact words with `record_customer_offer_decision`. |
| `charges_consent` | Calls `present_charges`, then speaks the charge disclosure and the credit-bureau consent question as one message, and records the answer with `capture_bureau_consent`. |
| `appointment` | Books phone or onsite with `schedule_callback` and records `qualified_lead`, silently. |
| `offer_summary` | Recaps the offer and appointment from `prepare_offer_summary`. |
| `wrap_up` | Records the non-qualified outcome with `set_disposition`. |
| `end` | Calls `end_conversation` only. |

The greeting thanks the customer; when they first reply, the transfer into
`rpc` explains the purpose and the identity check. After the recap the agent
asks whether anything else is needed. Every edge into `end` speaks the fixed
closing "Thank you for your time. Goodbye.", so the customer always hears it
before the call ends. The charge
disclosure shares the consent question's message because the Realtime model
dropped it when it had to speak and hand off in the same response.

Realtime and Cascade share the same graph, greeting and shared prompt; when the
two runtimes favoured different spoken styles, the Realtime choice was kept.
Cascade waits for an LLM call on every tool and handoff, so it alone adds
latency cover: a short spoken lead-in before confirming the date of birth,
recording consent and booking; rotating static interim responses on offer
pricing; and transfer messages into charges, the appointment and the recap.
This cut silent waiting in text-driven accept-and-book calls from about 53 s
to 37 s per call. Realtime answers quickly enough without it.

## Conversation style

The shared prompt asks the agent to respond first to what the customer just
said, especially a worry, correction, hesitation or frustration, in one short
specific clause, then take one next step. "I understand" or an apology alone
does not count, and the agent must not invent feelings or praise. The opening
thanks the customer, explains the identity check, and asks for the date of
birth "to keep your account secure". Tool amounts are sent as plain integers
of rupees.

## Try these turns

- When asked whether you are Mengyou, say "Yes, this is Mengyou."
- When asked for your date of birth, say "1 January".

## Configure and run

**Default Portal path:** start the [Portal](../../portal/README.md) and load
**Example 1: Finance with Handoff - Cascade**. It uses the public no-auth MCP;
no local MCP, Dev Tunnel, setup script, or local E2E is required.

The commands below are the optional Finance CLI path, which retains its managed
MCP URL/connection requirements. Dev Tunnel is needed only if you choose to
host that MCP locally; an already deployed MCP needs no tunnel. Follow the
[setup guide](../../docs/01_setup_subscription.md) and
[MCP configuration guide](../../docs/02_mcp_settings.md), then:

```bash
cd samples/example1_finance_with_handoff_cascade
[ -f .env ] || cp .env.example .env
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

Set your Foundry Project endpoint in `.env`. Both Finance handoff runtimes use
`../../shared_mcp/config/generated/example1.local.env` and the
`/mcp/finance-handoff` route. Portable definitions contain no endpoint,
connection credential or test Agent name. Existing ignored local files under
the former combined directory are left untouched.

```bash
.venv/bin/python sample.py publish
.venv/bin/python sample.py check
.venv/bin/python sample.py connect
.venv/bin/python sample.py run \
  --message "Hello, who is calling?" --expect-handoff --expect-mcp
```

The SDK publisher verifies the exact graph and MCP readback. The CLI uses
real Voice WebSocket text turns; it does not establish audible latency,
listening quality or VAD safety. Cloud calls may incur charges. See the
[run guide](../../docs/03_run_samples.md).

## Template versions

In Portal **Load from templates**, choose **Example 1: Finance with Handoff -
Cascade**. The root [`agent.json`](agent.json) is its only version. Earlier versions were removed on 2026-10-21 and remain in Git history.

## Validation

Business rework: 12 of 12 text-driven Voice WebSocket conversations passed
deterministic checks (accept-and-book and a decline flow with a worry, a
correction and frustration, three times per runtime): `start_call` first,
charges spoken, tools in business order, closing spoken and
`end_conversation` completed. The current defaults passed the same checks.

Fluency used the existing Luna judge (`fluency-first`) on the worry,
correction and frustration turns, three repeats each:

| Version | Realtime pass, score | Cascade pass, score |
| --- | --- | --- |
| Business rework, before fluency changes | 5/9, 3.78 | 7/9, 4.81 |
| Default | 6/9, 4.69 | 7/9, 4.89 |

Most remaining judge failures add a period question after answering a rate
question. Text turns do not establish audio quality, latency under real
speech recognition, or VAD behaviour.
