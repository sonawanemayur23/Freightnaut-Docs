import * as oidc from "openid-client";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { transaction } from "../db.js";
import { assert } from "../errors.js";
import type { AppConfig } from "../config.js";
import { IdentityProviders } from "./oidc.js";
import {
  randomToken,
  tokenHash,
  cookieNames,
  issueSession,
} from "./session.js";
import { contextFor } from "../tenancy/service.js";
export function registerAuth(
  app: FastifyInstance,
  pool: Pool,
  config: AppConfig,
) {
  const providers = new IdentityProviders(config);
  const names = cookieNames(config);
  const options = {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.secureCookies,
  };
  app.get("/api/auth/providers", async () => ({
    providers: config.OIDC_PROVIDERS.map(({ id, name }) => ({ id, name })),
    registration: "invitation-only",
  }));
  app.get<{ Params: { providerId: string } }>(
    "/api/auth/login/:providerId",
    {
      config: {
        rateLimit: { max: config.AUTH_RATE_LIMIT, timeWindow: "1 minute" },
      },
    },
    async (request, reply) => {
      assert(
        providers.definition(request.params.providerId),
        404,
        "Identity provider not found.",
      );
      const client = await providers.get(request.params.providerId);
      const token = randomToken();
      const state = oidc.randomState(),
        nonce = oidc.randomNonce(),
        verifier = oidc.randomPKCECodeVerifier();
      await pool.query(
        "INSERT INTO login_transactions(token_hash,provider_id,state,nonce,verifier) VALUES($1,$2,$3,$4,$5)",
        [tokenHash(token), request.params.providerId, state, nonce, verifier],
      );
      const url = oidc.buildAuthorizationUrl(client, {
        redirect_uri: config.PUBLIC_ORIGIN + "/api/auth/callback",
        scope: "openid profile email",
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: "S256",
        state,
        nonce,
        prompt: "login",
      });
      return reply
        .setCookie(names.login, token, { ...options, maxAge: 600 })
        .redirect(url.href);
    },
  );
  app.get(
    "/api/auth/callback",
    {
      config: {
        rateLimit: { max: config.AUTH_RATE_LIMIT, timeWindow: "1 minute" },
      },
    },
    async (request, reply) => {
      const token = request.cookies[names.login];
      reply.clearCookie(names.login, options);
      assert(
        token && token.length <= 128,
        400,
        "Sign-in expired. Start again.",
      );
      const result = await pool.query(
        "DELETE FROM login_transactions WHERE token_hash=$1 AND expires_at>now() RETURNING *",
        [tokenHash(token)],
      );
      const flow = result.rows[0];
      assert(flow, 400, "Sign-in expired or was already used. Start again.");
      const client = await providers.get(flow.provider_id);
      const query = z
        .object({ state: z.string(), code: z.string() })
        .safeParse(request.query);
      assert(
        query.success,
        400,
        "Sign-in was cancelled or could not be verified.",
      );
      const url = new URL(config.PUBLIC_ORIGIN + request.url);
      let claims: oidc.IDToken | undefined;
      try {
        const tokens = await oidc.authorizationCodeGrant(client, url, {
          pkceCodeVerifier: flow.verifier,
          expectedState: flow.state,
          expectedNonce: flow.nonce,
          idTokenExpected: true,
        });
        claims = tokens.claims();
      } catch (error) {
        request.log.warn(
          {
            event: "authentication.rejected",
            reason: error instanceof Error ? error.name : "unknown",
          },
          "OIDC callback rejected",
        );
        return reply
          .code(400)
          .send({ error: "Sign-in could not be verified. Start again." });
      }
      assert(
        claims && typeof claims.sub === "string",
        400,
        "The identity provider did not return a valid identity.",
      );
      const email = z.email().safeParse(claims.email);
      assert(
        email.success,
        400,
        "The identity provider must supply an email address.",
      );
      const provider = providers.definition(flow.provider_id)!;
      const session = await transaction(pool, null, async (db) => {
        const user = await db.query(
          `INSERT INTO users(issuer,subject,email,email_verified,name) VALUES($1,$2,$3,$4,$5)
 ON CONFLICT(issuer,subject) DO UPDATE SET email=EXCLUDED.email,email_verified=EXCLUDED.email_verified,name=EXCLUDED.name
 RETURNING id,disabled`,
          [
            provider.issuer,
            claims!.sub,
            email.data.toLowerCase(),
            claims!.email_verified === true,
            typeof claims!.name === "string"
              ? claims!.name.slice(0, 200)
              : email.data,
          ],
        );
        assert(
          !user.rows[0].disabled,
          403,
          "This user is disabled. Contact your administrator.",
        );
        if (request.cookies[names.session])
          await db.query("DELETE FROM sessions WHERE token_hash=$1", [
            tokenHash(request.cookies[names.session]!),
          ]);
        const amr = Array.isArray(claims!.amr)
          ? claims!.amr.filter((v): v is string => typeof v === "string")
          : [];
        const session = await issueSession(db, user.rows[0].id, amr, config);
        request.log.info(
          { event: "authentication.succeeded", userId: user.rows[0].id },
          "Sign-in completed",
        );
        return session;
      });
      return reply
        .setCookie(names.session, session, {
          ...options,
          maxAge: config.SESSION_TTL_SECONDS,
        })
        .redirect(config.PUBLIC_ORIGIN + "/");
    },
  );
  app.get("/api/auth/session", async (request) =>
    contextFor(pool, request.actor!),
  );
  app.post("/api/auth/logout", async (request, reply) => {
    await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
      request.actor!.sessionHash,
    ]);
    reply.clearCookie(names.session, options);
    return { signedOut: true };
  });
}
