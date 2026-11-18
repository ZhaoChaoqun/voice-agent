import { describe, expect, it, vi } from "vitest";
import {
  agentDefinitions,
  livePublishSettings,
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

describe("optional GPT Live Agent configuration", () => {
  const liveEnv = {
    FOUNDRY_PROJECT_ENDPOINT: endpoint,
    SMART_HOME_GPT_LIVE_AGENT: "unit-live",
  };
  type Live = {
    delegation: {
      type: string;
      responses: { model: string; tools: { name: string }[] };
    };
  };

  it("renders a compact gpt-live-1 Agent with Responses delegation and household tools", () => {
    const definition = agentDefinitions().live;
    expect(definition).toMatchObject({
      kind: "voice",
      model: "gpt-live-1",
      sub_protocol: "live",
      greeting: { type: "template", text: "{{{welcome_text}}}" },
      structured_inputs: { welcome_text: { schema: { type: "string" } } },
      delegation: { type: "responses", responses: { tool_choice: "auto" } },
    });
    const responses = (definition as Live).delegation.responses;
    expect(responses.model).toBe("");
    expect(responses.tools.map((tool) => tool.name)).toEqual(
      tools.map((tool) => tool.name),
    );
    // Large embedded references stopped Live context injection; keep the voice prompt compact.
    expect(String(definition.instructions).length).toBeLessThan(3_000);
    expect(definition.instructions).toContain("小镇日记");
    expect(JSON.stringify(definition)).not.toMatch(
      /\/subscriptions\/|services\.ai\.azure\.com/,
    );
  });

  it("requires an explicit GPT Live Agent and confirmed project to publish", () => {
    expect(livePublishSettings(liveEnv, endpoint)).toEqual({
      endpoint,
      agents: [{ edition: "live", name: "unit-live" }],
      delegationDeployment: undefined,
    });
    const other = "https://other.services.ai.azure.com/api/projects/other";
    expect(
      livePublishSettings(
        {
          ...liveEnv,
          SMART_HOME_GPT_LIVE_PROJECT_ENDPOINT: other,
          SMART_HOME_GPT_LIVE_DELEGATION_DEPLOYMENT: "unit-text",
        },
        other,
      ).delegationDeployment,
    ).toBe("unit-text");
    expect(() => livePublishSettings(liveEnv, undefined)).toThrow(
      "confirm-project",
    );
    expect(() =>
      livePublishSettings({ FOUNDRY_PROJECT_ENDPOINT: endpoint }, endpoint),
    ).toThrow();
    expect(() =>
      livePublishSettings(
        { ...liveEnv, SMART_HOME_GPT_LIVE_AGENT: "REPLACE_WITH_AGENT" },
        endpoint,
      ),
    ).toThrow("placeholders");
  });

  it("creates an absent GPT Live Agent only with an explicit delegation deployment", async () => {
    const template = agentDefinitions().live;
    const absent = vi.fn<AuthoringRequest>().mockResolvedValueOnce(undefined);
    await expect(publishAgent(absent, "unit-live", template)).rejects.toThrow(
      "SMART_HOME_GPT_LIVE_DELEGATION_DEPLOYMENT",
    );
    expect(absent).toHaveBeenCalledTimes(1);

    const expected = structuredClone(template) as Live;
    expected.delegation.responses.model = "unit-text";
    const request = vi
      .fn<AuthoringRequest>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(version(expected).versions.latest)
      .mockResolvedValueOnce(version(expected));
    await publishAgent(request, "unit-live", template, {
      delegationDeployment: "unit-text",
    });
    expect(request).toHaveBeenNthCalledWith(2, "/agents/unit-live/versions", {
      definition: expected,
    });
  });

  it("updates an existing GPT Live Agent while keeping its saved deployment and opaque fields", async () => {
    const saved = structuredClone(agentDefinitions().live) as Live &
      Record<string, unknown>;
    saved.delegation.responses.model = "saved-text";
    saved.store = true;
    saved.model_type = "managed";
    const request = vi
      .fn<AuthoringRequest>()
      .mockResolvedValueOnce(version(saved))
      .mockResolvedValueOnce(version(saved))
      .mockResolvedValueOnce(version(saved, "2").versions.latest)
      .mockResolvedValueOnce(version(saved, "2"));
    await publishAgent(request, "unit-live", agentDefinitions().live);
    expect(request).toHaveBeenNthCalledWith(3, "/agents/unit-live/versions", {
      definition: saved,
    });
  });

  it("refuses to repurpose a non-Live or different-model Agent", async () => {
    for (const existing of [
      agentDefinitions().realtime,
      { ...agentDefinitions().live, model: "other-live-model" },
      { ...agentDefinitions().live, sub_protocol: "realtime" },
    ]) {
      const request = vi
        .fn<AuthoringRequest>()
        .mockResolvedValue(version(existing));
      await expect(
        publishAgent(request, "unit-live", agentDefinitions().live),
      ).rejects.toThrow("kind or model");
    }
  });
});
