#!/usr/bin/env python3
"""Create or reuse a Foundry GPT Live agent and stream audio with the Azure AI Projects SDK."""

import argparse
import asyncio
import base64
import contextlib
import os
import signal
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

from azure.ai.projects.aio import AIProjectClient
from azure.ai.projects.aio.operations import AsyncBetaLiveConnection
from azure.ai.projects.models import (
    LiveInitialSessionAudioOutputParam,
    LiveInitialSessionAudioParam,
    LiveResponsesDelegationSettingsInputParam,
    LiveSessionAudioFormatPCMParam,
    StructuredInputDefinition,
    VoiceAgentLiveDefinition,
    VoiceAgentLiveResponsesDelegation,
    VoiceAgentTemplateGreetingConfig,
)
from azure.core.exceptions import (
    ClientAuthenticationError,
    HttpResponseError,
    ResourceNotFoundError,
)
from azure.identity.aio import AzureCliCredential
from dotenv import load_dotenv

from audio_common import Audio, AudioError, RATE
from transcript_common import TranscriptDisplay

ENGLISH_TEACHER_INSTRUCTIONS = (
    "You are a patient English teacher helping the learner practice spoken English. "
    "Ask one short question at a time and let the learner answer. Gently correct "
    "grammar or vocabulary mistakes with an improved sentence and a brief explanation. "
    "Keep replies concise and encouraging. Use English for practice; if the learner "
    "asks in Chinese, briefly explain in Chinese and then return to English."
)
BACKEND_INSTRUCTIONS = (
    "You are an expert English teacher supporting a spoken English lesson. "
    "Give one accurate, concise grammar explanation and one example or corrected sentence. "
    "Write guidance for the voice teacher, not a long essay."
)

# Structured inputs personalize each lesson. The agent declares them, its instructions
# and greeting use them as {{placeholders}}, and each session supplies values on connect.
LEVELS = ("beginner", "intermediate", "advanced")
DEFAULT_LEARNER_NAME = "Alex"
DEFAULT_LEVEL = "intermediate"
LESSON_CONTEXT = (
    " The learner's name is {{learner_name}}, and their English level is {{level}}. "
    "Match your vocabulary, sentence length, and pace to that level."
)
GREETING = "Hi {{learner_name}}! I'm your English teacher. What would you like to practice today?"


class DemoError(Exception):
    pass


def live_audio():
    """PCM16 at RATE in both directions, spoken with the marin voice."""
    return LiveInitialSessionAudioParam(
        format=LiveSessionAudioFormatPCMParam(rate=RATE),
        output=LiveInitialSessionAudioOutputParam(voice="marin"),
    )


def lesson_inputs():
    """The structured inputs every English-teacher agent in these samples declares."""
    return {
        "learner_name": StructuredInputDefinition(
            description="What the teacher calls the learner.",
            default_value="friend",
        ),
        "level": StructuredInputDefinition(
            description="The learner's English level.",
            default_value=DEFAULT_LEVEL,
            schema={"type": "string", "enum": list(LEVELS)},
        ),
    }


def lesson_greeting():
    """GPT Live speaks this template greeting, with structured inputs filled in, at session start."""
    return VoiceAgentTemplateGreetingConfig(text=GREETING)


def structured_inputs_for(definition, values):
    """Values for only the inputs the agent declares; an AGENT_NAME agent may declare none."""
    declared = definition.get("structured_inputs") or {}
    supplied = {name: value for name, value in values.items() if name in declared}
    return supplied or None


# Agent configuration is intentionally fully visible here, separate from the SDK conversation.
# VoiceAgentLiveDefinition sets kind=voice and sub_protocol=live.
def agent_definition():
    backend = required("RESPONSE_DELEGATION_DEPLOYMENT")
    instructions = ENGLISH_TEACHER_INSTRUCTIONS + LESSON_CONTEXT + (
        " Handle greetings and casual conversation yourself. For grammar corrections, "
        "grammar explanations, or lesson planning, always delegate to the Responses "
        "English-teacher backend first, then explain its guidance aloud."
    )
    return VoiceAgentLiveDefinition(
        model=required("GPT_LIVE_DEPLOYMENT"),
        model_type="self_deployed",
        instructions=instructions,
        greeting=lesson_greeting(),
        structured_inputs=lesson_inputs(),
        audio=live_audio(),
        delegation=VoiceAgentLiveResponsesDelegation(
            responses=LiveResponsesDelegationSettingsInputParam(
                model=backend, instructions=BACKEND_INSTRUCTIONS
            )
        ),
        # Persist in Foundry for the shared conversation downloader.
        store=True,
    )


async def reply_without_executor(connection, delegation_id, learner_said, transcript):
    """Answer a client delegation in a session whose backend is not this app."""
    await connection.session.commentary.append(
        delegation_id=delegation_id,
        content="This demo uses a Responses backend, not a client executor. Please continue the English lesson.",
    )


async def converse(
    connection: AsyncBetaLiveConnection,
    audio: Audio,
    transcript: TranscriptDisplay,
    backend_model: str,
    *,
    managed_delegation: bool = False,
    event_handler=None,
    client_executor=None,
    typed_input: bool = True,
) -> str | None:
    """The whole SDK event/audio loop is here so the sample can be read on its own.

    client_executor(connection, delegation_id, learner_said, transcript) answers client
    delegations; see client_delegation.py. typed_input enables the text box: the session's
    backend (Responses or a Foundry-managed agent) answers typed messages.
    """
    events = connection.__aiter__()
    stop = transcript.stop_requested
    loop = asyncio.get_running_loop()
    old_sigint = signal.getsignal(signal.SIGINT)
    signal.signal(signal.SIGINT, lambda *_: loop.call_soon_threadsafe(stop.set))
    session_id = None
    conversation_id = None
    closed = close_sent = False
    audio_started = False
    replied = set()
    latest_delegation = None
    forwarded = set()
    tasks = []
    client_tasks = set()
    learner_said = []  # Input transcript since the previous client delegation.
    last_input_at = 0.0
    typed_events = set()  # event_ids of typed-message commands, to correlate replies and errors.
    typed_delegations = set()  # Delegations that answer a typed message.
    delegation_title = "Managed delegation" if managed_delegation else "Delegation"

    async def answer_client(delegation_id):
        # session.delegation.created does not repeat the request, and the learner's
        # transcript can still be arriving. Wait until it is quiet (at most 3 seconds),
        # then hand the executor what the learner said since the previous delegation.
        deadline = loop.time() + 3
        while loop.time() < deadline and loop.time() - last_input_at < 0.6:
            await asyncio.sleep(0.1)
        said = "".join(learner_said).strip()
        learner_said.clear()
        await (client_executor or reply_without_executor)(
            connection, delegation_id, said, transcript
        )

    def check_client_tasks():
        for task in [task for task in client_tasks if task.done()]:
            client_tasks.discard(task)
            task.result()

    async def observe(event):
        nonlocal closed, latest_delegation, last_input_at
        # The SDK returns generated models for known Live events and plain dicts for
        # events it does not model yet. Both are mappings, so dispatch on the wire type.
        event_type = event.get("type", "")
        if event_handler is not None:
            await event_handler(connection, event, transcript)
        if event_type == "error":
            error = event.error
            if error.get("client_event_id") in typed_events:
                # The service rejected a typed message; the session continues.
                transcript.set_status(f"Typed message not accepted: {error.get('code') or error.message}")
                return
            raise DemoError(f"Live error: {error.message}")
        if event_type == "session.output_audio.delta":
            audio.play(base64.b64decode(event.delta, validate=True))
        elif event_type == "session.input_transcript.delta":
            transcript.append_user(event.delta)
            learner_said.append(event.delta)
            last_input_at = loop.time()
        elif event_type == "session.output_transcript.delta":
            transcript.append_agent(event.delta)
        elif event_type == "session.delegation.created":
            delegation = event.delegation
            latest_delegation = delegation.id
            # The wire string; the typed attribute is an enum whose str() adds its class name.
            target = delegation["target"]
            # A delegation that answers a typed message names its response.create event_id.
            if event.get("client_event_id") in typed_events:
                typed_delegations.add(delegation.id)
            typed = " (typed message)" if delegation.id in typed_delegations else ""
            if managed_delegation:
                # Managed sessions retain the native event name, but Foundry
                # projects its target to indicate that the service owns execution.
                if target != "foundry_managed_agent":
                    raise DemoError(
                        "Expected Foundry-managed delegation, but received "
                        f"delegation target '{target}'. Check that the "
                        "service supports foundry_managed_agent with tagged_text; "
                        "no client fallback was run."
                    )
                transcript.update_agent_activity(
                    delegation.id,
                    title=f"{delegation_title} → {backend_model}{typed}",
                    status="Prompt agent delegation requested",
                )
                return
            transcript.update_agent_activity(
                delegation.id,
                title=f"{delegation_title} → {backend_model if target == 'responses' else target}{typed}",
                status="Delegation requested",
            )
            if target == "client" and delegation.id not in replied:
                # GPT Live waits for this app's commentary tied to the delegation ID.
                replied.add(delegation.id)
                client_tasks.add(asyncio.create_task(answer_client(delegation.id)))
        elif event_type == "response.event":
            # Backend guidance is not the spoken teacher transcript. In managed mode this
            # is the prompt agent's raw tagged-text output; Foundry validates it and
            # forwards only accepted sections to GPT Live.
            backend = event.event
            kind = backend.get("type")
            activity_id = event.delegation_id or "uncorrelated-backend"
            statuses = {
                "response.created": "Backend response started",
                "response.in_progress": "Backend response in progress",
                "response.output_text.delta": "Receiving backend guidance",
                "response.completed": "Backend response completed",
                "response.failed": "Backend response failed",
                "response.incomplete": "Backend response incomplete",
                "error": "Backend error",
            }
            if kind in statuses:
                status = statuses[kind]
                if kind == "response.completed" and activity_id in forwarded:
                    status += "; accepted guidance forwarded to GPT Live"
                transcript.update_agent_activity(
                    activity_id,
                    title=f"{delegation_title if event.delegation_id else 'Uncorrelated backend'} → {backend_model}"
                    + (" (typed message)" if activity_id in typed_delegations else ""),
                    status=status,
                    delta=backend.get("delta", "")
                    if kind == "response.output_text.delta"
                    else "",
                )
            if kind in {
                "error",
                "response.failed",
                "response.incomplete",
            }:
                if managed_delegation:
                    # Foundry owns the managed fallback; keep the failure visible
                    # without retrying the backend or interrupting GPT Live.
                    return
                raise DemoError(
                    f"Teaching backend reported {backend['type']}; check its deployment and configuration."
                )
        elif event_type == "session.delegation.done":
            # Foundry sends this when a managed delegation finishes. The SDK does not model
            # it yet, so it arrives as a plain dict with the service's fields.
            error_code = event.get("error_code")
            transcript.update_agent_activity(
                event.get("delegation_id") or "uncorrelated-backend",
                status=f"Delegation done: {event.get('status')}"
                + (f" ({error_code})" if error_code else ""),
            )
        elif managed_delegation and event_type in {
            "session.commentary.appended",
            "session.thinking.appended",
        }:
            # Foundry appends each accepted guidance section to GPT Live itself. The
            # acknowledgment carries no text or delegation ID, so mark the latest one.
            if latest_delegation is not None:
                forwarded.add(latest_delegation)
                section = event_type.split(".")[1]
                transcript.update_agent_activity(
                    latest_delegation,
                    status=f"Accepted {section} forwarded to GPT Live",
                )
        elif event_type == "session.closed":
            closed = True
            transcript.set_status(
                f"Session closed: {event.reason}; cumulative Live usage: {event.usage.seconds} seconds"
            )
            if event.reason == "connection_lost":
                raise DemoError(
                    "Upstream connection was lost; native finalization is not confirmed."
                )

    async def receive():
        async for event in events:
            await observe(event)
            check_client_tasks()
            if closed:
                return
        raise DemoError(
            "WebSocket ended without session.closed; finalization is unconfirmed."
        )

    async def send_microphone():
        # audio.frames() yields raw PCM; the SDK base64-encodes bytes before sending.
        async for pcm in audio.frames(stop):
            await connection.session.input_audio.append(audio=pcm)

    async def send_typed():
        # A typed message is a user message for the session's backend, then a request to
        # answer it. With Responses delegation GPT Live delegates it to the backend; with a
        # Foundry-managed agent, Foundry runs the agent. GPT Live speaks the answer.
        while True:
            text = await transcript.typed_messages.get()
            item_id, run_id = f"typed-{uuid4().hex[:12]}", f"typed-run-{uuid4().hex[:12]}"
            typed_events.update((item_id, run_id))
            transcript.append_typed(text)
            await connection.response.item.create(
                item={"type": "message", "role": "user", "content": [{"type": "input_text", "text": text}]},
                event_id=item_id,
            )
            await connection.response.create(event_id=run_id)
            transcript.set_status("Typed message sent; the backend is answering.")

    try:
        # Foundry owns session.start. Wait for service-owned readiness; do not start again.
        async with asyncio.timeout(30):
            async for event in events:
                await observe(event)
                if event.get("type") == "session.started":
                    session_id = event.session.id
                    # Foundry adds this top-level field; it is not session.id.
                    value = event.conversation_id
                    if isinstance(value, str) and value.strip():
                        conversation_id = value
                    actual_format = event.session.audio and event.session.audio.format
                    if actual_format and (actual_format.type, actual_format.rate) != (
                        "audio/pcm",
                        RATE,
                    ):
                        raise DemoError(
                            "The negotiated format is not the requested PCM16/24 kHz."
                        )
                    break
                if closed:
                    raise DemoError("Live closed before startup completed.")
            else:
                raise DemoError("WebSocket ended before session.started.")
        if not stop.is_set():
            transcript.set_status(
                f"Ready: {session_id}. Speak into your microphone"
                + (" or type below" if typed_input else "")
                + "; Ctrl+C ends the English lesson."
            )
            audio.start()
            audio_started = True
        transcript.enable_typing(
            typed_input,
            "Type a message and press Enter; the backend answers and GPT Live speaks the reply."
            if typed_input
            else "Typed input needs a Responses or Foundry-managed agent backend; this session uses client delegation.",
        )
        receiver = asyncio.create_task(receive())
        sender = asyncio.create_task(send_microphone())
        typist = asyncio.create_task(send_typed())
        stopped = asyncio.create_task(stop.wait())
        tasks.extend([receiver, sender, typist, stopped])
        done, _ = await asyncio.wait(
            [receiver, sender, typist, stopped], return_when=asyncio.FIRST_COMPLETED
        )
        if receiver in done:
            receiver.result()
        elif sender in done:
            sender.result()
        elif typist in done:
            typist.result()
        stop.set()
        transcript.enable_typing(False, "The lesson has ended.")
        audio.stop_microphone()
        for task in (sender, typist):
            task.cancel()
        await asyncio.gather(sender, typist, return_exceptions=True)
        if not receiver.done():
            transcript.set_status("Closing; waiting for session.closed...")
            close_sent = True
            async with asyncio.timeout(5):
                await connection.session.close()
            async with asyncio.timeout(15):
                await receiver
        if audio_started:
            await audio.drain()
        return conversation_id
    except ConnectionResetError as exc:
        # The SDK ends iteration on a graceful close and raises this for an abnormal one.
        raise DemoError(
            "WebSocket ended without session.closed; finalization is unconfirmed."
        ) from exc
    finally:
        stop.set()
        for task in [*tasks, *client_tasks]:
            task.cancel()
        await asyncio.gather(*tasks, *client_tasks, return_exceptions=True)
        if session_id and not closed and not close_sent:
            with contextlib.suppress(Exception):
                async with asyncio.timeout(3):
                    await connection.session.close()
        signal.signal(signal.SIGINT, old_sigint)


async def check_deployments(project, definition):
    """Check the configured model deployments with read-only requests."""
    deployments = {
        "GPT_LIVE_DEPLOYMENT": definition.model,
    }
    # Created definitions hold typed delegation models, while service readback returns
    # a plain dict. Both are mappings, so key access works for either.
    delegation = definition.delegation or {}
    if delegation.get("type") == "responses":
        deployments["RESPONSE_DELEGATION_DEPLOYMENT"] = delegation["responses"]["model"]
    for setting, name in deployments.items():
        with service_errors(
            f"Check deployment '{name}'",
            not_found=f"Deployment '{name}' was not found in this project. "
            f"Check the existing agent's deployment, or {setting} for a new agent.",
        ):
            deployment = await project.deployments.get(name)
        if deployment.name != name:
            raise DemoError(f"Deployment readback did not match {setting}='{name}'.")
        print(f"Deployment verified: {setting}={name}", flush=True)


async def main(
    *,
    auto_delete: bool = False,
    learner_name: str = DEFAULT_LEARNER_NAME,
    level: str = DEFAULT_LEVEL,
    definition_factory=agent_definition,
    reuse_agent_name: bool = True,
    client_executor=None,
):
    """Create the agent from definition_factory, or reuse AGENT_NAME when reuse_agent_name."""
    base = project_endpoint()
    existing_agent = os.getenv("AGENT_NAME", "").strip() if reuse_agent_name else ""
    name = existing_agent or f"english-teacher-{uuid4().hex[:12]}"
    definition = None if existing_agent else definition_factory()
    created = False
    credential = project_credential()
    async with (
        credential,
        # allow_preview sends the VoiceAgents=V1Preview feature header for voice agents.
        AIProjectClient(endpoint=base, credential=credential, allow_preview=True) as project,
    ):
        if definition is not None:
            await check_deployments(project, definition)
        try:
            with Audio() as audio:
                if not existing_agent:
                    with service_errors("Create agent"):
                        version = (
                            await project.agents.create_version(name, definition=definition)
                        ).version
                    created = True
                    print(
                        f"Created English teacher agent: {name}, version {version}",
                        flush=True,
                    )
                with service_errors(
                    "Read agent",
                    not_found=f"Agent '{name}' was not found in this project. Check AGENT_NAME."
                    if existing_agent
                    else None,
                ):
                    latest = (await project.agents.get(name)).versions.latest
                definition = latest.definition
                # Readback returns VoiceAgentLiveDefinition only for sub_protocol=live.
                if not isinstance(definition, VoiceAgentLiveDefinition):
                    raise DemoError(
                        "The agent must use sub_protocol=live. "
                        "Check AGENT_NAME or the created agent definition."
                    )
                if existing_agent:
                    version = latest.version
                    print(f"Using existing agent: {name}, version {version}", flush=True)
                    await check_deployments(project, definition)
                delegation = definition.delegation or {}
                managed_delegation = delegation.get("type") in {
                    "foundry_managed_agent",
                    "managed_prompt_agent",
                }
                backend_model = (
                    f"{delegation['agent_name']}:{delegation.get('agent_version') or 'active'}"
                    if managed_delegation
                    else (delegation.get("responses") or {}).get("model")
                    or delegation.get("type", "client")
                )

                structured_inputs = structured_inputs_for(
                    definition, {"learner_name": learner_name, "level": level}
                )
                print(
                    "Structured inputs: "
                    + (
                        ", ".join(f"{key}={value}" for key, value in structured_inputs.items())
                        if structured_inputs
                        else "none (the agent declares none)"
                    ),
                    flush=True,
                )

                # The SDK opens the agent's .../endpoint/protocols/voice/live/sessions
                # WebSocket with the project credential and the preview header, and sends
                # the structured inputs in its query. Foundry sends session.start, including
                # the filled-in greeting; the client only waits for session.started.
                async with project.beta.voice_agents.live.connect(
                    agent_name=name,
                    agent_version=str(version),
                    structured_inputs=structured_inputs,
                ) as connection:
                    async with TranscriptDisplay() as transcript:
                        conversation_id = await converse(
                            connection,
                            audio,
                            transcript,
                            backend_model,
                            managed_delegation=managed_delegation,
                            client_executor=client_executor,
                            # Client delegation has no backend to answer typed messages.
                            typed_input=managed_delegation or delegation.get("type") == "responses",
                        )
            if conversation_id:
                print(f"Conversation id: {conversation_id}", flush=True)
                if created and auto_delete:
                    print(
                        "The agent will be deleted (--auto-delete). "
                        "Omit this option to download the conversation later.",
                        flush=True,
                    )
                else:
                    downloader = (
                        Path(__file__).resolve().parents[2]
                        / "download_conversation_artifacts.py"
                    )
                    command_prefix = "& " if os.name == "nt" else ""
                    print(
                        "Download it later with the shared downloader "
                        "(run from the repository root):\n"
                        f"Set AZURE_VOICE_AGENTS_ENDPOINT to {base}.\n"
                        f'{command_prefix}"{sys.executable}" "{downloader}" '
                        f'"{name}" "{conversation_id}"',
                        flush=True,
                    )
            else:
                print("No persisted conversation id was returned.", flush=True)
        finally:
            if created and auto_delete:
                try:
                    with contextlib.suppress(ResourceNotFoundError):
                        await project.agents.delete(name)
                    print(f"Deleted temporary demo agent: {name}", flush=True)
                except Exception as exc:
                    print(
                        f"Cleanup failed ({type(exc).__name__}); delete agent {name} manually.",
                        flush=True,
                    )
            elif created:
                print(
                    f"Kept agent: {name}. Delete it in your Foundry project when finished.",
                    flush=True,
                )


# Settings, URL construction, and error handling stay in this sample.
def required(name):
    value = os.getenv(name, "").strip()
    if not value:
        raise DemoError(f"Set {name} in .env or the process environment.")
    return value


def project_endpoint():
    value = os.getenv("FOUNDRY_PROJECT_ENDPOINT", "").strip()
    if not value:
        raise DemoError(
            "Set FOUNDRY_PROJECT_ENDPOINT=https://YOUR-RESOURCE.services.ai.azure.com/api/projects/YOUR-PROJECT "
            "in .env. This creates a voice agent in an EXISTING project, not a new Azure project."
        )
    url = urlsplit(value.strip())
    local = url.hostname in {"localhost", "127.0.0.1", "::1"}
    path = url.path.rstrip("/")
    if (
        not url.hostname
        or url.username is not None
        or url.password is not None
        or url.query
        or url.fragment
        or (url.scheme != "https" and not (local and url.scheme == "http"))
        or not path.startswith("/api/projects/")
        or not path.removeprefix("/api/projects/")
        or "/" in path.removeprefix("/api/projects/")
    ):
        raise DemoError(
            "Use an HTTPS project endpoint ending in /api/projects/YOUR-PROJECT without credentials/query/fragment."
        )
    return urlunsplit((url.scheme, url.netloc, path, "", ""))


def project_credential():
    # Select the matching signed-in account without changing az's global default.
    subscription = os.getenv("AZURE_SUBSCRIPTION_ID", "").strip() or None
    return AzureCliCredential(subscription=subscription)


@contextlib.contextmanager
def service_errors(action, *, not_found=None):
    """Turn Projects SDK HTTP errors into short hints.

    Authentication failures keep their own handler in run_cli.
    """
    try:
        yield
    except ClientAuthenticationError:
        raise
    except HttpResponseError as exc:
        if exc.status_code == 404 and not_found:
            raise DemoError(not_found) from None
        hint = {
            403: "Check the signed-in identity's project permissions and preview access.",
            404: "Check the project endpoint and whether this service has the Live implementation.",
            429: "Deployment quota is exhausted; retry later.",
        }.get(exc.status_code, "Check the request and service configuration.")
        raise DemoError(f"{action}: HTTP {exc.status_code}. {hint}") from exc


def add_lesson_arguments(parser):
    """The structured-input values each session supplies when it connects."""
    parser.add_argument(
        "--learner-name",
        default=DEFAULT_LEARNER_NAME,
        help=f"Name the teacher greets and uses (structured input learner_name; default {DEFAULT_LEARNER_NAME}).",
    )
    parser.add_argument(
        "--level",
        choices=LEVELS,
        default=DEFAULT_LEVEL,
        help=f"The learner's English level (structured input level; default {DEFAULT_LEVEL}).",
    )


def run_cli(main_function=None, *, description=__doc__):
    parser = argparse.ArgumentParser(description=description, allow_abbrev=False)
    parser.add_argument(
        "--auto-delete",
        action="store_true",
        default=False,
        help="Delete only the agent created by this run on exit (default: keep it).",
    )
    add_lesson_arguments(parser)
    args = parser.parse_args()
    if not args.learner_name.strip():
        parser.error("--learner-name must not be empty.")
    try:
        # samples/gpt_live/.env is shared by the Python and JavaScript samples.
        load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)
        asyncio.run(
            (main_function or main)(
                auto_delete=args.auto_delete,
                learner_name=args.learner_name.strip(),
                level=args.level,
            )
        )
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        raise SystemExit(130)
    except ClientAuthenticationError:
        print(
            "\nAzure CLI authentication failed. Run az login with an account that "
            "can access this project, and check AZURE_SUBSCRIPTION_ID in .env.",
            file=sys.stderr,
        )
        raise SystemExit(1)
    except (DemoError, AudioError) as exc:
        print(f"\nError: {exc}", file=sys.stderr)
        raise SystemExit(1)
    except Exception as exc:
        response = getattr(exc, "response", None)
        status = getattr(exc, "status_code", None) or getattr(
            response, "status_code", None
        )
        detail = f" (HTTP {status})" if status else ""
        print(
            f"\n{type(exc).__name__}{detail}. Check your .env settings and endpoint access.",
            file=sys.stderr,
        )
        raise SystemExit(1)


if __name__ == "__main__":
    run_cli()
