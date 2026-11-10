import asyncio
import os
from contextlib import closing

import pyaudio
from azure.ai.projects import models
from azure.ai.projects.aio import AIProjectClient
from azure.identity.aio import DefaultAzureCredential

RATE = 24000
CHUNK = 2400


def show_turn_taking(event) -> None:
    if isinstance(event, models.RealtimeServerEventInputAudioBufferSpeechStarted):
        # With speech start detection, this event means the caller took the
        # turn. Backchannels never produce it.
        print("[caller took the turn]")
    elif isinstance(
        event,
        models.RealtimeServerEventConversationItemInputAudioTranscriptionCompleted,
    ):
        # The service adds "backchannel": true to speech that didn't take the
        # turn. The agent keeps talking and doesn't respond to it.
        if event.get("backchannel"):
            print(f"Caller (backchannel, agent keeps talking): {event.transcript}")
        else:
            print(f"Caller: {event.transcript}")
    elif isinstance(event, models.RealtimeServerEventResponseAudioTranscriptDone):
        print(f"Agent: {event.transcript}")


async def wait_until_ready(connection) -> None:
    while True:
        event = await connection.recv()
        if isinstance(event, models.RealtimeServerEventError):
            raise RuntimeError(event.error.message)
        if isinstance(event, models.RealtimeServerEventSessionUpdated):
            turn_detection = event.session["audio"]["input"]["turn_detection"]
            speech_start = "on" if turn_detection.get("speech_start_detection") else "off"
            eou = turn_detection.get("end_of_utterance_detection") or {}
            print(
                f"Session ready: speech_start_detection {speech_start}, "
                f"end_of_utterance_detection model {eou.get('model')}"
            )
            return


async def send_microphone(connection, stream: pyaudio.Stream) -> None:
    while True:
        audio = await asyncio.to_thread(
            stream.read,
            CHUNK,
            exception_on_overflow=False,
        )
        await connection.input_audio_buffer.append(audio=audio)


async def receive_audio(connection, stream: pyaudio.Stream) -> None:
    async for event in connection:
        show_turn_taking(event)
        if isinstance(event, models.RealtimeServerEventResponseAudioDelta):
            await asyncio.to_thread(stream.write, event.delta)
        elif isinstance(event, models.RealtimeServerEventError):
            raise RuntimeError(event.error.message)
    raise ConnectionError("The voice session closed. Restart to reconnect.")


async def talk() -> None:
    audio = pyaudio.PyAudio()
    try:
        with (
            closing(audio.open(
                format=pyaudio.paInt16,
                channels=1,
                rate=RATE,
                input=True,
                frames_per_buffer=CHUNK,
            )) as microphone,
            closing(audio.open(
                format=pyaudio.paInt16,
                channels=1,
                rate=RATE,
                output=True,
                frames_per_buffer=CHUNK,
            )) as speaker,
        ):
            async with (
                DefaultAzureCredential() as credential,
                AIProjectClient(
                    endpoint=os.environ["FOUNDRY_PROJECT_ENDPOINT"],
                    credential=credential,
                    allow_preview=True,
                ) as project_client,
            ):
                # azure-ai-projects 2.11.0 moved realtime connections from
                # beta.voice_agents to voice_agents.
                voice_agents = (
                    getattr(project_client, "voice_agents", None)
                    or project_client.beta.voice_agents
                )
                async with voice_agents.realtime.connect(
                    agent_name=os.environ["FOUNDRY_VOICE_AGENT_NAME"],
                ) as connection:
                    await asyncio.wait_for(wait_until_ready(connection), timeout=30)
                    print("Connected. Ask where your parcel is. Ctrl+C exits.")
                    async with asyncio.TaskGroup() as tasks:
                        tasks.create_task(send_microphone(connection, microphone))
                        tasks.create_task(receive_audio(connection, speaker))
    finally:
        audio.terminate()


asyncio.run(talk())
