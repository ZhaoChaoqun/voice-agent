import asyncio
import os
from contextlib import closing

import pyaudio
from azure.ai.projects import models
from azure.ai.projects.aio import AIProjectClient
from azure.ai.projects.aio.operations import AsyncBetaRealtimeConnection
from azure.identity.aio import DefaultAzureCredential

RATE = 24000
CHUNK = 2400


def observe_handoff(event) -> None:
    if isinstance(event, models.RealtimeServerEventSessionUpdated):
        session = models.VoiceAgentSessionResponseConfig(event.session)
        if session.handoff is None:
            raise RuntimeError(
                "The session has no handoff state. Check the saved agent "
                "configuration and the client library version."
            )
        print(f"Active subagent: {session.handoff.active_node_id}")
    elif isinstance(
        event, models.VoiceAgentServerEventSessionHandoffStarted
    ):
        print(
            f"Handoff requested: {event.from_node_id} "
            f"-> {event.to_node_id}"
        )
    elif isinstance(
        event, models.VoiceAgentServerEventSessionHandoffCompleted
    ):
        print("Handoff completed.")
    elif isinstance(
        event, models.VoiceAgentServerEventSessionHandoffAborted
    ):
        if (
            event.reason
            == models.VoiceAgentHandoffAbortReason.USER_INTERRUPTION
        ):
            print("Handoff cancelled by caller; source remains active.")
        else:
            detail = event.error.message if event.error else "no details"
            raise RuntimeError(f"Handoff aborted: {detail}")


async def wait_until_ready(
    connection: AsyncBetaRealtimeConnection,
) -> None:
    while True:
        event = await connection.recv()
        if isinstance(event, models.RealtimeServerEventError):
            raise RuntimeError(event.error.message)
        if isinstance(event, models.RealtimeServerEventSessionUpdated):
            observe_handoff(event)
            return


async def send_microphone(
    connection: AsyncBetaRealtimeConnection, stream: pyaudio.Stream
) -> None:
    while True:
        audio = await asyncio.to_thread(
            stream.read,
            CHUNK,
            exception_on_overflow=False,
        )
        await connection.input_audio_buffer.append(audio=audio)


async def receive_audio(
    connection: AsyncBetaRealtimeConnection, stream: pyaudio.Stream
) -> None:
    async for event in connection:
        observe_handoff(event)
        if isinstance(event, models.RealtimeServerEventResponseAudioDelta):
            await asyncio.to_thread(stream.write, event.delta)
        elif isinstance(
            event, models.RealtimeServerEventResponseAudioTranscriptDone
        ):
            print(f"Agent: {event.transcript}")
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
                project_client.voice_agents.realtime.connect(
                    agent_name=os.environ["FOUNDRY_VOICE_AGENT_NAME"],
                ) as connection,
            ):
                await asyncio.wait_for(
                    wait_until_ready(connection), timeout=30
                )
                print("Connected. Ask about an appointment. Ctrl+C exits.")
                async with asyncio.TaskGroup() as tasks:
                    tasks.create_task(send_microphone(connection, microphone))
                    tasks.create_task(receive_audio(connection, speaker))
    finally:
        audio.terminate()


asyncio.run(talk())
