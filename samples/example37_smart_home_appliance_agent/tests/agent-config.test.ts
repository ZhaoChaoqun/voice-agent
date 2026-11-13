import { describe, expect, it, vi } from "vitest";
import {
  agentDefinitions,
  publishAgent,
  publishSettings,
  type AuthoringRequest,
} from "../server/sync-agent-config";
import {
  FLASH_TURN_DETECTION,
  HOME_ECHO_CANCELLATION,
  HOME_INPUT_AUDIO,
  HOME_VOICE_NAME,
} from "../server/voice-profile";
import { tools } from "../server/tools";

const endpoint = "https://unit-test.services.ai.azure.com/api/projects/unit";
const env = {
  FOUNDRY_PROJECT_ENDPOINT: endpoint,
  SMART_HOME_FLASH_AGENT: "unit-flash",
  SMART_HOME_REALTIME_AGENT: "unit-realtime",
};
const version = (definition: object, revision = "1") => ({
  versions: { latest: { version: revision, status: "active", definition } },
});

describe("portable Voice Agent configuration", () => {
  it.each([
    ["flash", "microsoft-realtime-flash-1"],
    ["realtime", "gpt-realtime-2.1"],
  ] as const)(
    "materializes complete %s settings, tools and greeting without resource IDs",
    (edition, model) => {
      const definition = agentDefinitions()[edition]!;
      expect(definition).toMatchObject({
        kind: "voice",
        model,
        model_type: "managed",
        store: false,
        tools,
        greeting: { type: "template", text: "{{{welcome_text}}}" },
        structured_inputs: {
          welcome_text: { schema: { type: "string" } },
        },
        audio: {
          input: {
            ...HOME_INPUT_AUDIO,
            turn_detection:
              edition === "flash"
                ? FLASH_TURN_DETECTION
                : HOME_INPUT_AUDIO.turn_detection,
            echo_cancellation: HOME_ECHO_CANCELLATION,
            format: { type: "audio/pcm", rate: 24000 },
          },
          output: {
            format: { type: "audio/pcm", rate: 24000 },
            voice: HOME_VOICE_NAME,
          },
        },
      });
      expect(definition.instructions).toContain(
        'say exactly ONE brief filler acknowledgement in the user\'s language: "好的。"',
      );
      expect(definition.instructions).not.toContain("application relay");
      expect(JSON.stringify(definition)).not.toMatch(
        /\/subscriptions\/|services\.ai\.azure\.com/,
      );
    },
  );

  it("defaults publishing to a single Flash Agent", () => {
    expect(publishSettings(env, endpoint)).toEqual({
      endpoint,
      agents: [{ edition: "flash", name: "unit-flash" }],
    });
    expect(() => publishSettings({}, undefined)).toThrow();
    expect(() => publishSettings(env, "https://other.invalid")).toThrow(
      "confirm-project",
    );
    expect(() =>
      publishSettings({ ...env, SMART_HOME_FLASH_AGENT: undefined }, endpoint),
    ).toThrow();
    expect(
      publishSettings(
        {
          FOUNDRY_PROJECT_ENDPOINT: endpoint,
          SMART_HOME_FLASH_AGENT: "unit-flash",
        },
        endpoint,
      ).agents,
    ).toHaveLength(1);
  });

  it("publishes only Realtime with explicit comparison opt-in", () => {
    expect(publishSettings(env, endpoint, true).agents).toEqual([
      { edition: "realtime", name: "unit-realtime" },
    ]);
    expect(() =>
      publishSettings(
        { ...env, SMART_HOME_REALTIME_AGENT: undefined },
        endpoint,
        true,
      ),
    ).toThrow();
    expect(() =>
      publishSettings(
        { ...env, SMART_HOME_VERIFIED_MODELS: "unsupported-model" },
        endpoint,
      ),
    ).toThrow("SMART_HOME_VERIFIED_MODELS");
  });

  it("creates an absent Agent and reads back the complete configuration", async () => {
    const definition = agentDefinitions().flash;
    const request = vi
      .fn<AuthoringRequest>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(version(definition).versions.latest)
      .mockResolvedValueOnce(version(definition));
    await publishAgent(request, "unit-flash", definition);
    expect(request).toHaveBeenNthCalledWith(2, "/agents/unit-flash/versions", {
      definition,
    });
  });

  it("preserves unrelated Portal settings while publishing a new version", async () => {
    const definition = { ...agentDefinitions().realtime!, store: true };
    const request = vi
      .fn<AuthoringRequest>()
      .mockResolvedValueOnce(version(definition))
      .mockResolvedValueOnce(version(definition))
      .mockResolvedValueOnce(version(definition, "2").versions.latest)
      .mockResolvedValueOnce(version(definition, "2"));
    await publishAgent(request, "unit-realtime", agentDefinitions().realtime!);
    expect(request).toHaveBeenNthCalledWith(
      3,
      "/agents/unit-realtime/versions",
      {
        definition,
      },
    );
  });

  it("refuses a concurrent change before publishing", async () => {
    const definition = agentDefinitions().realtime!;
    const request = vi
      .fn<AuthoringRequest>()
      .mockResolvedValueOnce(version(definition))
      .mockResolvedValueOnce(version(definition, "2"));
    await expect(
      publishAgent(request, "unit-realtime", definition),
    ).rejects.toThrow("concurrently");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("refuses to convert an existing model", async () => {
    const request = vi
      .fn<AuthoringRequest>()
      .mockResolvedValue(version(agentDefinitions().realtime!));
    await expect(
      publishAgent(request, "unit-flash", agentDefinitions().flash),
    ).rejects.toThrow("kind or model");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("detects lost advanced fields during readback instead of claiming success", async () => {
    const definition = agentDefinitions().flash;
    const lost = structuredClone(definition);
    delete lost.audio;
    const request = vi
      .fn<AuthoringRequest>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(version(lost).versions.latest)
      .mockResolvedValueOnce(version(lost));
    await expect(
      publishAgent(request, "unit-flash", definition),
    ).rejects.toThrow("definition.audio");
  });

  it("detects a concurrent publish that replaced the just-created version", async () => {
    const definition = agentDefinitions().flash;
    const request = vi
      .fn<AuthoringRequest>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(version(definition).versions.latest)
      .mockResolvedValueOnce(version(definition, "2"));
    await expect(
      publishAgent(request, "unit-flash", definition),
    ).rejects.toThrow("did not become active");
  });
});
