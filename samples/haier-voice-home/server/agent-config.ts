/** Preserve Portal-owned settings while authoring the shared concierge behavior. */
import { z } from "zod";
import { homeGreeting } from "#server/greeting";
import {
  FLASH_TURN_DETECTION,
  HOME_ECHO_CANCELLATION,
  HOME_INPUT_AUDIO,
} from "#server/voice-profile";

const objectSchema = z.record(z.string(), z.unknown()); // Preserve opaque service fields without guessing defaults.
const definitionSchema = z
  .object({
    kind: z.literal("voice"),
    model: z.string().min(1),
    model_type: z.enum(["managed", "self_deployed"]),
    instructions: z.string(),
    tools: z.array(objectSchema),
    structured_inputs: objectSchema.optional(),
    audio: z.object({
      input: objectSchema,
      output: z
        .object({
          voice: z.string().min(1),
          voice_type: z.string().min(1),
        })
        .passthrough(),
    }),
    output_modalities: z.array(z.string()),
    store: z.boolean(),
  })
  .passthrough();

export interface ConciergeDefinition {
  instructions: string;
  tools: object[];
}

type VoiceDefinition = z.infer<typeof definitionSchema>;

/**
 * Merge concierge changes into the exact wire definition without losing opaque fields.
 *
 * Parameters
 * ----------
 * definition : unknown
 *     Latest remote definition, read immediately before publishing.
 * concierge : ConciergeDefinition
 *     Shared home instructions and function tools.
 *
 * Returns
 * -------
 * Record<string, unknown>
 *     Complete authoring API definition for the same model and Agent identity.
 */
export function voiceAgentDefinition(
  definition: unknown,
  concierge: ConciergeDefinition,
): Record<string, unknown> {
  const current = definitionSchema.parse(definition);
  return {
    ...current,
    instructions: concierge.instructions,
    tools: concierge.tools,
    structured_inputs: {
      ...current.structured_inputs,
      welcome_text: {
        description:
          "Initial welcome only; speech recognition remains bilingual.",
        schema: { type: "string", minLength: 1, maxLength: 200 },
        default_value: homeGreeting("zh").text,
      },
    },
    greeting: {
      ...objectSchema.parse(current.greeting ?? {}),
      type: "template",
      text: "{{{welcome_text}}}",
    },
    audio: { ...current.audio, input: wireInputAudio(current) },
  };
}

function wireInputAudio(current: VoiceDefinition): Record<string, unknown> {
  const input = structuredClone(current.audio.input);
  input.format = { type: "audio/pcm", rate: 24000 };
  input.echo_cancellation = structuredClone(HOME_ECHO_CANCELLATION);
  const isFlash = current.model.startsWith("microsoft-realtime-flash");
  if (!isFlash || input.noise_reduction === undefined) {
    input.noise_reduction = structuredClone(HOME_INPUT_AUDIO.noise_reduction);
  }
  if (!isFlash || input.transcription === undefined) {
    input.transcription = structuredClone(HOME_INPUT_AUDIO.transcription);
  }
  const transcription = objectSchema.parse(input.transcription ?? {});
  if (
    transcription.model === "azure-speech-streaming" &&
    !transcription.language
  )
    input.transcription = {
      ...transcription,
      language: HOME_INPUT_AUDIO.transcription.language,
    };
  return {
    ...input,
    turn_detection: structuredClone(turnDetectionProfile(current.model)),
  };
}

function remainingFields(
  fields: Record<string, unknown>,
  owned: string[],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).filter(([key]) => !owned.includes(key)),
  );
}

function voiceOutput(
  output: z.infer<typeof definitionSchema>["audio"]["output"],
): object {
  const { voice, voice_type, voice_locale, style, pitch, volume, ...audio } =
    output;
  return {
    ...audio,
    voice: {
      type: voice_type,
      name: voice,
      locale: voice_locale,
      style,
      pitch,
      volume,
    },
  };
}

/**
 * Build an azd service without resetting independently edited Portal settings.
 *
 * Parameters
 * ----------
 * name : string
 *     Existing Agent name; never a new deployment alias.
 * definition : unknown
 *     Latest remote Voice Agent definition, validated before authoring.
 * concierge : ConciergeDefinition
 *     Shared instructions and locally executed tool contracts.
 *
 * Returns
 * -------
 * Record<string, unknown>
 *     Declarative azd service, including opaque advanced input configuration.
 */
export function voiceAgentService(
  name: string,
  definition: unknown,
  concierge: ConciergeDefinition,
): Record<string, unknown> {
  const current = definitionSchema.parse(definition);
  return {
    ...serviceSettings(name, current),
    ...conciergeSettings(current, concierge),
    audio: {
      input: authoringInputAudio(current),
      output: voiceOutput(current.audio.output),
    },
    definitionOverlay: definitionOverlay(current),
  };
}

function serviceSettings(name: string, current: VoiceDefinition): object {
  return {
    host: "azure.ai.agent",
    kind: current.kind,
    name,
    model: { id: current.model },
    modelType: current.model_type,
    subProtocol: current.sub_protocol,
    outputModalities: current.output_modalities,
    store: current.store,
  };
}

function conciergeSettings(
  current: VoiceDefinition,
  concierge: ConciergeDefinition,
): object {
  return {
    instructions: concierge.instructions,
    tools: concierge.tools,
    structuredInputs: {
      ...current.structured_inputs,
      welcome_text: {
        description:
          "Initial welcome only; subsequent speech language remains automatic.",
        schema: { type: "string", minLength: 1, maxLength: 200 },
        defaultValue: homeGreeting("zh").text,
      },
    },
    greeting: {
      ...objectSchema.parse(current.greeting ?? {}),
      type: "template",
      text: "{{{welcome_text}}}",
    },
  };
}

function turnDetectionProfile(model: string): Record<string, unknown> {
  if (model.startsWith("microsoft-realtime-flash")) return FLASH_TURN_DETECTION;
  return HOME_INPUT_AUDIO.turn_detection;
}

function authoringInputAudio(current: VoiceDefinition): object {
  const input = current.audio.input;
  return {
    format: input.format,
    echoCancellation: HOME_ECHO_CANCELLATION,
    noiseReduction: { type: HOME_INPUT_AUDIO.noise_reduction.type },
    transcription: HOME_INPUT_AUDIO.transcription,
    turnDetection: authoringTurnDetection(current.model),
  };
}

function definitionOverlay(current: VoiceDefinition): object {
  return {
    ...remainingFields(current, [
      "kind",
      "model",
      "model_type",
      "sub_protocol",
      "instructions",
      "tools",
      "structured_inputs",
      "greeting",
      "audio",
      "output_modalities",
      "store",
    ]),
    audio: {
      input: advancedInputAudio(current),
      output: remainingFields(current.audio.output, [
        "format",
        "voice",
        "voice_type",
        "voice_locale",
        "style",
        "pitch",
        "volume",
        "speed",
      ]),
    },
  };
}

function authoringTurnDetection(model: string): object {
  const profile = turnDetectionProfile(model);
  return {
    type: profile.type,
    profile: profile.profile,
    removeFillerWords: profile.remove_filler_words,
    createResponse: profile.create_response,
    interruptResponse: profile.interrupt_response,
    autoTruncate: profile.auto_truncate,
  };
}

function advancedInputAudio(current: VoiceDefinition): object {
  const input = current.audio.input;
  return {
    ...remainingFields(input, [
      "format",
      "echo_cancellation",
      "noise_reduction",
      "transcription",
      "turn_detection",
    ]),
    noise_reduction: {
      detection_input: HOME_INPUT_AUDIO.noise_reduction.detection_input,
    },
    turn_detection: {},
  };
}
