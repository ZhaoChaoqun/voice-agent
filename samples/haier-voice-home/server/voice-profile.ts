/** Shared, resource-independent speech settings for both Voice Agents. */

export const HOME_VOICE_NAME = "zh-CN-Xiaoxiao:DragonHDFlashLatestNeural";

// Browser capture sends one mono PCM channel. Server-reference AEC keeps the
// wire shape mono; client-reference AEC would require interleaved stereo.
export const HOME_ECHO_CANCELLATION = {
  type: "server_echo_cancellation",
  reference_source: "server",
  channels: 1,
};

export const HOME_TURN_DETECTION = {
  type: "azure_semantic_vad",
  auto_truncate: true,
  profile: "normal",
  remove_filler_words: false,
  create_response: true,
  interrupt_response: true,
};

// Agent authoring and configuration regressions share the requested input
// profile. The relay leaves these fields to the deployed Agent, not a local override.
export const HOME_INPUT_AUDIO = {
  turn_detection: HOME_TURN_DETECTION,
  noise_reduction: {
    type: "azure_personal_noise_suppression",
    detection_input: "mas_dns",
  },
  transcription: {
    model: "azure-speech-streaming",
    language: "zh-CN,en-US",
  },
};

export const FLASH_TURN_DETECTION = HOME_TURN_DETECTION;
