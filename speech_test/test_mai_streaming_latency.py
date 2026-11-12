"""Offline tests for speech-end timing and paced SDK streaming."""

import threading
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
import wave

import pytest

from speech_test.mai_streaming_latency import (
    Final, Timeline, foundry_credentials, read_audio, run, stream_audio, summarize,
)


def test_foundry_resource_credentials():
    with (
        patch("speech_test.mai_streaming_latency.shutil.which", return_value="az"),
        patch("speech_test.mai_streaming_latency.subprocess.run") as command,
    ):
        command.side_effect = [
            SimpleNamespace(returncode=0, stdout='{"kind":"AIServices","location":"southeastasia"}'),
            SimpleNamespace(returncode=0, stdout='{"key1":"test-key"}'),
        ]
        assert foundry_credentials("foundry", "group") == ("test-key", "southeastasia")
        assert command.call_args_list[1].args[0][3:5] == ["keys", "list"]


def test_foundry_lookup_failure_is_explicit():
    with (
        patch("speech_test.mai_streaming_latency.shutil.which", return_value="az"),
        patch("speech_test.mai_streaming_latency.subprocess.run") as command,
    ):
        command.return_value = SimpleNamespace(returncode=1, stderr="Access denied")
        with pytest.raises(RuntimeError, match="Access denied"):
            foundry_credentials("foundry", "group")


def test_annotated_end_excludes_trailing_silence():
    timeline = Timeline(16000)
    timeline.record(16000, 11.0)
    timeline.record(32000, 12.0)
    report = summarize([Final("hello", 0.0, 1.0, 11.4, True)], timeline, 1.0, 2.0)
    assert report["speech_end_to_final_ms"] == pytest.approx(400)
    assert report["segments"][0]["service_segment_end_to_final_ms"] == pytest.approx(400)
    assert report["final_before_eof"] is True


def test_last_segment_not_first_callback_is_measured():
    timeline = Timeline(16000)
    timeline.record(16000, 11.0)
    timeline.record(32000, 12.0)
    finals = [Final("second", 1.0, 1.0, 12.7, False), Final("first", 0.0, 1.0, 11.2, True)]
    report = summarize(finals, timeline, 2.0, 2.0)
    assert report["transcript"] == "first second"
    assert report["speech_end_to_final_ms"] == pytest.approx(700)
    assert report["final_before_eof"] is False


def test_timestamp_uses_chunk_containing_speech_end():
    timeline = Timeline(16000)
    timeline.record(320, 10.02)
    timeline.record(640, 10.04)
    assert timeline.at(0.021) == 10.04
    assert timeline.at(0.02) == 10.02
    with pytest.raises(ValueError, match="not sent"):
        timeline.at(0.05)


def test_missing_final_and_incorrect_annotation_fail():
    timeline = Timeline(16000)
    timeline.record(16000, 11.0)
    with pytest.raises(RuntimeError, match="No final"):
        summarize([], timeline, 1.0, 1.0)
    with pytest.raises(ValueError, match="before the selected speech end"):
        summarize([Final("early", 0.0, 0.5, 10.8, True)], timeline, 1.0, 1.0)


def test_real_time_pacing_and_tail():
    clock = [100.0]
    stream = MagicMock()
    done = MagicMock()

    def wait(seconds):
        clock[0] += seconds
        return False

    done.wait.side_effect = wait
    timeline = Timeline(16000)
    pcm = b"\x01\x00" * 480  # 30 ms, followed by 30 ms silence.
    with patch("speech_test.mai_streaming_latency.time.perf_counter", side_effect=lambda: clock[0]):
        stream_audio(stream, pcm, timeline, done, 0.03)
    assert timeline.frames == [320, 640, 960]
    assert timeline.sent_at == pytest.approx([100.02, 100.04, 100.06])
    assert b"".join(call.args[0] for call in stream.write.call_args_list) == pcm + bytes(960)


def test_premature_session_end_stops_sending():
    stream = MagicMock()
    done = threading.Event()
    done.set()
    with pytest.raises(RuntimeError, match="before all audio"):
        stream_audio(stream, bytes(640), Timeline(16000), done, 0.03)
    stream.write.assert_not_called()


@pytest.mark.parametrize("channels,width,rate", [(2, 2, 16000), (1, 1, 16000), (1, 2, 24000)])
def test_invalid_audio_format(tmp_path, channels, width, rate):
    path = tmp_path / "invalid.wav"
    with wave.open(str(path), "wb") as audio:
        audio.setparams((channels, width, rate, 0, "NONE", "not compressed"))
        audio.writeframes(bytes(320 * channels * width))
    with pytest.raises(ValueError, match="mono PCM16"):
        read_audio(path)


def test_sdk_model_callbacks_and_cleanup():
    recognizer = MagicMock()
    handlers = {}
    for name in ("recognized", "canceled", "session_started", "session_stopped", "recognizing"):
        getattr(recognizer, name).connect.side_effect = lambda cb, name=name: handlers.update({name: cb})
    recognizer.start_continuous_recognition_async.return_value.get.side_effect = (
        lambda: handlers["session_started"](None)
    )
    stream = MagicMock()

    def feed(stream, pcm, timeline, done, tail):
        timeline.record(16000, 10.0)
        event = SimpleNamespace(
            result=SimpleNamespace(reason=1, text="hello", offset=0, duration=10_000_000)
        )
        handlers["recognized"](event)

    stream.close.side_effect = lambda: handlers["session_stopped"](None)
    with (
        patch("speech_test.mai_streaming_latency.read_audio", return_value=(bytes(32000), 16000)),
        patch("speech_test.mai_streaming_latency.speechsdk") as sdk,
        patch("speech_test.mai_streaming_latency.stream_audio", side_effect=feed),
        patch("speech_test.mai_streaming_latency.time.perf_counter", return_value=10.4),
    ):
        sdk.ResultReason.RecognizedSpeech = 1
        sdk.SpeechRecognizer.return_value = recognizer
        sdk.audio.PushAudioInputStream.return_value = stream
        report = run(SimpleNamespace(), "key", "region", "en-US", None, 3.0, 30.0)
        assert sdk.SpeechConfig.return_value.model == "mai-transcribe-2-streaming"
    assert report["speech_end_to_final_ms"] == pytest.approx(400)
    assert report["final_before_eof"] is True
    recognizer.stop_continuous_recognition_async.return_value.get.assert_called_once()


@pytest.mark.parametrize("speech_end", [0.0, -1.0, 2.0, float("nan")])
def test_invalid_speech_end(speech_end):
    with patch("speech_test.mai_streaming_latency.read_audio", return_value=(bytes(32000), 16000)):
        with pytest.raises(ValueError, match="within the WAV"):
            run(SimpleNamespace(), "key", "region", "en-US", speech_end, 3.0, 30.0)


def test_sdk_cancellation_preserves_error_details():
    recognizer = MagicMock()
    handlers = {}
    for name in ("recognized", "canceled", "session_started", "session_stopped", "recognizing"):
        getattr(recognizer, name).connect.side_effect = lambda cb, name=name: handlers.update({name: cb})
    recognizer.start_continuous_recognition_async.return_value.get.side_effect = (
        lambda: handlers["session_started"](None)
    )

    def feed(stream, pcm, timeline, done, tail):
        handlers["canceled"](SimpleNamespace(reason=2, error_code="Forbidden", error_details="Access denied"))
        raise RuntimeError("Recognition ended before all audio and trailing silence were sent.")

    with (
        patch("speech_test.mai_streaming_latency.read_audio", return_value=(bytes(32000), 16000)),
        patch("speech_test.mai_streaming_latency.speechsdk") as sdk,
        patch("speech_test.mai_streaming_latency.stream_audio", side_effect=feed),
    ):
        sdk.CancellationReason.Error = 2
        sdk.SpeechRecognizer.return_value = recognizer
        with pytest.raises(RuntimeError, match="Forbidden: Access denied"):
            run(SimpleNamespace(), "key", "region", "en-US", None, 3.0, 30.0)
    recognizer.stop_continuous_recognition_async.return_value.get.assert_called_once()
