/** Offline cloud-access checks: signed cookies, host/origin rules, and private households. */
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { createDemoServer } from "../server/app";
import { CloudAccess, cloudOptions } from "../server/cloud";
import { runtimeConfig } from "../server/config";
import { HomeStore } from "../server/home";
import { KnowledgeStore } from "../server/knowledge";

const root = fileURLToPath(new URL("../", import.meta.url));
const origin = "https://haier-demo.example.test";
const accessCode = "mock-access-code-at-least-24-characters";
const secret = "mock-signing-secret-with-at-least-32-characters";
let dataPath: string;
let cloud: CloudAccess;
let address: string;
let close: (() => void) | undefined;

function request(headers: IncomingMessage["headers"]): IncomingMessage {
  return { headers } as IncomingMessage;
}

beforeEach(() => {
  dataPath = join(root, "test-results", `cloud-${randomUUID()}`);
  mkdirSync(dataPath, { recursive: true });
  cloud = new CloudAccess({
    origin,
    accessCode,
    sessionSecret: secret,
    dataPath,
    knowledgePath: join(root, "knowledge"),
  });
});
afterEach(() => {
  close?.();
  close = undefined;
  rmSync(dataPath, { recursive: true, force: true });
});

async function start(): Promise<void> {
  const demo = createDemoServer({
    config: runtimeConfig({}),
    home: new HomeStore(),
    knowledge: new KnowledgeStore(),
    cloud,
  });
  close = demo.close;
  await new Promise<void>((resolve) =>
    demo.server.listen(0, "127.0.0.1", resolve),
  );
  const endpoint = demo.server.address();
  if (!endpoint || typeof endpoint === "string")
    throw new Error("Missing test listener");
  address = `http://127.0.0.1:${endpoint.port}`;
}

async function login(): Promise<string> {
  const response = await send("/login", {
    method: "POST",
    headers: {
      Host: new URL(origin).host,
      Origin: origin,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ code: accessCode }).toString(),
  });
  expect(response.status).toBe(303);
  const cookie = response.headers["set-cookie"]?.[0];
  if (!cookie) throw new Error("Missing session cookie");
  expect(cookie).toContain("HttpOnly; Secure; SameSite=Lax");
  return cookie.split(";")[0]!;
}

async function send(
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<{ status: number; headers: IncomingMessage["headers"] }> {
  return new Promise((resolve, reject) => {
    const operation = httpRequest(
      `${address}${path}`,
      {
        method: options.method ?? "GET",
        headers: { Host: new URL(origin).host, ...options.headers },
      },
      (response) => {
        response.resume();
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
          }),
        );
      },
    );
    operation.on("error", reject);
    operation.end(options.body);
  });
}

describe("cloud deployment boundary", () => {
  it("allows explicit guest mode without an access code but still requires session protection", () => {
    const env = {
      HAIER_PUBLIC_ORIGIN: origin,
      HAIER_PUBLIC_GUEST_ACCESS: "1",
      HAIER_SESSION_SECRET: secret,
      HAIER_DATA_PATH: dataPath,
    };
    expect(cloudOptions(env, root)).toMatchObject({
      publicGuestAccess: true,
      accessCode: "",
    });
    expect(() =>
      cloudOptions({ ...env, HAIER_SESSION_SECRET: "" }, root),
    ).toThrow();
    expect(() =>
      cloudOptions({ ...env, HAIER_PUBLIC_GUEST_ACCESS: "true" }, root),
    ).toThrow();
  });

  it("enters public mode without a code, keeps browser households isolated and rejects foreign mutations", async () => {
    cloud = new CloudAccess({
      origin,
      accessCode: "",
      sessionSecret: secret,
      dataPath,
      knowledgePath: join(root, "knowledge"),
      publicGuestAccess: true,
    });
    await start();
    const first = await send("/login");
    expect(first.status).toBe(303);
    expect(first.headers.location).toBe("/");
    const cookie = first.headers["set-cookie"]?.[0]?.split(";")[0];
    if (!cookie) throw new Error("Missing isolated guest cookie");
    expect(first.headers["set-cookie"]?.[0]).toContain(
      "HttpOnly; Secure; SameSite=Lax",
    );
    expect(
      (await send("/api/config", { headers: { Cookie: cookie } })).status,
    ).toBe(200);
    const second = await send("/");
    const otherCookie = second.headers["set-cookie"]?.[0]?.split(";")[0];
    if (!otherCookie) throw new Error("Missing second isolated guest cookie");
    expect(otherCookie).not.toBe(cookie);
    cloud
      .household(request({ cookie }))
      .home.control({ deviceId: "tv", power: true });
    expect(
      cloud.household(request({ cookie: otherCookie })).home.snapshot()
        .devices[0]?.power,
    ).toBe(false);
    expect(
      (
        await send("/api/reset", {
          method: "POST",
          headers: {
            Cookie: cookie,
            Origin: "https://untrusted.test",
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    expect(
      (await send("/", { headers: { Host: "attacker.test" } })).status,
    ).toBe(403);
  });

  it("admits public guest sessions without request-frequency throttling", async () => {
    cloud = new CloudAccess({
      origin,
      accessCode: "",
      sessionSecret: secret,
      dataPath,
      knowledgePath: join(root, "knowledge"),
      publicGuestAccess: true,
    });
    await start();
    for (let attempt = 0; attempt < 25; attempt++)
      expect((await send("/")).status).toBe(303);
  });

  it("fails closed for missing protection or insecure/non-origin URLs", () => {
    expect(() => cloudOptions({ HOST: "0.0.0.0" }, "")).toThrow("Non-loopback");
    expect(() =>
      cloudOptions({ HAIER_PUBLIC_ORIGIN: "http://example.test" }, ""),
    ).toThrow("HTTPS");
    expect(() =>
      cloudOptions({ HAIER_PUBLIC_ORIGIN: `${origin}/path` }, ""),
    ).toThrow("HTTPS");
    expect(() => cloudOptions({ HAIER_PUBLIC_ORIGIN: origin }, "")).toThrow(
      "strong access",
    );
    expect(cloudOptions({}, "")).toBeUndefined();
  });

  it("does not trust forwarded Host/Origin to bypass the configured HTTPS host", () => {
    expect(
      cloud.sameOrigin(request({ host: "haier-demo.example.test", origin })),
    ).toBe(true);
    expect(
      cloud.sameOrigin(
        request({
          host: "haier-demo.example.test",
          origin: "https://untrusted.test",
        }),
      ),
    ).toBe(false);
    expect(
      cloud.sameOrigin(
        request({
          host: "attacker.test",
          origin,
          "x-forwarded-host": "haier-demo.example.test",
        }),
      ),
    ).toBe(false);
  });

  it("protects the page and API while leaving health probes available", async () => {
    await start();
    expect((await send("/api/health")).status).toBe(200);
    expect((await send("/api/config")).status).toBe(401);
    const page = await send("/");
    expect(page.status).toBe(303);
    expect(page.headers.location).toBe("/login");
    const loginPage = await send("/login");
    expect(loginPage.headers["referrer-policy"]).toBe("same-origin");
  });

  it("rejects incorrect codes and cross-origin logins without issuing cookies", async () => {
    await start();
    for (let attempt = 0; attempt < 25; attempt++) {
      const response = await send("/login", {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ code: "wrong" }).toString(),
      });
      expect(response.status).toBe(401);
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
    for (const [code, suppliedOrigin, status] of [
      [accessCode, "https://untrusted.test", 403],
      [accessCode, "null", 403],
    ] as const) {
      const response = await send("/login", {
        method: "POST",
        headers: {
          Origin: suppliedOrigin,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ code }).toString(),
      });
      expect(response.status).toBe(status);
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
  });

  it("isolates device state and uploaded knowledge, and reloads them after restart", async () => {
    await start();
    const first = request({ cookie: await login() });
    const second = request({ cookie: await login() });
    const a = cloud.household(first);
    const b = cloud.household(second);
    a.home.control({ deviceId: "tv", power: true });
    a.knowledge.upload({
      title: "Private guide",
      model: "DEMO",
      content: "Private document owned by browser A.",
    });
    expect(b.home.snapshot().devices[0]?.power).toBe(false);
    expect(
      b.knowledge.sources().some((source) => source.title === "Private guide"),
    ).toBe(false);
    const restored = new CloudAccess({
      origin,
      accessCode,
      sessionSecret: secret,
      dataPath,
      knowledgePath: join(root, "knowledge"),
    });
    expect(restored.household(first).home.snapshot().devices[0]?.power).toBe(
      true,
    );
    expect(
      restored
        .household(first)
        .knowledge.sources()
        .some((source) => source.title === "Private guide"),
    ).toBe(true);
  });

  it("rejects tampered, expired, and path-shaped cookies", async () => {
    await start();
    const cookie = await login();
    expect(cloud.session(request({ cookie }))).toBeDefined();
    expect(
      cloud.session(
        request({
          cookie: cookie.slice(0, -1) + (cookie.endsWith("0") ? "1" : "0"),
        }),
      ),
    ).toBeUndefined();
    expect(
      cloud.session(request({ cookie: "__Host-haier=../../etc/passwd" })),
    ).toBeUndefined();
    expect(
      cloud.session(
        request({ cookie: cookie.replace(/\.\d{10}\./, ".1000000000.") }),
      ),
    ).toBeUndefined();
  });

  it("allows authenticated API changes but rejects a foreign-origin mutation", async () => {
    await start();
    const cookie = await login();
    expect(
      (await send("/api/config", { headers: { Cookie: cookie } })).status,
    ).toBe(200);
    const body = JSON.stringify({ deviceId: "tv", power: true });
    expect(
      (
        await send("/api/devices/control", {
          method: "POST",
          headers: {
            Cookie: cookie,
            Origin: origin,
            "Content-Type": "application/json",
          },
          body,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await send("/api/reset", {
          method: "POST",
          headers: {
            Cookie: cookie,
            Origin: "https://untrusted.test",
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      ).status,
    ).toBe(403);
  });

  it("rejects unauthenticated WebSockets before opening a billable model connection", async () => {
    await start();
    const status = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(
        `${address.replace("http:", "ws:")}/api/voice?model=gpt-realtime-2.1&language=zh`,
        {
          headers: { Host: new URL(origin).host, Origin: origin },
        },
      );
      socket.on("unexpected-response", (_request, response) => {
        resolve(response.statusCode ?? 0);
        response.resume();
        socket.terminate();
      });
      socket.on("error", (error) => {
        if (!error.message.includes("closed before")) reject(error);
      });
    });
    expect(status).toBe(403);
  });
});
