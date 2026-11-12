# AVA - mobile voice banking

A presentation-ready **fictional Commerzbank banking scenario** for iPhone Safari
and desktop browsers. AVA speaks with **GPT Realtime 2.1** and
**`en-US-Harper:MAI-Voice-2.1-Flash`**, with MAI Transcribe 2 input transcription.
It is a concept sample, not an official Commerzbank service or a bank integration.

The warm, conversational [prompt](prompt.md) follows the Lehmann scenario:
a EUR 2,000 overdraft, a requested EUR 5,000 limit after a car repair and utility
bill, a new employer, a pending payslip, and a no-pressure account comparison.
It adapts to what the caller actually says instead of reciting a transcript.

## What the customer sees

- Responsive cream, forest-green and yellow interface, large touch targets,
  reduced-motion support, live captions, mute and end controls.
- Direct WebRTC audio for Safari, with the Python server relaying signaling and
  executing four tightly scoped mock tools. An independent **text + spoken
  replies** mode works without microphone access or WebRTC connectivity.
- A fictional account card and per-call demo inbox. Only successful tool results
  add a request or account-comparison checklist. Ending a call keeps those notes
  visible; starting another or reloading resets them.
- Presenter-code access; no Azure credentials, agent editing controls, document
  uploads or real customer data are exposed to the browser.

Open the HTTPS address in **Safari itself**, not an embedded QR-code or messaging
browser. Enter the presenter code, tap **Talk to AVA**, and allow the microphone.
If Safari requires another playback gesture, tap **Tap to hear AVA**. Keep the
page in the foreground: leaving it or locking the phone ends the call and stops
the microphone. Start again to resume with a fresh fictional account.

## Banking boundaries

The account and verification are fictional. Requests are **not submitted to a
bank**, credit is **not approved**, and the EUR 2,000 limit never changes. Voice
consent is interpreted by the model and required by mock tool arguments; this is
not a sufficient authorization mechanism for real financial actions.

No current Commerzbank price list has been supplied. AVA therefore does **not**
invent account fees, overdraft rates, insurance inclusions or free withdrawals.
The comparison is a checklist of terms to verify, not a quotation or personalized
savings calculation. This intentionally differs from unverified product promises
in a scripted sales example. Review bank-approved terms, disclosures, brand
permissions and a real authorization design before any production integration.

The shared presenter code is a demonstration gate, not customer identity or MFA.
Rotate it after sharing events. Internet-facing production use needs proper
per-user authentication, durable rate limits, consent/retention policies,
approved bank APIs, audited authorization, and operational monitoring.

## Local setup (PowerShell)

Prerequisites: Python 3.11+, Azure CLI signed into an eligible Foundry project,
permission to create/enable a voice agent, and availability of the exact model
and voice. The project is not automatically substituted if unavailable.

```powershell
cd .\samples\banking_ava
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
Copy-Item .env.example .env
# Set the project endpoint and a cryptographically random DEMO_ACCESS_CODE
# of at least 16 characters. Do not commit .env.
az login
.\.venv\Scripts\python agent.py
.\.venv\Scripts\python server.py
```

Open `http://127.0.0.1:8080`. `agent.py` publishes only the separately named AVA
agent, never the existing WebRTC sample's agent. Subsequent runs reuse its
matching definition. After reviewing a prompt edit, explicitly publish it with
`agent.py --update`. The public web server cannot create or edit an agent.

The server imports the repository's existing Azure CLI/managed-identity
authentication helper from `..\foundry_voice_webrtc\auth.py`. Keep both paths
when running outside the repository. Azure tokens stay on the backend.

## Azure Container Apps deployment

Reuse an existing ACA environment and ACR in the same resource group. The script
creates only a separately tagged AVA app, a pull identity, and scoped role
assignments. It refuses to overwrite an app belonging to another sample.
It leaves the current Azure CLI default subscription unchanged.

```powershell
.\deploy-azure.ps1 `
  -Subscription YOUR-SUBSCRIPTION-ID `
  -ResourceGroup YOUR-EXISTING-RESOURCE-GROUP `
  -EnvironmentName YOUR-EXISTING-ACA-ENVIRONMENT `
  -RegistryName YOUR-EXISTING-ACR `
  -FoundryResourceId /subscriptions/SUB/resourceGroups/RG/providers/Microsoft.CognitiveServices/accounts/RESOURCE
```

Provision the agent first. ACR builds from an explicit file allowlist; `.env`,
recordings, tests and unrelated repository files are never uploaded. The app
runs as non-root, uses system-assigned identity for Foundry, and a separate
user-assigned identity for ACR pull. The presenter code is an ACA secret.
The script needs ACR build, deployment and role-assignment permissions.

One warm replica avoids cold starts and keeps the in-memory limit of four
simultaneous calls meaningful. Each authenticated browser can have one call;
calls end after ten minutes. Login is limited to thirty attempts per minute per
replica. These limits reset on restart. Hosting and inference incur charges.
Scale to zero or remove **only this sample's app** after the demonstration if
it is no longer needed; do not delete the shared environment or registry.

App-managed recordings are disabled (`store=false`); audio/text still go to
Azure AI and are subject to the service's policies. No transcripts are written
to app logs or browser storage. Browser captions may contain interrupted text
and are not an authoritative bank record. Notes are not durable bank documents.

## Validation

```powershell
.\.venv\Scripts\python -m unittest discover -s . -p "test_*.py"
npm ci
npx playwright install chromium webkit
# Keep the local server running for the browser checks.
npm test
# Opt-in paid inference: exact model/voice, real synthesized audio, banking tools.
.\.venv\Scripts\python smoke.py --url https://YOUR-APP.azurecontainerapps.io
# Opt-in paid WebRTC check at phone size, with a simulated microphone.
$env:AVA_TEST_URL = "https://YOUR-APP.azurecontainerapps.io"
npx playwright test -c playwright.live.config.cjs
```

Browser tests cover desktop, iPhone-sized WebKit, narrow screens, denied
microphone access, safe captions, inbox updates and restart cleanup. The main
browser tests mock the voice service; the separate smoke test uses real Azure
inference and asserts that the application is pending, the current limit remains
EUR 2,000, and both inbox entries were actually created.
Windows WebKit lacks WebRTC/Web Audio; those tests exercise the explicit
unsupported-voice/text-only fallback. Safari itself supports both APIs.
The opt-in Chromium live test checks real incoming RTP audio, model captions,
mute and track cleanup. Set `AVA_TEST_SPEECH_FILE` to a PCM WAV with fifteen
seconds of initial silence followed by a fictional spoken question about the
current overdraft limit to also check speech recognition through the microphone
path. It must not contain real customer audio.
WebKit emulation does not replace a physical iPhone microphone, speaker,
Bluetooth and mobile-network check before a customer presentation.

For service failures, check that the agent is enabled, the managed identity has
**Foundry User** on the configured resource, and role assignment has propagated.
The health endpoint verifies the web process, not model availability: run the
live smoke test separately. If WebRTC cannot connect on a restrictive network,
use another network or the text + voice mode; the sample does not supply a
separate TURN service.
