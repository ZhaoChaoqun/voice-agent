# Voice Agent in Foundry Agent Service - Community Hub
[Voice Agent in Foundry Agent Service](https://learn.microsoft.com/en-us/azure/foundry/agents/quickstarts/prompt-voice-agent?pivots=portal) offers below key values to customers:


> Build and launch an enterprise-ready voice agent in under two minutes. Choose speech-to-speech or cascaded pipelines powered by OpenAI, Microsoft AI, and Azure real-time models.  Extend your agent with Foundry tools, monitor and measure its performance, and connect inbound and outbound calls through Teams and Twilio. Create engaging conversations with voices optimized for call centers and lifelike avatars.

This repository is the official community hub for Voice Agent in Foundry Agent Service. Here you'll find:

🐛 Report Issues — File bugs, feature requests, and feedback via [GitHub Issues](https://github.com/microsoft/voice-agent/issues)

📚 Resources — Curated links to docs, videos, blogs, and community content for Voice Agent

🧪 Samples — Hands-on samples and extended solutions

## What's New ![New](assets/whats-new-animated.gif)

Voice Agent is now available in **public preview**, making voice a first-class modality in Foundry Agent Service. We've received great feedback from customers and are working with them to move their voice agents into production as we prepare for general availability (GA).

# Voice Agent and Voice Live

[Voice Live](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live) is the foundation for real-time voice interaction, and Voice Agent builds on that foundation to deliver complete voice-first agents. Voice Live handles the real-time voice experience, while Voice Agent adds the intelligence, tools, knowledge, and orchestration required to build end-to-end agentic applications.

![Architecture comparison: Voice Live with a direct LLM versus a managed Voice Agent in Foundry, retaining the voice pipeline and tool-call flow while adding agent management capabilities.](assets/voice-live-to-voice-agent.png)

**We recommend that customers using Voice Live with a direct LLM migrate to Voice Agent.** Voice Agent builds on Voice Live capabilities rather than replacing them: keep your real-time voice experience, speech recognition and synthesis, turn-taking, interruptions, and local function calls, while gaining a managed, named agent in Foundry.

Migration is about gaining agent capabilities, not giving up Voice Live features. Voice Agent adds reusable, versioned configuration, built-in orchestration, Foundry tools and connectors, knowledge integration, conversation state management, observability, evaluation, and agent lifecycle management. Check model, voice, region, and access availability for your target Foundry Project before migrating; feature availability and configuration depend on the selected pipeline.

Start with the [Voice Live to Voice Agent migration sample](samples/voice_live_to_voice_agent/README.md), which preserves the same speech pipeline, settings, and client-executed local function handler before and after migration.

For new voice-first applications, start with Voice Agent. Direct Voice Live remains an option when you deliberately need to manage your own agent stack and low-level orchestration.

## Quick Links

| Resource | Description |
| --- | --- |
| [Product home page](https://azure.microsoft.com/en-us/products/ai-foundry/agent-service) | Explore Foundry Agent Service, including voice capabilities. |
| [New Foundry portal — Create & manage agents](https://ai.azure.com/nextgen) | Create and manage voice agents in the new Foundry portal. |
| [Documentation & quickstart](https://learn.microsoft.com/en-us/azure/foundry/agents/quickstarts/prompt-voice-agent?pivots=portal) | Create a voice-based prompt agent, customize its instructions, and test spoken conversations. |
| [Configure a voice agent](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/configure-voice-agent) | Configure your voice agent's behavior and voice settings. |
| [Use a hosted agent as the conversation engine](https://learn.microsoft.com/en-us/azure/foundry/how-to/voice-first-with-hosted-agent) | Use a hosted agent for conversation logic and tools, while Voice Live handles speech, turn-taking, and interruptions. |
| [Use a subagent in a voice-based agent](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/use-subagent-voice-first-agent) | Delegate specialized requests to prompt or hosted subagents in the same Foundry project. |
| [Voice Agent tracing, monitoring & evaluation](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/voice-agent-observability) | Monitor voice sessions and evaluate conversation transcripts using datasets, traces, or simulations. |
| [Pricing & billing](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/voice-agent-pricing) | Understand Voice Agent pricing and billing. |
| [Foundry Voice Agent samples](https://github.com/microsoft-foundry/foundry-samples) | [Python](https://github.com/microsoft-foundry/foundry-samples/tree/main/samples/python/voice-agents) · [Java](https://github.com/microsoft-foundry/foundry-samples/tree/main/samples/java/voice-agents) · [JavaScript](https://github.com/microsoft-foundry/foundry-samples/tree/main/samples/javascript/voice-agents) · [TypeScript](https://github.com/microsoft-foundry/foundry-samples/tree/main/samples/typescript/voice-agents) · [C# / .NET](https://github.com/microsoft-foundry/foundry-samples/tree/main/samples/csharp/VoiceAgents) · [Browser voice console](https://github.com/microsoft-foundry/foundry-samples/tree/main/samples/javascript/voice-agents/browser-voice-console) |
| [Extended Voice Agent samples](https://github.com/microsoft/voice-agent/tree/main/samples) | Explore runnable samples and extended solutions. |
| [Voice Agent integration with Teams](https://github.com/Azure-Samples/voicelive-webapp) | [Teams meeting delegate sample](https://github.com/Azure-Samples/voicelive-webapp/tree/main/samples/teams-meeting-delegate) connecting a Foundry Voice Agent and avatar to Teams through Azure Communication Services. |
| [Regions & quotas](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/limits-quotas-regions) | Check the shared Foundry Agent Service region and quota documentation. |
| [Contact the Voice Agent team](mailto:voiceagent@microsoft.com) | Email voiceagent@microsoft.com with questions and feedback. |
| [Python SDK](https://github.com/Azure/azure-sdk-for-python/blob/main/sdk/ai/azure-ai-projects/README.md) | azure-ai-projects for agent management and realtime voice sessions. |
| [Java SDK](https://github.com/Azure/azure-sdk-for-java/blob/main/sdk/ai/azure-ai-agents/README.md#realtime-voice-agent-sessions) | com.azure:azure-ai-agents for voice sessions, conversations, and telephony. |
| [JavaScript / TypeScript SDK](https://github.com/Azure/azure-sdk-for-js/blob/main/sdk/ai/ai-projects/README.md) | @azure/ai-projects for agent management and realtime voice sessions. |
| [C# / .NET SDK](https://github.com/Azure/azure-sdk-for-net/blob/main/sdk/ai/Azure.AI.Projects.Agents/README.md) | Azure.AI.Projects.Agents for voice agent definitions and management. |

In the Foundry portal, open your project, go to **Build > Agents**, select **Build an agent**, and choose **Voice** as the interaction mode.

Voice Agent is now available in public preview. Customers can start building voice agents and preparing for production.

Explore [Voice Agent in Foundry Agent Service](#voice-agent-extended-samples) for voice agent guides, portal links, and runnable samples.

## Voice Agent Videos

**Short demo (720p, 1:38)**

https://github.com/user-attachments/assets/6dc991a6-276a-40f5-b6d4-20100d823ca9

**Full walkthrough (1080p, 15:11)**

https://github.com/user-attachments/assets/c62c179a-f181-4d29-ab99-c84dc6091fdd

## Voice Agent Blogs

- 2026.10 [**Turn enterprise knowledge into a personalized voice and avatar agent in minutes with Voice Agent**](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/turn-enterprise-knowledge-into-a-personalized-voice-and-avatar-agent-in-minutes-/4564809) — Combine Foundry IQ, Personal Voice, and a custom photo avatar to create a knowledge-grounded Voice Agent in the Foundry portal.
- 2026.09 [**Ship agents faster with expanded model choice, voice agents, and continuous optimization**](https://azure.microsoft.com/en-us/blog/ship-ai-agents-faster-with-new-capabilities-in-microsoft-foundry-expanded-model-choice-voice-agents-and-built-in-optimization/) — Overview of the latest Foundry Agents capabilities, including a Voice Agent video overview.
- 2026.09 [**Introducing voice agents in Microsoft Foundry**](https://aka.ms/VoicefirstagentsSept2026) — Voice Agent public preview announcement.
- 2026.06 [**Azure Speech at Build 2026: Powering Voice Agents with Real-Time and Life-like Experiences**](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/azure-speech-at-build-2026-powering-voice-agents-with-real-time-and-life-like-ex/4524638) — Azure Speech updates from Build 2026 for real-time voice agents and lifelike experiences.
- 2025.11 [**Advancing Speech Innovation with Azure Speech in Microsoft Foundry**](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/advancing-speech-innovation-with-azure-speech-in-microsoft-foundry/4471461) — Azure Speech innovations in Microsoft Foundry for conversational AI and voice agents.
- 2025.09 [**Upgrade your voice agent with Azure AI Voice Live API**](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/upgrade-your-voice-agent-with-azure-ai-voice-live-api/4458247) — General availability announcement for Voice Live API, enabling real-time speech-to-speech voice agents.
- 2025.05 [**Voice-enabled AI Agents: transforming customer engagement with Azure AI Speech**](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/voice-enabled-ai-agents-transforming-customer-engagement-with-azure-ai-speech/4413537/) — Voice Live API public preview announcement at Microsoft Build 2025.

## Voice Agent Customer Stories

- [**Help customers get answers and reach the right support with Teams Phone Agent**](https://techcommunity.microsoft.com/blog/microsoftteamsblog/help-your-customers-get-answers-and-support-with-teams-phone-agent/4560840) — Teams Phone Agent helps callers get answers and reach the right support based voice agent stack.
- [**Paytm Applied AI for Merchants and Businesses in India**](https://paytm.com/blog/artificial-intelligence/why-paytm-is-building-applied-ai-not-just-another-chatbot/) — Paytm describes applied AI for merchant workflows, the AI Soundbox, voice, and Indian languages.
- [**Astra Tech brings Voice Live API in Azure AI Foundry to its fintech-first app**](https://www.microsoft.com/en/customers/story/25412-astra-tech-azure-ai-foundry) — Astra Tech uses Voice Live in **botim** for a multilingual voice assistant that helps users complete tasks such as international money transfers. The story reports **300,000 monthly active users and 100,000 daily active users**.
- [**Boosting patient satisfaction with healow Genie and Voice Live API in Azure AI Foundry**](https://www.microsoft.com/en/customers/story/25363-healow-azure-kubernetes-service) — The article describes a Voice Live pilot for **healow Genie**, covering appointment information, common questions, and voicemail callbacks. **Pilot:** It discusses anticipated benefits rather than measured improvements from a completed rollout.
- [**Kansai Television: AI Hachiemon**](https://www.microsoft.com/en-us/ailab/case-study/kansai-television) — Microsoft AI Co-Innovation case study. Kansai Television built a conversational version of its mascot, **Hachiemon**, using Voice Live and Azure AI Foundry. Azure AI Speech Custom Voice recreates the character's distinctive voice for entertainment and interactive experiences.

## Voice Agent Quality And Scalability

### Latency

Speech-to-speech models can achieve latency as low as **500 ms** on service side. Cascaded pipelines (**STT → LLM → TTS**) can also deliver low latency < 1s with the right LLM and streaming speech configuration. Actual latency depends on the model, region, network conditions, and tool calls.

### Speech and model quality

Voice Agent brings together advanced speech and language models, including [GPT Realtime](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live-how-to), [GPT Live](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/gpt-live), Azure speech-to-text and [HD voices](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=text-to-speech), and MAI Transcribe and MAI Voice. Choose the combination that best fits your languages, domain, and conversational experience.  For more resources and samples for Azure Speech HD / MAI voices, visit the [Azure Text-to-Speech repository](https://github.com/Azure-Samples/Cognitive-Speech-TTS).

Recent speech benchmark references:

- **2026.10** [MAI-Transcribe-2-Streaming benchmark results](https://microsoft.ai/news/our-first-streaming-transcription-model/) — Microsoft reports first place for final and partial transcript accuracy on Artificial Analysis in its October 1 announcement.
- **2026.09** [MAI-Transcribe-2 benchmark results](https://microsoft.ai/news/mai-transcribe-2-is-the-fastest-most-accurate-and-cheapest-speech-recognition-model-in-the-world/) — Microsoft reports first place on FLEURS across 60 languages and second place on the Artificial Analysis word error rate leaderboard in its September 3 announcement.
- **2026.06** [Azure LLM Speech benchmark results at Build 2026](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/azure-speech-at-build-2026-powering-voice-agents-with-real-time-and-life-like-ex/4524638) — Microsoft reports first place on the Open ASR Leaderboard for the updated LLM Speech model in its Build 2026 announcement.

### Customization

1. **Speech-to-speech — Azure Realtime:** Custom voices are available **upon request**. Contact [voiceagent@microsoft.com](mailto:voiceagent@microsoft.com) to discuss access. See the [Azure Realtime voice configuration reference](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live-api-reference-2026-06-01-preview) for the publicly documented native voice settings.
2. **Cascaded pipelines — speech recognition and synthesis:** Adapt recognition to your vocabulary and audio conditions with [Azure Custom Speech](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/custom-speech-overview). Create a distinctive voice with [Azure Custom Voice](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/custom-neural-voice), or use [MAI Voice customization](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-voices) to create a voice from a short reference recording through the documented access and consent workflow.

### Scalability

Voice Agent can scale to meet your business needs. Customers are already using it to run **more than 3,000 concurrent sessions** and are continuing to scale. For large-scale deployments with high concurrency requirements, contact us to discuss your capacity and scalability needs.

---

## Voice Agent Extended Samples

### Start here

This directory is the entry point for the Voice Agent portal, runnable samples,
the Finance reference workflow, and its shared MCP service. Detailed setup and
operation instructions live with the component that owns them; this file routes
users and coding agents to the correct entry point.

See [Platform support](#platform-support) for workflow-specific operating-system
requirements.

For an unqualified request such as **"run the UI"**, **"start the portal"**,
or **"open Templates"**, use [`portal/`](portal/README.md). It is the local
Voice Agent UI, runs on `http://127.0.0.1:9527` by default, and uses the public
no-auth MCP configured in `portal/templates.config.json`.

### Local Portal quickstart

The Portal does not require a local MCP process, Dev Tunnel, bearer token, or
Foundry Project connection. **You do not need to start [`shared_mcp/`](shared_mcp/README.md).**
Every Portal Template calls its tools on the public no-auth MCP configured in
`portal/templates.config.json`: Examples 1–4 use their business routes and
Examples 5–34 use mock tool calls on `/mcp/mock-tool-call`. Start `shared_mcp`
only when you deliberately choose customer-owned MCP development or hosting.
`setup-local-examples.sh`, Dev Tunnel installation/login, and local MCP E2E are
**optional, separate workflows**, not Portal setup or release prerequisites.
Using an already deployed MCP does not require Dev Tunnel either. The Finance
CLI samples retain their own managed-MCP configuration requirements.

```bash
az login
cd /path/to/voice-agent/portal
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
[ -f .env ] || cp .env.example .env
# Set AZURE_VOICE_AGENTS_ENDPOINT in .env.
.venv/bin/python demo_server.py
```

Open **http://127.0.0.1:9527**, then verify with:

```bash
curl -fsS http://127.0.0.1:9527/healthz
```

### Choose an entry point

| Goal | Start here | What it owns |
| --- | --- | --- |
| Run the general Voice Agent UI | [`portal/README.md`](portal/README.md) | Agent editor, YAML version editing, Templates, voice playground, and standalone WebRTC page |
| Run Python or .NET samples | [`samples/README.md`](samples/README.md) | Common Python setup, microphone samples, REST lifecycle, IQ, Toolbox, local functions, downloads, and the C# sample |
| Migrate Voice Live to Voice Agent | [`samples/voice_live_to_voice_agent/README.md`](samples/voice_live_to_voice_agent/README.md) | Two Python files with identical STT, GPT-4.1 mini, TTS, and audio settings; move from session configuration to a reusable agent |
| Run realtime speech transcription | [`samples/realtime_stt/README.md`](samples/realtime_stt/README.md) | MAI Transcribe 2 or Azure Speech with VAD, microphone or WAV input, disabled LLM responses, and reported session usage |
| Collect spoken identifiers with digit recognition | [`samples/digit_recognition/README.md`](samples/digit_recognition/README.md) | Server-managed transcript lookup, silent tool calls, complete digit readback, and caller confirmation with GPT Realtime and MAI Transcribe 2 |
| Ask a voice agent about images or camera frames | [`samples/voice_agent_image_input/README.md`](samples/voice_agent_image_input/README.md) | Send uploaded images or sampled camera frames as `input_image` parts in a Voice Agent session; web UI, latency CLI, sizing guidance, and integration patterns |
| Run Data Zone and regional realtime voice agents | [`samples/realtime_datazone_voice_agent.md`](samples/realtime_datazone_voice_agent.md) | East US 2 `gpt-realtime-2.1-datazone` with US inference, Japan East `azure-realtime` with confirmed GPU routing, and eligible Central India `gpt-realtime`; model-specific voices and microphone setup |
| Run the GPT Live terminal samples | [`samples/gpt_live/python/README.md`](samples/gpt_live/python/README.md) | Use direct Responses or managed prompt-agent delegation, create agents and stream microphone audio with the preview Projects SDK, and view independently scrollable GPT Live, delegation, and user transcripts |
| Run the GPT Live browser sample | [`samples/gpt_live/js/README.md`](samples/gpt_live/js/README.md) | Talk to the same Responses or managed prompt-agent English teacher from a browser with your microphone; the page connects to GPT Live directly with the preview `@azure/ai-projects` package, and a small Node.js server creates the agents and gives the page an access token. The managed mode adds the MCP calculator and a local date/time function |
| Run the Finance CLI workflow | [`docs/README.md`](docs/README.md) | Ordered subscription, customer-owned MCP, CLI sample, and debugging guides |
| Work on or deploy the Finance MCP (optional; not needed for the Portal or its Templates) | [`shared_mcp/README.md`](shared_mcp/README.md) | Customer-owned MCP source for the Finance CLI samples, local Dev Tunnel hosting, and Azure Container Apps deployment |
| Create an IQ + voice + avatar Agent | [`samples/create_agent_with_iq_avatar_voice/README.md`](samples/create_agent_with_iq_avatar_voice/README.md) | Portal-first Andrew Dragon HD, Harry Business, Knowledge IQ, and optional Python creation |
| Inspect SDK package information | [`dist/README.md`](dist/README.md) | Public Python and .NET SDK dependencies and historical preview build records |
| Use the coding-agent workflows | [`skills/`](skills/) | Voice Agent creation, IQ/Toolbox provisioning, and local-session debugging |

### Instructions for coding agents

When the user asks to run or debug something from this directory:

1. Verify the environment follows [Platform support](#platform-support) for the
   selected workflow before running commands.
2. Select the component from the table above and read its `README.md` before
   running commands.
3. Treat **UI** without a qualifier as the general [`portal/`](portal/README.md).
4. Treat all Portal Templates as part of the normal local Portal workflow.
   Do not run local MCP setup, Dev Tunnel login, or MCP E2E for this default path.
   Route explicit Finance CLI or shared MCP work to
   [`docs/03_run_samples.md`](docs/03_run_samples.md).
5. Reuse an existing component-local `.env` and virtual environment when they
   are valid. Never copy credentials or endpoints between unrelated `.env`
   files without the user's intent.
6. Start servers as long-running processes, verify their `/healthz` endpoint,
   and report the browser URL and log location. Do not report success merely
   because a process was spawned.
7. Do not silently fall back to mock data or a different Azure Project when
   authentication, endpoint, model, or preview checks fail.

For the default portal route, follow [`portal/README.md`](portal/README.md) to
prepare `portal/.env` and its `.venv`, start `portal/demo_server.py`, then
verify:

```text
GET http://127.0.0.1:9527/healthz
```

Only when the user explicitly chooses the Finance CLI with a locally hosted
MCP, follow [`docs/README.md`](docs/README.md). Its optional local entry point is:

```bash
./scripts/setup-local-examples.sh --project-endpoint "https://<account>.services.ai.azure.com/api/projects/<project>"
cd shared_mcp
./scripts/e2e-local.sh
```

The setup command installs the Dev Tunnel CLI under the ignored
`.local-tools/` directory when it is missing. It also supports
minimal Linux Python installations that provide `venv` but omit `ensurepip`:
each component environment receives its own bootstrapped `pip`. No `sudo` or
system package change is required. Azure CLI must already
be installed and authenticated; Dev Tunnel device-code authentication remains
an explicit user action because setup must not authenticate as an identity the
user did not choose.

### Platform support

**On Windows, WSL2 is required for the Bash-based Finance MCP automation.**
Run that workflow from a checkout in the WSL Linux filesystem, such as
`~/src/`, not `/mnt/c/`, and authenticate Azure CLI inside WSL.
This optional automation is not needed for the Portal; the Portal guide also
provides native Windows PowerShell commands.

**Other standalone Python and .NET samples can run natively on Windows.**
Follow each sample's prerequisites and commands. Bash-only wrappers still need
Bash/Unix tooling or equivalent PowerShell commands.

### Directory map

| Path | Purpose |
| --- | --- |
| [`portal/`](portal/) | General local Voice Agent portal and WebRTC UI |
| [`samples/`](samples/) | Python, .NET, and Finance samples |
| [`docs/`](docs/) | Finance architecture, setup, operation, and debugging guides |
| [`shared_mcp/`](shared_mcp/) | Optional customer-owned MCP for the Finance CLI samples: source, native runtime, container, IaC, and deployment scripts. The Portal does not use it |
| [`scripts/`](scripts/) | Finance CLI setup and authentication helpers |
| [`dist/`](dist/) | Public SDK package information and historical preview build records |
| [`skills/`](skills/) | Reusable coding-agent workflows |
| [`tests/`](tests/) | Offline contracts for the common Projects SDK samples |

### Security and environment boundaries

- Configure only Azure resources and identities the customer is authorized to
  use.
- Never place access tokens, API keys, connection secrets, or customer data in
  source files.
- Use Foundry Project connections or environment-based credentials.
- The portal and samples use Azure Foundry; running the local portal does not run
  the Azure voice service locally.
- Review each component's persistence and recording behavior before using
  sensitive prompts, audio, transcripts, or tool output.

## Voice Live Related Links
| Resource | Description |
| --- | --- |
| [Voice Live samples](https://github.com/microsoft-foundry/voicelive-samples/) | Referrence only. Voice Live Quickstarts and examples for Python, C#, Java, and JavaScript/TypeScript, including Foundry agent integration, MCP tools, and avatars. We recomend starting with Voice Agent now instead of Voice Live  |
| [Call Center Voice Agent Accelerator](https://github.com/Azure-Samples/call-center-voice-agent-accelerator) | Referrence only. A template for speech-to-speech call center agents using Voice Live, with browser and telephony integration and deployment to Azure Container Apps. We recomend starting with Voice Agent now instead of Voice Live. Now Voice Agent has supported Twillio and Teams Phone and we will add more support soon.  |
| [Voice Live overview](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live) | Referrence only. Learn about real-time voice interactions with speech recognition, language models, and speech synthesis. |
| [Hosted agents overview](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/hosted-agents) | Referrence only. Learn how to deploy custom agent applications on managed infrastructure. |
| [Voice Live with hosted agents](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-voice-live-hosted-agent-integration) | Referrence only. Add voice interaction to hosted agents using the Responses or HTTP Invocations protocol; includes Python client and agent examples. |
| [Voice Live Bridge sample](https://github.com/microsoft-foundry/foundry-samples/tree/main/samples/python/hosted-agents/bring-your-own/voice-agent-target-agent/basic) | Deploy a hosted conversation engine and a voice wrapper, with Voice Live handling speech and interruptions. |
| [Build a voice agent with invocations_ws](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/build-voice-agent) | Referrence only. Build hosted voice agents over WebSocket with Voice Live, Pipecat, or LiveKit. |
| [invocations_ws voice agent samples](https://github.com/microsoft-foundry/foundry-samples/tree/main/samples/python/hosted-agents/bring-your-own/invocations_ws) | Referrence only. Explore hosted voice agent code using WebSocket audio streaming or signaling for separate media transport. |
