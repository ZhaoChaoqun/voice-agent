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
  HAIER_CONTAINER_APP_NAME: "unit-home",
  HAIER_CONTAINER_APP_ENVIRONMENT_ID:
    "/subscriptions/unit-subscription/resourceGroups/unit/providers/Microsoft.App/managedEnvironments/unit",
  HAIER_MANAGED_IDENTITY_ID:
    "/subscriptions/unit-subscription/resourceGroups/unit/providers/Microsoft.ManagedIdentity/userAssignedIdentities/unit",
  HAIER_REGISTRY_SERVER: "unit-registry.azurecr.io",
  HAIER_IMAGE: "unit-registry.azurecr.io/home:unit",
  HAIER_PUBLIC_ORIGIN: "https://unit-home.example.test",
  FOUNDRY_PROJECT_ENDPOINT:
    "https://example.services.ai.azure.com/api/projects/example",
  HAIER_ACCESS_CODE: "unit-test-access-code-not-a-real-credential",
  HAIER_SESSION_SECRET: "unit-test-signing-secret-not-a-real-credential",
  HAIER_FLASH_AGENT: "unit-flash",
  HAIER_VERIFIED_MODELS: "microsoft-realtime-flash-1",
  AZURE_CLIENT_ID: "unit-client",
  HAIER_ENVIRONMENT_STORAGE: "unit-storage",
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
      const directory = mkdtempSync(join(tmpdir(), "haier-deploy-test-"));
      try {
        const output = execFileSync(process.execPath, [renderer], {
          cwd: directory,
          env: { ...env, HAIER_MIN_REPLICAS: minimum },
          encoding: "utf8",
        });
        expect(output).not.toContain(env.HAIER_ACCESS_CODE);
        const manifest = JSON.parse(
          readFileSync(join(directory, ".local/container-app.json"), "utf8"),
        );
        expect(manifest.properties.template.scale).toEqual({
          minReplicas: Number(minimum),
          maxReplicas: 1,
        });
        expect(manifest.properties.template.containers[0].env).toContainEqual({
          name: "HAIER_PUBLIC_GUEST_ACCESS",
          value: "0",
        });
        expect(manifest.properties.template.containers[0].env).toContainEqual({
          name: "HAIER_FLASH_AGENT",
          value: "unit-flash",
        });
        expect(manifest.properties.template.containers[0].env).toContainEqual({
          name: "HAIER_SECONDARY_MODEL_ID",
          value: "microsoft-realtime-flash-1",
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
    { HAIER_MIN_REPLICAS: "2" },
    { HAIER_PUBLIC_GUEST_ACCESS: "1" },
    { HAIER_IMAGE: "untrusted.invalid/home:unit" },
    { HAIER_SESSION_SECRET: "short" },
  ])("rejects unsafe/invalid deployment input %j", (override) => {
    const result = spawnSync(process.execPath, [renderer], {
      env: { ...env, ...override },
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
  });
});
