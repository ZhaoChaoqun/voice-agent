---
ai-usage: ai-assisted
---

# Voice Agent with image and camera input

Talk to a Foundry Voice Agent about what it can see. The user can type, speak,
upload up to five images, or share sampled camera frames, and the agent answers
by voice. Images are sent directly into the realtime voice session as
`input_image` content parts; no separate vision service is involved.

The sample has two entry points that share one small helper module:

| File | Purpose |
| --- | --- |
| [`server.py`](server.py) + [`static/`](static/) | Loopback web UI: microphone, text, image upload, and camera frames. Azure credentials stay in the Python process. |
| [`voice_image_agent.py`](voice_image_agent.py) | CLI: ask about 1–5 image files, print the answer and latency marks, optionally save the spoken reply as WAV. |
| [`image_input.py`](image_input.py) | Event builders, image validation, agent definition, and the camera sliding-window state machine. No Azure dependency. |

## Architecture

```mermaid
sequenceDiagram
    participant Browser as Browser (camera, mic, upload)
    participant Local as Local server.py
    participant Agent as Foundry Voice Agent
    Browser->>Local: Text / image data URLs / JPEG frames / PCM over same-origin WebSocket
    Local->>Local: Validate type, size and count, then build conversation items
    Local->>Agent: conversation.item.create (input_text + input_image)
    Local->>Agent: response.create (questions only, not camera frames)
    Agent-->>Local: Audio deltas + transcript deltas + response.done
    Local-->>Browser: PCM audio, transcript, first-audio latency
    Note over Local,Agent: Camera frames: keep the newest N items, delete the oldest with conversation.item.delete
```

## Prerequisites

- Python 3.11 or later, Azure CLI (`az login`), and a current Edge or Chrome.
- A Foundry Project with Voice Agents, and permission to create and use agents.
- A Voice Agent model that accepts image input. The public
  [Azure OpenAI realtime audio guide](https://learn.microsoft.com/azure/ai-foundry/openai/how-to/realtime-audio#image-input)
  documents image input for GPT realtime models. Model availability depends on
  your project and region; a voice-capable model is not necessarily
  image-capable. Check your project's model catalog and test with your own data.
- A small, non-sensitive test image. Do not use personal or customer data.

## Set up

From the repository root, in PowerShell:

```powershell
Set-Location samples\voice_agent_image_input
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
az login
```

On Linux or macOS, use `python3 -m venv .venv`, `.venv/bin/python`, and
`cp .env.example .env`. Then edit `.env`:

```dotenv
AZURE_VOICE_AGENTS_ENDPOINT=https://<account>.services.ai.azure.com/api/projects/<project>
AZURE_VOICE_AGENTS_MODEL=gpt-realtime
AZURE_VOICE_AGENTS_VOICE=en-US-AvaNeural
# Optional: reuse an existing image-capable agent unchanged.
AZURE_VOICE_AGENTS_AGENT_NAME=
AZURE_VOICE_AGENTS_AGENT_PREFIX=voice-image-input
AZURE_CREDENTIAL_MODE=cli
```

Without `AZURE_VOICE_AGENTS_AGENT_NAME`, the first run creates and enables a
uniquely named agent (`<prefix>-<8 hex>`) with `store: false`, Azure Speech
input transcription, and Azure semantic VAD. **The agent is retained**; reuse
its printed name, and delete it in Foundry when finished.

## Run the web UI

```powershell
.\.venv\Scripts\python.exe server.py
```

Open **http://127.0.0.1:8780** and select **Connect**. Use a headset.

- **Talk** — speak naturally; talk over a reply to interrupt it.
- **Type** — enter a question and select **Send**.
- **Upload** — select **Add images** (1–5 JPEG, PNG, or WebP files, 8 MiB each),
  optionally type a question, then **Send**. An empty question becomes
  `Describe this image briefly.`
- **Camera** — select **Start camera**. One JPEG frame (max 1280×720) is
  captured every 2 seconds and added to the conversation **without** requesting
  a reply. Ask by voice or text, for example "What is in front of me?".
  **Retain frames** (1–5, default 3) bounds how many frames stay in context.

The UI shows the time from sending a turn (or from the end of speech) to the
first audio chunk, and to `response.done`.

## Run the CLI

```powershell
# One image, spoken reply saved as WAV.
.\.venv\Scripts\python.exe voice_image_agent.py --image .\photo.jpg --text "What is on the table?" --save-audio reply.wav

# Several frames in one turn, repeated three times to observe latency.
.\.venv\Scripts\python.exe voice_image_agent.py --image f1.jpg --image f2.jpg --image f3.jpg `
  --text "These frames are in time order. What changed?" --repeat 3 --json-out result.json

# Print the event shape (image data redacted) and reuse an existing agent.
.\.venv\Scripts\python.exe voice_image_agent.py --agent-name <agent-name> --image photo.jpg --show-event
```

Each run prints timings in milliseconds measured from sending
`conversation.item.create`: `item_created_ms`, `first_text_ms`,
`first_audio_ms`, and `response_done_ms`. `--json-out` also stores the
service-reported token usage.

## How images are sent

Once the session reports `session.updated`, send one user message containing
ordered text and image parts, then one `response.create`:

```json
{
  "type": "conversation.item.create",
  "item": {
    "type": "message",
    "role": "user",
    "content": [
      { "type": "input_text", "text": "What color is the square?" },
      {
        "type": "input_image",
        "image_url": "data:image/png;base64,<BASE64_IMAGE_BYTES>",
        "detail": "low"
      }
    ]
  }
}
```

```json
{ "type": "response.create" }
```

- `image_url` is the data URL string itself, not a nested `{ "url": ... }` object.
- A message can contain several `input_image` parts; this sample allows up to
  five per turn. This is a sample limit, not a published service limit.
- The sample sends `"detail": "low"`. Other values are accepted by the CLI
  (`--detail`) but were not measured here.
- `response.create` can be sent immediately after the item; events are
  processed in order, so waiting for `conversation.item.created` only adds a
  round trip.
- `conversation.item.created` acknowledges the item; it does not prove that
  the model understood the image. Check `response.done` status and handle
  `error` events.
- This sample sends base64 data URLs only. Other image references were not
  tested.

With the Projects SDK, the same events go through the realtime connection:

```python
async with client.beta.voice_agents.realtime.connect(agent_name=name) as connection:
    # ...wait for session.updated...
    await connection.send({"type": "conversation.item.create", "item": item})
    await connection.response.create()
```

### Camera frames as background context

Each camera frame is its own user item with a client-chosen ID such as
`item_camera_<id>_<n>`, labeled with its frame number and capture time. The
instructions tell the model that frames do not require a reply and that the
newest frame represents the current scene. [`CameraContext`](image_input.py):

- sends no `response.create` for frames;
- keeps at most one create or delete outstanding, and replaces an unsent frame
  with a newer one;
- pauses updates while a response is generating, so the context of an answer
  does not change mid-answer;
- deletes the oldest frame with `conversation.item.delete` before adding a new
  one when the window is full, and deletes all frames when the camera stops.

Without deletion, images accumulate in the conversation. In the measurements
below, repeating the same five-frame question in one session increased the
reported image tokens from 325 to 650 to 975.

## Sizing and latency guidance

- **Resize before sending.** The browser scales frames to at most 1280×720 and
  encodes JPEG at quality 0.72, retrying smaller if a frame exceeds 2 MiB. For
  latency-sensitive devices, 640×360–960×540 is a reasonable starting point;
  evaluate legibility of the details you need.
- **Send fewer, newer frames.** Three to five frames per question covered the
  tested scenarios. Sample on an interval (2 s here) or on events such as a
  wake word or motion, rather than streaming video.
- **Send frames before the question.** Pre-loading frames as context while the
  user speaks moves the upload off the critical path; only the question then
  triggers a response.
- **Bound the context.** Delete old frames; every retained image is re-processed
  on later turns.
- **Measure first audio, not response end.** Users perceive the first audio chunk.

## Integration patterns

**A. Images directly in the voice session (this sample).** Send frames or
photos as `input_image` parts in the Voice Agent conversation. Recommended when
the selected Voice Agent model accepts image input.

- One connection, one model call per question, no glue service.
- The model sees the images and the conversation history together, and can
  answer follow-up questions about the same frames.
- Frames can be pre-loaded while the user speaks.
- Image tokens count against the session context; bound retained frames.
- Visual quality is that of the selected voice model. Cascaded Voice Agents
  can use a chat model (for example `gpt-5.4`) with image input, which may give
  a different quality/latency balance than a speech-to-speech model.

**B. Separate vision model as a tool or parallel service.** Keep the voice
session audio/text only. Send frames to a separate vision-capable model (for
example a GPT-5 family deployment through the Responses or Chat Completions
API), then return a short text description to the voice session as a
`function_call_output` or `input_text` item.

- Use any vision model or specialized pipeline (detection, OCR) independent of
  the voice model, and reuse the result across devices or services.
- Adds an extra model call on the critical path when invoked as a tool
  (tool call → vision call → second voice response). Running vision in parallel
  and pushing results as context avoids waiting, at the cost of possibly stale
  descriptions.
- The voice model only sees the text summary, so follow-up questions about
  details not in the summary need another vision call.
- More components to deploy, secure, and monitor.

Start with pattern A, measure first-audio latency with your own frames,
resolution, and model, and move to B only if you need a specific vision model
or pipeline that the voice session cannot use. Pattern B is not implemented in
this sample.

## Limitations

- Loopback demo: one session at a time, no user authentication. Do not expose
  `server.py` to a network.
- No continuous video. Frames are still images with gaps between them.
- The upload, frame, and per-turn limits are client-sample limits, not
  published service limits.
- Image items persist in the session until deleted or the session ends.
  `store: false` disables conversation persistence; it is not a claim of zero
  service telemetry or retention. Diagnostic content capture, if enabled in
  your project, can include image data.
- Camera access requires `localhost`/HTTPS and browser permission. Microphone
  echo cancellation is requested, but a headset is still recommended.
- PDFs and other document types are not supported by this sample.

## Validation

Offline tests mock the network and do not create agents:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s . -p "test_*.py" -q
node --test test_frames.mjs
```

They cover event shapes, data-URL validation, the camera sliding window,
response gating, the CLI turn loop, browser-to-service relay validation, and
loopback/origin checks. A live run against your project is still required to
confirm model support and latency.
