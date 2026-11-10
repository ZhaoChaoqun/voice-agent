import os

from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import (
    InlineVoiceSubagent,
    RealtimeAudioFormatsAudioPcm,
    VoiceAgentAudioConfig,
    VoiceAgentAudioInputConfig,
    VoiceAgentAudioOutputConfig,
    VoiceAgentDefinition,
    VoiceAgentHandoffCondition,
    VoiceAgentHandoffPolicy,
    VoiceAgentInlineSubagentConfig,
    VoiceAgentInputTranscription,
    VoiceAgentServerVadTurnDetection,
    VoiceAgentVoiceConfig,
)
from azure.identity import DefaultAzureCredential

endpoint = os.environ["FOUNDRY_PROJECT_ENDPOINT"]
agent_name = os.environ["FOUNDRY_VOICE_AGENT_NAME"]

definition = VoiceAgentDefinition(
    model_type="managed",
    model="gpt-realtime",
    instructions=(
        "You are the voice assistant for a clinic front desk. Follow the shared "
        "privacy policy and speak briefly. Never claim that an appointment has "
        "been booked, changed, or cancelled."
    ),
    output_modalities=["audio"],
    audio=VoiceAgentAudioConfig(
        input=VoiceAgentAudioInputConfig(
            format=RealtimeAudioFormatsAudioPcm(rate=24000),
            turn_detection=VoiceAgentServerVadTurnDetection(
                threshold=0.5,
                prefix_padding_ms=300,
                silence_duration_ms=1000,
            ),
            transcription=VoiceAgentInputTranscription(model="azure-speech"),
        ),
        output=VoiceAgentAudioOutputConfig(
            format=RealtimeAudioFormatsAudioPcm(rate=24000),
            voice="en-US-AvaNeural",
            voice_type="azure-standard",
        ),
    ),
    subagent_config=VoiceAgentInlineSubagentConfig(
        subagents=[
            InlineVoiceSubagent(
                id="$entrypoint",
                display_description="Front desk and request triage",
                inherit_base_instructions=True,
                instructions=(
                    "Greet the caller and identify the request. Answer general "
                    "questions. This stage can't help with appointments: never "
                    "ask for appointment details here. Routes: scheduling, as "
                    "soon as the caller mentions an appointment. When you hand "
                    "off, call the handoff tool without speaking first."
                ),
                tools=[],
                parallel_tool_calls=False,
                handoff_conditions=[
                    VoiceAgentHandoffCondition(
                        id="entry_to_scheduling",
                        target="scheduling",
                        condition="The caller wants help with an appointment.",
                        cancel_on_interruption=True,
                        target_response="auto",
                    )
                ],
            ),
            InlineVoiceSubagent(
                id="scheduling",
                display_description="Appointment scheduling",
                inherit_base_instructions=True,
                instructions=(
                    "Ask whether the caller wants to book, reschedule, or cancel. "
                    "Collect their preferred date and summarize the request. "
                    "Explain that this demo doesn't change any appointments. "
                    "Ask the caller to confirm the summary and answer any "
                    "follow-up questions. This stage doesn't say goodbye. "
                    "Routes: end, as soon as the caller confirms the summary "
                    "and is ready to finish. When you hand off, call the "
                    "handoff tool without speaking first."
                ),
                tools=[],
                parallel_tool_calls=False,
                audio_output=VoiceAgentVoiceConfig(
                    voice="en-US-JennyNeural",
                    voice_type="azure-standard",
                ),
                handoff_conditions=[
                    VoiceAgentHandoffCondition(
                        id="scheduling_to_end",
                        target="end",
                        condition=(
                            "The caller has confirmed the summarized appointment "
                            "request and is ready to finish the conversation."
                        ),
                        target_response="auto",
                    )
                ],
            ),
            InlineVoiceSubagent(
                id="end",
                display_description="Request summary and goodbye",
                inherit_base_instructions=True,
                instructions=(
                    "Briefly repeat the confirmed request and remind the caller "
                    "that this demo hasn't changed any appointments. Thank them "
                    "and say goodbye. Don't ask further questions or offer "
                    "additional help."
                ),
                tools=[],
                handoff_conditions=[],
            ),
        ],
        handoff_policy=VoiceAgentHandoffPolicy(max_transfers=8, max_attempts=10),
    ),
)

with (
    DefaultAzureCredential() as credential,
    AIProjectClient(
        endpoint=endpoint,
        credential=credential,
        allow_preview=True,
    ) as project_client,
):
    created = project_client.agents.create_version(
        agent_name=agent_name,
        definition=definition,
        description="Appointment intake with inline subagents",
    )
    readback = project_client.agents.get_version(
        agent_name=agent_name,
        agent_version=created.version,
    )
    saved_config = readback.definition.subagent_config
    if not isinstance(saved_config, VoiceAgentInlineSubagentConfig):
        raise RuntimeError("The saved version didn't preserve inline mode.")

    print(f"Created '{created.name}', version {created.version}")
    for subagent in saved_config.subagents:
        voice = subagent.audio_output.voice if subagent.audio_output else "default"
        targets = [route.target for route in subagent.handoff_conditions or []]
        print(f"{subagent.id}: voice={voice}, routes={targets}")
    policy = saved_config.handoff_policy
    print(f"max_transfers={policy.max_transfers}, max_attempts={policy.max_attempts}")
