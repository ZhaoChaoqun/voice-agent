# MAI Transcribe 2 streaming latency

This standalone benchmark uses **Azure Speech SDK 1.52+**, not the Voice Agent API.
It selects `SpeechConfig.model = "mai-transcribe-2-streaming"` and pushes mono
PCM16 WAV audio at 8 or 16 kHz in real time, in 20 ms chunks.

Run from the repository root in PowerShell:

```powershell
uv venv speech_test\.venv
uv pip install --python speech_test\.venv\Scripts\python.exe -r speech_test\requirements.txt
Copy-Item speech_test\.env.example speech_test\.env
# Fill in AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in speech_test\.env.
speech_test\.venv\Scripts\python.exe speech_test\mai_streaming_latency.py --wav C:\audio\speech.wav
```

Use a Speech or Foundry resource in a region supporting the streaming model.
Credentials can also be supplied through environment variables; do not commit keys.
See the [official Speech SDK integration and regional availability](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-transcribe-2-streaming-speech-sdk).

To use an existing Foundry resource without storing its key, sign in with `az login`
and supply its resource name and group:

```powershell
speech_test\.venv\Scripts\python.exe speech_test\mai_streaming_latency.py `
    --foundry-resource YOUR_RESOURCE --resource-group YOUR_RESOURCE_GROUP `
    --wav C:\audio\speech.wav
```

Alternatively, set `AZURE_FOUNDRY_RESOURCE` and `AZURE_FOUNDRY_RESOURCE_GROUP`
in `speech_test\.env`. The script retrieves the AIServices resource's key and
region through Azure CLI, keeps the key in memory, and uses the same Speech SDK
streaming path. This requires permission to list resource keys and key-based
authentication to be enabled. It does not create or modify the cloud resource.

## What is measured

**`speech_end_to_final_ms`** is the local monotonic timestamp of the last
`recognized` callback minus the timestamp when the chunk containing the end of
speech finished being written to `PushAudioInputStream`. It includes SDK
buffering, network transit, endpointing, and final transcription processing.
It is not server-only inference time. Timing resolution is one 20 ms chunk,
plus OS scheduling jitter; timestamps represent SDK submission, not server receipt.

By default, the WAV's end is treated as the end of speech. Use a tightly trimmed
recording, or annotate the end of the last spoken word to exclude existing trailing
silence. The script does not guess speech boundaries from amplitude:

```powershell
speech_test\.venv\Scripts\python.exe speech_test\mai_streaming_latency.py `
    --wav C:\audio\speech.wav --speech-end-seconds 4.82 `
    --tail-seconds 3 --output speech_test\latency.json
```

The script adds paced silence before closing the stream, prints partial and final
transcripts immediately, and waits for session completion so it does not select
the first final prematurely. JSON includes the combined transcript and each
segment's service-reported offset/duration and segment-end-to-final latency.
Service-reported segment boundaries are not ground-truth speech endpoints.
For several utterances, the main metric measures the final segment against your
last speech-end annotation. Prefer a single utterance for a clean endpointing test.

`final_before_eof` distinguishes a final delivered during an open stream from a
final that may have been forced by EOF. If false, a warning asks you to increase
`--tail-seconds`. No transcript, SDK cancellation errors, invalid audio, and
timeouts fail explicitly. Existing output files are never overwritten.
`--timeout` bounds session-start and post-EOF event waits; SDK start/stop future
completion itself is governed by the SDK.

## Offline regression tests

```powershell
uv pip install --python speech_test\.venv\Scripts\python.exe pytest
speech_test\.venv\Scripts\python.exe -m pytest speech_test\test_mai_streaming_latency.py -q
```
