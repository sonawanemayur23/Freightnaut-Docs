import Fastify, { LogController } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import staticPlugin from "@fastify/static";
import { z } from "zod";
import type { Pool } from "pg";
import { resolve } from "node:path";
import type { AppConfig } from "./config.js";
import { registerAuth } from "./auth/routes.js";
import {
  getActor,
  requireActor,
  requireCsrf,
  type Actor,
} from "./auth/session.js";
import { registerOnboarding } from "./tenancy/onboarding.js";
import { registerTenancy } from "./tenancy/routes.js";
import { registerShipments } from "./shipments/routes.js";
import { registerDocumentJobs } from "./documents/jobs.js";
import { HttpError } from "./errors.js";
declare module "fastify" {
  interface FastifyRequest {
    actor: Actor | null;
  }
}
export async function buildApp(config: AppConfig, pool: Pool) {
  const app = Fastify({
    bodyLimit: 1_000_000,
    requestTimeout: 60000,
    logController: new LogController({ disableRequestLogging: true }),
    logger: {
      level: config.LOG_LEVEL,
      redact: [
        "req.headers.cookie",
        "req.headers.authorization",
        "req.headers.x-csrf-token",
        "res.headers.set-cookie",
        "clientSecret",
        "password",
        "token",
        "csrfToken",
      ],
    },
  });
  app.decorateRequest("actor", null);
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'"],
        frameSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.secureCookies ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.secureCookies ? { maxAge: 31536000 } : false,
  });
  await app.register(rateLimit, {
    global: true,
    max: 200,
    hook: "preHandler",
    keyGenerator: (request) => request.actor?.id ?? request.ip,
    timeWindow: "1 minute",
  });
  const publicRoutes = new Set([
    "/api/health",
    "/api/ready",
    "/api/auth/providers",
    "/api/auth/login/:providerId",
    "/api/auth/callback",
  ]);
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    reply
      .header("Cache-Control", "no-store")
      .header("Referrer-Policy", "no-referrer");
    if (publicRoutes.has(request.routeOptions.url ?? "")) return;
    request.actor = requireActor(await getActor(pool, request, config));
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method))
      requireCsrf(request, request.actor, config);
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: "Some values are invalid.",
        details: error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
    if (error instanceof HttpError)
      return reply.code(error.statusCode).send({ error: error.message });
    const safeError = error as Error & { code?: string; statusCode?: number };
    const code = safeError.code;
    if (code === "23505")
      return reply
        .code(409)
        .send({ error: "This record already exists. Refresh and retry." });
    if (safeError.statusCode === 429)
      return reply
        .code(429)
        .send({ error: "Too many requests. Please retry shortly." });
    if (
      safeError.statusCode &&
      safeError.statusCode >= 400 &&
      safeError.statusCode < 500
    )
      return reply
        .code(safeError.statusCode)
        .send({ error: "The request could not be processed." });
    request.log.error(
      {
        event: "request.failed",
        requestId: request.id,
        errorName: safeError.name,
        code,
      },
      "Request failed",
    );
    return reply.code(500).send({
      error: "The request could not be completed. Please retry.",
      requestId: request.id,
    });
  });
  app.get("/api/health", async () => ({ status: "ok" }));
  app.get("/api/ready", async (_request, reply) => {
    try {
      await pool.query("SELECT 1");
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });
  registerAuth(app, pool, config);
  registerTenancy(app, pool, config);
  registerOnboarding(app, pool, config);
  registerShipments(app, pool, config);
  registerDocumentJobs(app, pool);
  if (config.NODE_ENV === "production" || config.SERVE_WEB === "true") {
    await app.register(staticPlugin, {
      root: resolve("apps/web/dist"),
      index: false,
    });
    app.get("/", async (_request, reply) =>
      reply.type("text/html").sendFile("index.html"),
    );
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/") || request.url.startsWith("/assets/"))
        return reply.code(404).send({ error: "Route not found." });
      return reply.type("text/html").sendFile("index.html");
    });
  }
  return app;
}
