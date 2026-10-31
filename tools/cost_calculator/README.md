# Voice Agent Cost Lab

Standalone browser calculator with **South India / USD / pay-as-you-go**
model-price references.
Compare managed Voice Agent / Voice Live tiers and **bring your own model
(BYOM)** using list-price estimates.
BYOM models and GPT Live use **South India Global** prices from Azure OpenAI.
**Azure HD voice uses Central India rates** as requested. No South India
Voice Live tier or BYO speech meters were found, so managed tiers and BYO STT
also use the approved, explicitly labeled **Central India references**.
No Azure credentials, packages, build step, or live model calls are needed.

## Run

With Node.js 20 or later, from the repository root:

```powershell
node tools\cost_calculator\server.mjs
```

Open **http://127.0.0.1:8095**. To change the port, set `$env:PORT = "8096"`
before running the command. The server listens only on the loopback interface.
Stop it with Ctrl+C. Opening `index.html` as `file://` will not work because
the page loads modules and the local price snapshot.

Choose hosting, pipeline, and model; change call assumptions or deployment
rates. The tool shows per-call, per-minute, call-volume list prices, component costs, and
comparisons at **0, 1K, 5K, 10K, and 20K** system-prompt tokens. Export CSV
includes list-price amounts, assumptions, overrides, snapshot date, and
component reference regions, processing scopes, and meter IDs.
The CSV also distinguishes managed-tier pricing from AOAI Global economic
references when a model has no published managed tier.
Changes are in memory only and reset on reload.
The pipeline comparison always shows **USD per minute**, using the full call
duration. The per-call/per-minute selector affects only the prompt-sensitivity
chart. CSV export retains both per-call and per-minute amounts.

## Deploy

This is a static page: calculations run in the browser and `prices.json` is
bundled with the page. The Node server is for local preview only.

The [Pages workflow](../../.github/workflows/cost-calculator-pages.yml)
checks calculator changes in pull requests and publishes the site when those
changes merge into `main`. It can also be run manually from `main` in the
Actions tab. Pull requests and other branches cannot deploy.

The repository must have **Settings > Pages > Source > GitHub Actions**
enabled. The deployment publishes exactly `index.html`, `styles.css`,
`app.mjs`, `calculator.mjs`, `prices.json`, and the voice-wave `favicon.svg`
at the site's root, excluding
the local server, tests, documentation, and all other repository files.
No dependency installation or build command is needed. All asset URLs are
relative, so the page works under a repository subpath.
During deployment, the workflow stamps the footer with the short commit hash
and a link to that exact source commit. Local previews show
**Local preview (not deployed)** instead.

For this repository, the published address is
**https://microsoft.github.io/voice-agent/** after the first successful
deployment. The site is public; do not add confidential data or credentials.

**Azure Static Web Apps** is an alternative, especially when access control
is required. Set the app location to this tool's directory, leave the API
location empty, and deploy the existing assets without a build. Configure
authentication and route access rules if the page must not be public.

Deploy only the six browser assets above; no server, credentials, or live
Azure connection is needed. Pricing updates require updating the snapshot
and redeploying.

## Price basis

`prices.json` is a **2026-10-22 snapshot**, not a live price feed, from the
[Azure Retail Prices API](https://prices.azure.com/api/retail/prices).
It records original billing units, exact USD prices, meter IDs, filters, and
effective dates where returned. Rates per 1K are multiplied by 1,000 for the
calculator's USD-per-million fields.
The GPT Live meter is hourly and is divided by 60 for USD-per-minute pricing.

- Managed models use Central India's Pro, Standard, or Lite **Voice Live
  meter references**, not
  direct OpenAI model API prices. GPT Realtime 2.1 uses the Pro text-output-2
  meter; `gpt-realtime` uses the original output meter.
- **Azure Realtime** uses the documented Voice Live **Pro** tier.
  **Azure Realtime Fast** uses a **user-specified Lite-tier reference**,
  not a verified published Fast tariff. Both use **native speech-to-speech
  billing**: tier-specific text and native audio input/output meters, including
  replayed audio history, with no separate STT or Azure HD charge. Both use the
  existing Central India tier meters and appear in managed native
  speech-to-speech selection, comparison, and CSV export.
  Neither adds a GPT Live session charge; no BYOM or alternate-pipeline prices are
  inferred from GPT models. Fast's assumption is labeled in the UI and CSV.
  The editable audio tokens/second remain planning assumptions, not verified
  Azure Realtime-family tokenization. No price-snapshot refresh is required
  for these existing tier meters.
- When no managed tier is published, use the exact model's **AOAI Global
  inference prices + Central India BYO speech** as an economic reference.
  This fills GPT-5.4 mini/nano, GPT OSS 120B, and GPT-6 Sol reference scenarios.
  The UI and CSV explicitly label these **not confirmed managed Voice Live
  tariffs**. A model price does not prove managed Voice Agent availability.
- Azure HD uses the **Central India** Voice Live standard-speech output meter. This is not
  standalone Speech's character-billed HD price.
- BYOM uses **Central India Voice Live BYO standard-speech input/output**
  references plus the selected model's **South India Global** deployment
  prices. GPT-4.1, GPT-5.1, GPT-5.2, GPT-5.4, GPT Realtime 1.0/1.5/2.1,
  GPT Realtime 2.1 mini, GPT OSS 120B, and GPT-6 Sol are prefilled from the
  published South India meters. Global describes processing scope, not a
  promise of India-only inference.
- **GPT-5.6 Luna BYOM** uses South India Global short-context Standard
  inference prices: **$0.20 input / $0.02 cached input / $1.20 output per
  1M tokens**, verified on 2026-10-26. These three meters record their own
  retrieval date; the remaining snapshot retains its original date.
  Luna is available for the text-LLM cascade and GPT Live backend scenarios,
  with Central India BYO speech rates for the cascade. Managed-mode rows
  use the existing explicitly labeled Global-model/BYO-speech reference,
  not a verified managed Luna tariff. Long-context, Flex, Priority, and
  cache-write rates are not substituted.
- **GPT-6 reasoning is explicitly GPT-6 Sol**, using South India Global
  short-context Standard prices: **$2 input / $0.20 cached input / $10 output
  per 1M tokens**. The generic, unspecified GPT-6 placeholder is replaced
  with the exact priced variant. Reasoning tokens use its output rate.
- No cached OSS price was found, so replayed OSS text uses its full input
  rate. You can explicitly override that conservative assumption.
- **GPT Live (`gpt-live-1`) voice sessions:** Azure OpenAI Media's `Live 1 Gl Unit`
  meter lists **$3/hour = $0.05/minute** for South India Global, effective
  2026-09-01. Meter ID: `2e5b0a5c-3723-50a8-ba75-a5473f702fc1`. This is the
  South India Global reference, **not a Central India rate or an
  availability guarantee**. A 90-second session costs **$0.075 for voice**,
  before separately billed backend model usage.
- Other missing deployment prices require **manual rates**. No price is inferred
  from the supplied reference comparison table or substituted from another
  model or provider. Cross-region Voice Live references are shown explicitly.
  GPT Live uses a separately priced backend deployment regardless
  of the hosting selector, plus the Azure OpenAI session-minute reference.
- **Blank means unknown**, not zero. Missing model or speech prices block
  complete totals until the required list rates are entered.

Selection is an economic scenario, **not proof of model, transport, or Voice
Agent availability in South India**. In particular, a BYOM native-audio
scenario requires confirmation of API support and deployment prices.
Provisioned-throughput and dedicated hosting charges are not modeled.

References: [Voice Live tier mapping and usage](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live),
[Speech list pricing](https://azure.microsoft.com/en-us/pricing/details/speech/),
[Azure OpenAI pricing](https://azure.microsoft.com/en-us/pricing/details/azure-openai/),
[Voice Agent billing](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/voice-agent-pricing).

To refresh the snapshot, rerun its two recorded OData filters with
`currencyCode='USD'`, follow every `NextPageLink`, and review the exact meter
names and units before replacing the file. Do not silently mix regional,
Global, Data Zone, Batch, or fine-tuning meters.

## Assumptions and formulas

Defaults use the supplied **90-second call**, **4 user + 4 agent
turns**, **45 seconds of speech allocation each before silence**, **100% reused-context caching**,
and **150 agent text tokens**
for text-response pipelines. User transcript length was not supplied:
the calculator explicitly assumes an editable **150 user text tokens**.
Native output text and reasoning tokens default to zero and can be changed.
These defaults are modeling inputs, not measured usage.
Audio defaults follow
[Voice Live's Azure OpenAI estimates](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live#token-usage-and-cost-estimation):
**10 input audio tokens/sec** and **20 output audio tokens/sec**, giving
**450 input** and **900 output** audio tokens before the silence adjustment. Both rates
remain editable for other model families or measured usage.

**Both-parties-silent ratio defaults to 5%** and is editable from 0 to 100%.
This default is a planning assumption, not a universal average.
Multiply each side's entered speech seconds by `1 - silencePercent / 100`
before calculating audio tokens. The default therefore models **42.75 seconds
per side**, **427.5 input tokens**, and **855 output tokens**, with 4.5 seconds
of both-parties silence in the 90-second call.
This scales fresh and replayed native audio, STT, and TTS usage only, not
unit prices. Text, prompt, reasoning, turn count, GPT Live session minutes,
and the full-call per-minute denominator remain unchanged. It is not a
blanket cost discount or a guarantee that silence is unbilled. Set the ratio
to **0%** when entered speech times already exclude silence to avoid double
counting. With smaller baseline speech allocations, the ratio reduces only
those allocations; it does not subtract additional time from the full call.
The summary shows adjusted audio usage; CSV includes `silence_percent` and
the complete assumptions.

Each call starts cold; the system prompt costs `P * input_rate` on its
first turn. Its `P * (turns - 1)` reused tokens are charged at the selected
cache hit rate. With equal turn lengths, each side's total conversation
tokens are replayed `(turns - 1) / 2` times across later turns. Cache misses
use the full input rate. Native mode reuses caller and assistant audio.
Realtime-to-HD mode reuses caller audio and assistant text. Cascade and
GPT Live's reasoning backend reuse user/assistant text. Hidden reasoning is
billed as output but not replayed as visible transcript history.

For each component, `list cost = quantity * USD_per_million / 1,000,000`.
GPT Live voice sessions instead use `call_minutes * USD_per_minute`, in
addition to the turn-based backend model estimate. Real delegation patterns
can differ from this simplified assumption.

Per-minute list prices divide by the full call duration, not just speaking
time. Call-volume estimates multiply the per-call list price by the number
of calls.

The original reference totals are not regression targets: they do not supply
all token prices or context-accounting details and may use different rates.
This calculator recomputes costs transparently rather than fitting those totals.
Actual caching eligibility, audio token rates, silence billing, tool calls,
telephony, storage, network, tax, capacity charges, and model quality are not
captured.

## Checks

```powershell
node --test tools\cost_calculator\calculator.test.mjs
```
