"""Measure speech-end-to-final latency with the Azure Speech SDK."""

from __future__ import annotations

import argparse
from bisect import bisect_left
from dataclasses import dataclass, field
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import time
import wave

import azure.cognitiveservices.speech as speechsdk
from dotenv import load_dotenv

MODEL = "mai-transcribe-2-streaming"
TICKS_PER_SECOND = 10_000_000
CHUNK_MS = 20


def foundry_credentials(resource: str, resource_group: str) -> tuple[str, str]:
    """Read a Foundry resource's key into memory using the signed-in Azure CLI."""
    cli = shutil.which("az")
    if cli is None:
        raise RuntimeError("Azure CLI is required for --foundry-resource. Install it and run az login.")

    def query(operation: list[str]) -> str:
        completed = subprocess.run(
            [cli, "cognitiveservices", "account", *operation,
             "--name", resource, "--resource-group", resource_group, "--only-show-errors", "-o", "json"],
            capture_output=True, text=True, timeout=60, check=False,
        )
        if completed.returncode:
            raise RuntimeError(f"Azure CLI resource lookup failed: {completed.stderr.strip()}")
        return completed.stdout

    account = json.loads(query(["show"]))
    if account.get("kind") != "AIServices":
        raise ValueError("--foundry-resource must identify a Foundry AIServices resource.")
    keys = json.loads(query(["keys", "list"]))
    key, region = keys.get("key1"), account.get("location")
    if not key or not region:
        raise RuntimeError("The Foundry resource did not return a usable key and region.")
    return key, region


@dataclass
class Timeline:
    """Map audio sample positions to local push-stream write completion times."""

    rate: int
    frames: list[int] = field(default_factory=list)
    sent_at: list[float] = field(default_factory=list)

    def record(self, frame: int, timestamp: float) -> None:
        self.frames.append(frame)
        self.sent_at.append(timestamp)

    def at(self, seconds: float) -> float:
        frame = math.ceil(seconds * self.rate)
        index = bisect_left(self.frames, frame)
        if index == len(self.frames):
            raise ValueError(f"Audio position {seconds:.3f}s was not sent.")
        return self.sent_at[index]


@dataclass(frozen=True)
class Final:
    text: str
    offset_seconds: float
    duration_seconds: float
    received_at: float
    before_eof: bool

    @property
    def end_seconds(self) -> float:
        return self.offset_seconds + self.duration_seconds


def read_audio(path: Path) -> tuple[bytes, int]:
    with wave.open(str(path), "rb") as audio:
        if (
            audio.getnchannels() != 1
            or audio.getsampwidth() != 2
            or audio.getcomptype() != "NONE"
            or audio.getframerate() not in (8000, 16000)
        ):
            raise ValueError("Use an uncompressed mono PCM16 WAV at 8000 or 16000 Hz.")
        pcm = audio.readframes(audio.getnframes())
        if not pcm or len(pcm) != audio.getnframes() * 2:
            raise ValueError("WAV input is empty or truncated.")
        return pcm, audio.getframerate()


def stream_audio(
    stream: speechsdk.audio.PushAudioInputStream,
    pcm: bytes,
    timeline: Timeline,
    done: threading.Event,
    tail_seconds: float,
) -> None:
    chunk_frames = timeline.rate * CHUNK_MS // 1000
    source_frames = len(pcm) // 2
    total_frames = source_frames + math.ceil(tail_seconds * timeline.rate)
    start = time.perf_counter()
    for first in range(0, total_frames, chunk_frames):
        end = min(first + chunk_frames, total_frames)
        if done.wait(max(0.0, start + end / timeline.rate - time.perf_counter())):
            raise RuntimeError("Recognition ended before all audio and trailing silence were sent.")
        data = pcm[first * 2 : min(end, source_frames) * 2] if first < source_frames else b""
        data += bytes((end - first) * 2 - len(data))
        stream.write(data)
        timeline.record(end, time.perf_counter())


def summarize(
    finals: list[Final], timeline: Timeline, speech_end: float, audio_seconds: float
) -> dict:
    if not finals:
        raise RuntimeError("No final speech transcript was received.")
    last = max(finals, key=lambda result: (result.end_seconds, result.received_at))
    speech_ended_at = timeline.at(speech_end)
    latency_ms = (last.received_at - speech_ended_at) * 1000
    if latency_ms < 0:
        raise ValueError(
            "The last final arrived before the selected speech end. "
            "Check --speech-end-seconds; the WAV may contain trailing silence or unrecognized speech."
        )
    return {
        "model": MODEL,
        "audio_seconds": audio_seconds,
        "speech_end_seconds": speech_end,
        "speech_end_to_final_ms": latency_ms,
        "final_before_eof": last.before_eof,
        "timestamp_resolution_ms": CHUNK_MS,
        "transcript": " ".join(result.text for result in sorted(finals, key=lambda result: result.offset_seconds)),
        "segments": [
            {
                "text": result.text,
                "offset_seconds": result.offset_seconds,
                "duration_seconds": result.duration_seconds,
                "service_segment_end_to_final_ms": (
                    result.received_at - timeline.at(result.end_seconds)
                ) * 1000,
                "final_before_eof": result.before_eof,
            }
            for result in finals
        ],
    }


def run(
    wav: Path,
    key: str,
    region: str,
    language: str,
    speech_end_seconds: float | None,
    tail_seconds: float,
    timeout: float,
) -> dict:
    if not key or not region:
        raise ValueError("Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION.")
    if not all(math.isfinite(value) and value > 0 for value in (tail_seconds, timeout)):
        raise ValueError("--tail-seconds and --timeout must be finite and positive.")
    pcm, rate = read_audio(wav)
    audio_seconds = len(pcm) / (2 * rate)
    speech_end = audio_seconds if speech_end_seconds is None else speech_end_seconds
    if not math.isfinite(speech_end) or not 0 < speech_end <= audio_seconds:
        raise ValueError("--speech-end-seconds must be positive and within the WAV duration.")

    config = speechsdk.SpeechConfig(subscription=key, region=region)
    config.model = MODEL
    config.speech_recognition_language = language
    stream = speechsdk.audio.PushAudioInputStream(
        stream_format=speechsdk.audio.AudioStreamFormat(
            samples_per_second=rate, bits_per_sample=16, channels=1
        )
    )
    recognizer = speechsdk.SpeechRecognizer(
        speech_config=config, audio_config=speechsdk.audio.AudioConfig(stream=stream)
    )
    timeline = Timeline(rate)
    done = threading.Event()
    started = threading.Event()
    eof = threading.Event()
    lock = threading.Lock()
    finals: list[Final] = []
    errors: list[str] = []

    def recognized(event: speechsdk.SpeechRecognitionEventArgs) -> None:
        received_at = time.perf_counter()
        result = event.result
        if result.reason == speechsdk.ResultReason.RecognizedSpeech:
            final = Final(
                result.text,
                result.offset / TICKS_PER_SECOND,
                result.duration / TICKS_PER_SECOND,
                received_at,
                not eof.is_set(),
            )
            with lock:
                finals.append(final)
            print(f"FINAL: {result.text}", flush=True)
        elif result.reason == speechsdk.ResultReason.NoMatch:
            print("NO MATCH: Speech could not be recognized.", file=sys.stderr, flush=True)

    def canceled(event: speechsdk.SpeechRecognitionCanceledEventArgs) -> None:
        if event.reason == speechsdk.CancellationReason.Error:
            with lock:
                errors.append(f"{event.error_code}: {event.error_details}")
        done.set()

    recognizer.recognized.connect(recognized)
    recognizer.canceled.connect(canceled)
    recognizer.session_started.connect(lambda event: started.set())
    recognizer.session_stopped.connect(lambda event: done.set())
    recognizer.recognizing.connect(lambda event: print(f"PARTIAL: {event.result.text}", flush=True))

    # SDK asynchronous futures expose blocking get(); events bound the service waits.
    try:
        recognizer.start_continuous_recognition_async().get()
        deadline = time.perf_counter() + timeout
        while not started.wait(0.05):
            if done.is_set():
                with lock:
                    raise RuntimeError("; ".join(errors) or "Recognition ended before session start.")
            if time.perf_counter() >= deadline:
                raise TimeoutError("Timed out waiting for the Speech SDK session to start.")
        stream_audio(stream, pcm, timeline, done, tail_seconds)
        eof.set()
        stream.close()
        if not done.wait(timeout):
            raise TimeoutError("Timed out waiting for final results after audio EOF.")
    except RuntimeError as error:
        with lock:
            if errors:
                raise RuntimeError("; ".join(errors)) from error
        raise
    finally:
        eof.set()
        stream.close()
        recognizer.stop_continuous_recognition_async().get()
    with lock:
        if errors:
            raise RuntimeError("; ".join(errors))
        return summarize(list(finals), timeline, speech_end, audio_seconds)


def main() -> int:
    load_dotenv(Path(__file__).with_name(".env"))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wav", type=Path, required=True)
    parser.add_argument("--foundry-resource", default=os.getenv("AZURE_FOUNDRY_RESOURCE"))
    parser.add_argument("--resource-group", default=os.getenv("AZURE_FOUNDRY_RESOURCE_GROUP"))
    parser.add_argument("--language", default="en-US")
    parser.add_argument(
        "--speech-end-seconds", type=float,
        help="Known end of the last spoken word within the WAV; defaults to WAV duration.",
    )
    parser.add_argument("--tail-seconds", type=float, default=3.0, help="Paced silence added before EOF.")
    parser.add_argument("--timeout", type=float, default=30.0, help="Session-start and post-EOF wait limit.")
    parser.add_argument("--output", type=Path, help="Save JSON metrics; refuses to overwrite a file.")
    args = parser.parse_args()
    try:
        if args.output is not None and args.output.exists():
            raise ValueError(f"Output already exists: {args.output}")
        if bool(args.foundry_resource) != bool(args.resource_group):
            raise ValueError("--foundry-resource and --resource-group must be supplied together.")
        key, region = (
            foundry_credentials(args.foundry_resource, args.resource_group)
            if args.foundry_resource
            else (os.getenv("AZURE_SPEECH_KEY", ""), os.getenv("AZURE_SPEECH_REGION", ""))
        )
        result = run(
            args.wav, key, region,
            args.language, args.speech_end_seconds, args.tail_seconds, args.timeout,
        )
        result["speech_end_source"] = "wav_end" if args.speech_end_seconds is None else "user_annotation"
        print(f"\nSpeech end -> final: {result['speech_end_to_final_ms']:.1f} ms")
        if not result["final_before_eof"]:
            print(
                "WARNING: Last final arrived after EOF; this is not a pure ongoing-stream measurement. "
                "Increase --tail-seconds.",
                file=sys.stderr,
            )
        print(json.dumps(result, indent=2, ensure_ascii=False))
        if args.output is not None:
            with args.output.open("x", encoding="utf-8") as output:
                json.dump(result, output, indent=2, ensure_ascii=False)
                output.write("\n")
    except (OSError, ValueError, RuntimeError, TimeoutError, subprocess.TimeoutExpired, wave.Error) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
