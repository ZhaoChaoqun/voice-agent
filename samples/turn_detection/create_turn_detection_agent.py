import argparse
import os

from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import (
    RealtimeAudioFormatsAudioPcm,
    VoiceAgentAudioConfig,
    VoiceAgentAudioInputConfig,
    VoiceAgentAudioOutputConfig,
    VoiceAgentDefinition,
    VoiceAgentEchoCancellation,
    VoiceAgentInputTranscription,
    VoiceAgentNoiseReduction,
)
from azure.identity import DefaultAzureCredential

parser = argparse.ArgumentParser(description="Create a turn detection and noise suppression voice agent.")
parser.add_argument(
    "--noise-reduction",
    choices=(
        "azure_deep_noise_suppression",
        "azure_deep_noise_suppression_headset",
        "azure_personal_noise_suppression",
        "none",
    ),
    default="azure_deep_noise_suppression",
    help="Input noise suppression mode, or none for a baseline (default: %(default)s).",
)
args = parser.parse_args()

endpoint = os.environ["FOUNDRY_PROJECT_ENDPOINT"]
agent_name = os.environ["FOUNDRY_VOICE_AGENT_NAME"]

# The client library doesn't have typed models for speech_start_detection and
# end_of_utterance_detection yet, so turn_detection is passed as JSON.
turn_detection = {
    "type": "azure_semantic_vad_multilingual",
    # Decide when the caller starts a turn: backchannels such as "mm-hm"
    # don't interrupt the agent, and phrases such as "wait" always do.
    "speech_start_detection": {
        "while_assistant_speaking": {
            "acknowledgement_phrases": [
                "mm-hm", "uh-huh", "okay", "yeah", "right", "got it",
            ],
            "interruption_phrases": ["stop", "wait", "hold on"],
            # For other speech, microsoft-decision-1 judges from what the
            # caller has heard whether the speech takes the turn: "what?"
            # does, "yeah, that makes sense" doesn't.
            "turn_taking_classifier": {"threshold": 0.5},
            # Used when the model gives no verdict.
            "num_words": 3,
        },
        "while_assistant_not_speaking": {"num_words": 1},
    },
    # Decide when the caller ends a turn: microsoft-decision-1 reads the
    # transcript and the agent's last utterance, so a pause in the middle of
    # an order number doesn't end the turn.
    "end_of_utterance_detection": {
        "model": "microsoft-decision-1",
        "threshold_level": "high",
        "timeout_ms": 1500,
    },
}

definition = VoiceAgentDefinition(
    model_type="managed",
    model="gpt-realtime",
    instructions=(
        "You are the voice assistant for a parcel delivery company. Ask for "
        "the caller's 8-digit order number before anything else, and read it "
        "back digit by digit. This demo has no order data: invent a plausible "
        "delivery status and explain it in three or four sentences."
    ),
    output_modalities=["audio"],
    audio=VoiceAgentAudioConfig(
        input=VoiceAgentAudioInputConfig(
            format=RealtimeAudioFormatsAudioPcm(rate=24000),
            turn_detection=turn_detection,
            noise_reduction=(
                None if args.noise_reduction == "none"
                else VoiceAgentNoiseReduction(type=args.noise_reduction)
            ),
            echo_cancellation=VoiceAgentEchoCancellation(),
            # Speech start detection needs a streaming transcription model.
            transcription=VoiceAgentInputTranscription(
                model="azure-speech-streaming",
                language="en-US",
            ),
        ),
        output=VoiceAgentAudioOutputConfig(
            format=RealtimeAudioFormatsAudioPcm(rate=24000),
            voice="en-US-AvaNeural",
            voice_type="azure-standard",
        ),
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
        description=f"Turn detection voice agent, noise_reduction={args.noise_reduction}",
    )
    readback = project_client.agents.get_version(
        agent_name=agent_name,
        agent_version=created.version,
    )
    saved = readback.definition.audio.input.turn_detection
    for key in ("speech_start_detection", "end_of_utterance_detection"):
        if key not in saved:
            raise RuntimeError(f"The saved version doesn't include {key}.")
    noise_reduction = readback.definition.audio.input.noise_reduction
    saved_mode = noise_reduction.get("type") if noise_reduction else "none"
    if saved_mode != args.noise_reduction:
        raise RuntimeError(
            f"The saved version has noise_reduction {saved_mode}, not {args.noise_reduction}."
        )
    echo_cancellation = readback.definition.audio.input.echo_cancellation
    if not echo_cancellation or echo_cancellation.get("type") != "server_echo_cancellation":
        raise RuntimeError(
            "The saved version doesn't include echo_cancellation.type=server_echo_cancellation."
        )

    print(f"Created '{created.name}', version {created.version}")
    print(f"noise_reduction.type: {saved_mode}")
    print(f"echo_cancellation.type: {echo_cancellation['type']}")
    print(f"turn_detection.type: {saved['type']}")
    speaking = saved["speech_start_detection"]["while_assistant_speaking"]
    print(
        f"speech_start_detection while speaking: turn_taking_classifier "
        f"threshold={speaking['turn_taking_classifier']['threshold']}, "
        f"num_words={speaking['num_words']}"
    )
    eou = saved["end_of_utterance_detection"]
    print(
        f"end_of_utterance_detection: model={eou['model']}, "
        f"threshold_level={eou['threshold_level']}, timeout_ms={eou['timeout_ms']}"
    )
