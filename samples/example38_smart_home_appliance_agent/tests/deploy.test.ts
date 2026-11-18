import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const renderer = fileURLToPath(
  new URL("../deploy/render-container-app.mjs", import.meta.url),
);
const env = {
  PATH: process.env.PATH,
  AZURE_SUBSCRIPTION_ID: "unit-subscription",
  AZURE_LOCATION: "unit-region",
  SMART_HOME_CONTAINER_APP_NAME: "unit-home",
  SMART_HOME_CONTAINER_APP_ENVIRONMENT_ID:
    "/subscriptions/unit-subscription/resourceGroups/unit/providers/Microsoft.App/managedEnvironments/unit",
  SMART_HOME_MANAGED_IDENTITY_ID:
    "/subscriptions/unit-subscription/resourceGroups/unit/providers/Microsoft.ManagedIdentity/userAssignedIdentities/unit",
  SMART_HOME_REGISTRY_SERVER: "unit-registry.azurecr.io",
  SMART_HOME_IMAGE: "unit-registry.azurecr.io/home:unit",
  SMART_HOME_PUBLIC_ORIGIN: "https://unit-home.example.test",
  FOUNDRY_PROJECT_ENDPOINT:
    "https://example.services.ai.azure.com/api/projects/example",
  SMART_HOME_ACCESS_CODE: "unit-test-access-code-not-a-real-credential",
  SMART_HOME_SESSION_SECRET: "unit-test-signing-secret-not-a-real-credential",
  SMART_HOME_FLASH_AGENT: "unit-flash",
  SMART_HOME_VERIFIED_MODELS: "microsoft-realtime-flash-1",
  AZURE_CLIENT_ID: "unit-client",
  SMART_HOME_ENVIRONMENT_STORAGE: "unit-storage",
};

describe("offline ACA manifest renderer", () => {
  it("has no default deployment target", () => {
    const result = spawnSync(process.execPath, [renderer], {
      env: {},
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("AZURE_SUBSCRIPTION_ID");
  });

  it.each(["1", "0"])(
    "renders minReplicas=%s with protected isolated storage",
    (minimum) => {
      const directory = mkdtempSync(join(tmpdir(), "smart-home-deploy-test-"));
      try {
        const output = execFileSync(process.execPath, [renderer], {
          cwd: directory,
          env: { ...env, SMART_HOME_MIN_REPLICAS: minimum },
          encoding: "utf8",
        });
        expect(output).not.toContain(env.SMART_HOME_ACCESS_CODE);
        const manifest = JSON.parse(
          readFileSync(join(directory, ".local/container-app.json"), "utf8"),
        );
        expect(manifest.properties.template.scale).toEqual({
          minReplicas: Number(minimum),
          maxReplicas: 1,
        });
        expect(manifest.properties.template.containers[0].env).toContainEqual({
          name: "SMART_HOME_PUBLIC_GUEST_ACCESS",
          value: "0",
        });
        expect(manifest.properties.template.containers[0].env).toContainEqual({
          name: "SMART_HOME_FLASH_AGENT",
          value: "unit-flash",
        });
        expect(manifest.properties.template.volumes[0].storageType).toBe(
          "AzureFile",
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it.each([
    { SMART_HOME_MIN_REPLICAS: "2" },
    { SMART_HOME_PUBLIC_GUEST_ACCESS: "1" },
    { SMART_HOME_IMAGE: "untrusted.invalid/home:unit" },
    { SMART_HOME_SESSION_SECRET: "short" },
    { SMART_HOME_VERIFIED_MODELS: "unsupported-model" },
  ])("rejects unsafe/invalid deployment input %j", (override) => {
    const result = spawnSync(process.execPath, [renderer], {
      env: { ...env, ...override },
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
  });

  it("includes the explicit Realtime Agent when enabling the comparison model", () => {
    const directory = mkdtempSync(join(tmpdir(), "smart-home-deploy-test-"));
    try {
      execFileSync(process.execPath, [renderer], {
        cwd: directory,
        env: {
          ...env,
          SMART_HOME_VERIFIED_MODELS:
            "microsoft-realtime-flash-1,gpt-realtime-2.1",
          SMART_HOME_REALTIME_AGENT: "unit-realtime",
        },
        encoding: "utf8",
      });
      const manifest = JSON.parse(
        readFileSync(join(directory, ".local/container-app.json"), "utf8"),
      );
      expect(manifest.properties.template.containers[0].env).toContainEqual({
        name: "SMART_HOME_REALTIME_AGENT",
        value: "unit-realtime",
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("includes the explicit GPT Live Agent only when GPT Live is verified", () => {
    const directory = mkdtempSync(join(tmpdir(), "smart-home-deploy-test-"));
    try {
      const live = {
        ...env,
        SMART_HOME_VERIFIED_MODELS: "microsoft-realtime-flash-1,gpt-live-1",
      };
      expect(
        spawnSync(process.execPath, [renderer], { env: live }).status,
      ).not.toBe(0);
      execFileSync(process.execPath, [renderer], {
        cwd: directory,
        env: {
          ...live,
          SMART_HOME_GPT_LIVE_AGENT: "unit-live",
          SMART_HOME_GPT_LIVE_PROJECT_ENDPOINT:
            "https://other.services.ai.azure.com/api/projects/other",
        },
        encoding: "utf8",
      });
      const manifest = JSON.parse(
        readFileSync(join(directory, ".local/container-app.json"), "utf8"),
      );
      expect(manifest.properties.template.containers[0].env).toEqual(
        expect.arrayContaining([
          { name: "SMART_HOME_GPT_LIVE_AGENT", value: "unit-live" },
          {
            name: "SMART_HOME_GPT_LIVE_PROJECT_ENDPOINT",
            value: "https://other.services.ai.azure.com/api/projects/other",
          },
        ]),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
