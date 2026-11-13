/** Explicit opt-in cloud boundary: HTTPS origin, access code, and isolated signed sessions. */
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";
import express from "express";
import { HomeStore } from "#server/home";
import { KnowledgeStore } from "#server/knowledge";

const SESSION_SECONDS = 12 * 60 * 60; // Bound access-code sessions to twelve hours.
const MAX_HOUSEHOLDS = 100; // Bound persisted households and in-memory demo stores.
const COOKIE_NAME = "__Host-smart-home"; // Secure, host-scoped, HttpOnly cookie; never a URL credential.

export interface Household {
  home: HomeStore;
  knowledge: KnowledgeStore;
}

export interface CloudOptions {
  origin: string;
  accessCode: string;
  sessionSecret: string;
  dataPath: string;
  knowledgePath: string;
  publicGuestAccess?: boolean;
}

/** Fail closed if cloud mode is partially configured; local behavior stays unchanged. */
export function cloudOptions(
  env: NodeJS.ProcessEnv,
  knowledgePath: string,
): CloudOptions | undefined {
  if (!env.SMART_HOME_PUBLIC_ORIGIN) {
    if (env.HOST === "0.0.0.0")
      throw new Error(
        "Non-loopback hosting requires SMART_HOME_PUBLIC_ORIGIN and access protection.",
      );
    return undefined;
  }
  const origin = new URL(env.SMART_HOME_PUBLIC_ORIGIN);
  if (
    origin.protocol !== "https:" ||
    origin.origin !== env.SMART_HOME_PUBLIC_ORIGIN ||
    origin.username ||
    origin.password
  ) {
    throw new Error("SMART_HOME_PUBLIC_ORIGIN must be an exact HTTPS origin.");
  }
  if (
    env.SMART_HOME_PUBLIC_GUEST_ACCESS &&
    !["0", "1"].includes(env.SMART_HOME_PUBLIC_GUEST_ACCESS)
  )
    throw new Error("SMART_HOME_PUBLIC_GUEST_ACCESS must be 0 or 1.");
  const publicGuestAccess = env.SMART_HOME_PUBLIC_GUEST_ACCESS === "1";
  if (
    (!publicGuestAccess && (env.SMART_HOME_ACCESS_CODE?.length ?? 0) < 24) ||
    (env.SMART_HOME_SESSION_SECRET?.length ?? 0) < 32 ||
    !env.SMART_HOME_DATA_PATH
  ) {
    throw new Error(
      "Cloud mode requires a strong access code, signing secret, and persistent data path.",
    );
  }
  return {
    origin: origin.origin,
    accessCode: env.SMART_HOME_ACCESS_CODE ?? "",
    sessionSecret: env.SMART_HOME_SESSION_SECRET!,
    dataPath: env.SMART_HOME_DATA_PATH,
    knowledgePath,
    publicGuestAccess,
  };
}

/** Authenticate the cloud frontend and own one persistent household per browser session. */
export class CloudAccess {
  private readonly households = new Map<string, Household>();

  constructor(private readonly options: CloudOptions) {
    mkdirSync(options.dataPath, { recursive: true });
  }

  /** Match public Host and exact HTTPS Origin without trusting arbitrary forwarded headers. */
  sameOrigin(request: IncomingMessage): boolean {
    return (
      request.headers.host === new URL(this.options.origin).host &&
      request.headers.origin === this.options.origin
    );
  }

  /** Verify signature and expiry before using any cookie value as a filesystem identifier. */
  session(request: IncomingMessage): string | undefined {
    const cookie = (request.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE_NAME}=`));
    const value = cookie?.slice(COOKIE_NAME.length + 1);
    if (!value || !/^[a-f0-9]{48}\.\d{10}\.[a-f0-9]{64}$/.test(value))
      return undefined;
    const [id, expiry, signature] = value.split(".");
    if (Number(expiry) <= Date.now() / 1000) return undefined;
    if (
      !timingSafeEqual(
        Buffer.from(signature!, "hex"),
        Buffer.from(this.sign(`${id}.${expiry}`), "hex"),
      )
    )
      return undefined;
    return id;
  }

  /** Return private server-side state; no other visitor's uploads or mutations are shared. */
  household(request: IncomingMessage): Household {
    const id = this.session(request);
    if (!id) throw new Error("An authenticated cloud session is required.");
    const cached = this.households.get(id);
    if (cached) return cached;
    if (this.households.size >= MAX_HOUSEHOLDS)
      throw new Error("Demo session capacity reached.");
    const path = join(this.options.dataPath, id);
    const household = {
      home: new HomeStore(join(path, "home.json")),
      knowledge: new KnowledgeStore(this.options.knowledgePath, {
        uploadPath: join(path, "uploads"),
      }),
    };
    this.households.set(id, household);
    return household;
  }

  /** Install authentication before static files and APIs; health checks reveal no protected data. */
  install(app: express.Express): void {
    app.use("/login", (_request, response, next) => {
      // Form navigations need a non-opaque Origin; external sites still receive no referrer.
      response.setHeader("Referrer-Policy", "same-origin");
      next();
    });
    app.get("/api/health", (_request, response) =>
      response.json({
        status: "ok",
        service: "smart-home-appliance-agent",
        cloud: true,
      }),
    );
    if (this.options.publicGuestAccess) {
      this.installGuestAccess(app);
      return;
    }
    app.get("/login", (_request, response) =>
      response.type("html").send(loginPage(false)),
    );
    app.post(
      "/login",
      express.urlencoded({ extended: false, limit: "1kb" }),
      (request, response) => this.login(request, response),
    );
    app.use((request, response, next) => {
      if (request.headers.host !== new URL(this.options.origin).host)
        return void response.status(403).send("Unexpected public host.");
      if (this.session(request)) return next();
      if (request.path.startsWith("/api"))
        return void response
          .status(401)
          .json({ error: "Sign in with the demo access code." });
      response.redirect(303, "/login");
    });
  }

  private installGuestAccess(app: express.Express): void {
    app.use((request, response, next) => {
      if (request.headers.host !== new URL(this.options.origin).host)
        return void response.status(403).send("Unexpected public host.");
      if (this.session(request)) {
        if (request.path === "/login") return void response.redirect(303, "/");
        return next();
      }
      if (request.method !== "GET" || request.path.startsWith("/api"))
        return void response.status(401).json({
          error: "Open the demo page to start an isolated browser session.",
        });
      if (request.path !== "/" && request.path !== "/login")
        return void response.redirect(303, "/");
      console.info("Creating an isolated public demo session");
      this.createSession(request, response);
    });
  }

  private login(request: express.Request, response: express.Response): void {
    if (!this.sameOrigin(request))
      return void response.status(403).send("A same-origin login is required.");
    const supplied: unknown = request.body?.code;
    if (
      typeof supplied !== "string" ||
      !timingSafeEqual(hash(supplied), hash(this.options.accessCode))
    ) {
      console.info("Demo access-code login rejected");
      return void response.status(401).type("html").send(loginPage(true));
    }
    console.info("Demo access-code login accepted");
    this.createSession(request, response);
  }

  private createSession(
    request: express.Request,
    response: express.Response,
  ): void {
    if (
      readdirSync(this.options.dataPath).filter((entry) =>
        /^[a-f0-9]{48}$/.test(entry),
      ).length >= MAX_HOUSEHOLDS
    ) {
      return void response
        .status(503)
        .send("Demo session capacity reached. Contact the demo owner.");
    }
    const existing = this.session(request);
    const id = existing ?? randomBytes(24).toString("hex");
    const payload = `${id}.${Math.floor(Date.now() / 1000) + SESSION_SECONDS}`;
    // Lax permits Teams/Safe Links top-level navigation while blocking cross-site subrequests.
    response.setHeader(
      "Set-Cookie",
      `${COOKIE_NAME}=${payload}.${this.sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`,
    );
    response.redirect(303, "/");
  }

  private sign(value: string): string {
    return createHmac("sha256", this.options.sessionSecret)
      .update(value)
      .digest("hex");
  }
}

function hash(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function loginPage(error: boolean): string {
  return `<!doctype html><html lang="en"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Smart Home · Private demo</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f7f9;color:#202b38;font:15px system-ui}main{max-width:380px;margin:20px;padding:35px;background:#fff;border:1px solid #e3e9f0;border-radius:16px;box-shadow:0 12px 40px #18355308}small{color:#005aaa;letter-spacing:.12em}h1{font-size:30px;font-weight:500}p{color:#68788a;font-size:13px;line-height:1.9}label{display:block;font-size:12px;margin:25px 0 8px}input{box-sizing:border-box;width:100%;padding:13px;border:1px solid #d5dfe9;border-radius:6px;background:#f9fbfd;color:#202b38}input:focus{outline:2px solid #005aaa;outline-offset:2px}button{width:100%;padding:13px;border:0;border-radius:6px;background:#005aaa;color:#fff;margin-top:14px;cursor:pointer}.error{color:#a34825}</style>
<main><small>SMART_HOME · PRIVATE EXPERIENCE</small><h1>Welcome home.<br>欢迎回家。</h1><p>This private demo uses real AI services. Enter the access code provided by the demo owner.<br>本演示接入真实 AI，请输入演示访问码。</p>
${error ? '<p role="alert" class="error">Incorrect access code / 访问码不正确</p>' : ""}
<form method="post" action="/login"><label for="code">Access code / 访问码</label><input id="code" name="code" type="password" maxlength="256" required autocomplete="current-password"><button type="submit">Enter experience / 进入体验</button></form>
<p>Simulated appliances. Real Voice Agent.<br>模拟家电 · 真实语音助手</p></main></html>`;
}
