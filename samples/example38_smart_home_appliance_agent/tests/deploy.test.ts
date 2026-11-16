import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const renderer = fileURLToPath(
  new URL("../deploy/render-container-app.mjs", import.meta.url),
);
const webrtcDeployer = fileURLToPath(
  new URL("../deploy/deploy-webrtc.mjs", import.meta.url),
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
});

describe("parameterized WebRTC lab deployment helper", () => {
  const webrtcEnv = {
    PATH: process.env.PATH,
    AZURE_SUBSCRIPTION_ID: "unit-subscription",
    AZURE_TENANT_ID: "unit-tenant",
    SMART_HOME_WEBRTC_RESOURCE_GROUP: "unit-group",
    SMART_HOME_WEBRTC_ENVIRONMENT_NAME: "unit-env",
    SMART_HOME_WEBRTC_REGISTRY_NAME: "unitregistry",
    SMART_HOME_WEBRTC_IDENTITY_NAME: "unit-identity",
    SMART_HOME_WEBRTC_ENDPOINT: "https://example.services.ai.azure.com",
    SMART_HOME_WEBRTC_LOCATION: "unit-region",
    AZURE_CLIENT_ID: "unit-client",
  };

  it("fails closed with no hardcoded Azure defaults", () => {
    const result = spawnSync(process.execPath, [webrtcDeployer], {
      env: {},
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("AZURE_SUBSCRIPTION_ID");
  });

  it("renders a Flash WebRTC lab manifest offline with minReplicas=0 by default", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "smart-home-webrtc-deploy-test-"),
    );
    try {
      execFileSync(process.execPath, [webrtcDeployer], {
        cwd: directory,
        env: {
          ...webrtcEnv,
          SMART_HOME_WEBRTC_DEPLOY_STATE: join(
            directory,
            ".local/webrtc-deployment.json",
          ),
        },
        encoding: "utf8",
      });
      const manifests = JSON.parse(
        readFileSync(join(directory, ".local/webrtc-manifests.json"), "utf8"),
      );
      expect(manifests).toHaveLength(1);
      expect(manifests[0].name).toBe("voice-webrtc-flash");
      expect(manifests[0].properties.template.scale.minReplicas).toBe(0);
      expect(manifests[0].properties.template.containers[0].env).toContainEqual(
        {
          name: "WEBRTC_MODEL",
          value: "microsoft-realtime-flash-1",
        },
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses --apply without matching --confirm-endpoint", () => {
    const result = spawnSync(process.execPath, [webrtcDeployer, "--apply"], {
      env: webrtcEnv,
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("confirm-endpoint");
  });

  it.each([
    { SMART_HOME_WEBRTC_SECONDARY_MODEL_ID: "unsupported-model" },
    {
      SMART_HOME_WEBRTC_PRIMARY_APP: "unit-realtime",
      SMART_HOME_WEBRTC_PRIMARY_MODEL_ID: "unsupported-model",
    },
  ])(
    "rejects an unsupported lab model before rendering or applying %j",
    (override) => {
      const result = spawnSync(process.execPath, [webrtcDeployer], {
        env: { ...webrtcEnv, ...override },
        encoding: "utf8",
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("not an approved model");
    },
  );
});
