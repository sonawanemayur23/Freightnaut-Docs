import { writeFileSync } from "node:fs";
import { z } from "zod";
import { format } from "prettier";
import {
  shipmentSchema,
  workspaceSettingsSchema,
  settingsPatchSchema,
  roleInputSchema,
  settingKeys,
} from "@freightnaut/domain";
const asJson = (schema: z.ZodType) => {
  const value = z.toJSONSchema(schema, { unrepresentable: "any" });
  delete value.$schema;
  return value;
};
const errors = {
  "400": { description: "Invalid input" },
  "401": { description: "Sign-in required" },
  "403": { description: "Insufficient permission, MFA, origin or CSRF token" },
  "404": { description: "Resource not found" },
  "409": {
    description:
      "Revision conflict, duplicate record or last-administrator constraint",
  },
  "429": { description: "Rate or rendering concurrency limit" },
  "503": {
    description: "A required storage service is temporarily unavailable",
  },
};
const paths: Record<string, Record<string, unknown>> = {};
function operation(
  method: string,
  path: string,
  id: string,
  description: string,
  input?: z.ZodType,
  options: {
    public?: boolean;
    status?: number;
    pdf?: boolean;
    query?: { name: string; schema: unknown }[];
  } = {},
) {
  const parameters: {
    name: string;
    in: string;
    required?: boolean;
    schema: unknown;
  }[] = [
    ...Array.from(path.matchAll(/\{(\w+)\}/g)).map(([_, name]) => ({
      name,
      in: "path",
      required: true,
      schema:
        name === "providerId"
          ? { type: "string" }
          : name === "type"
            ? { type: "string", enum: ["invoice", "packing-list"] }
            : { type: "string", format: "uuid" },
    })),
    ...(options.query ?? []).map((p) => ({ ...p, in: "query" })),
  ];
  if (!options.public && !["get", "head"].includes(method))
    parameters.push({
      name: "X-CSRF-Token",
      in: "header",
      required: true,
      schema: { type: "string" },
    });
  const responses = {
    ...errors,
    [String(options.status ?? 200)]: options.pdf
      ? {
          description:
            "Draft PDF from the authorized persisted shipment version",
          content: {
            "application/pdf": { schema: { type: "string", format: "binary" } },
          },
        }
      : { description: "Success" },
  };
  paths[path] ??= {};
  paths[path][method] = {
    operationId: id,
    summary: description,
    security: options.public ? [] : [{ sessionCookie: [] }],
    parameters,
    responses,
    ...(input
      ? {
          requestBody: {
            required: true,
            content: { "application/json": { schema: asJson(input) } },
          },
        }
      : {}),
  };
}
const t = "/api/tenants/{tenantId}",
  s = t + "/shipments/{shipmentId}";
operation("get", "/api/health", "health", "Process health", undefined, {
  public: true,
});
operation("get", "/api/ready", "ready", "Database readiness", undefined, {
  public: true,
});
operation(
  "get",
  "/api/auth/providers",
  "providers",
  "Public identity provider names",
  undefined,
  { public: true },
);
operation(
  "get",
  "/api/auth/login/{providerId}",
  "login",
  "Start OIDC Authorization Code flow with PKCE",
  undefined,
  { public: true, status: 302 },
);
operation(
  "get",
  "/api/auth/callback",
  "callback",
  "Consume the one-use login transaction; set HttpOnly session cookie",
  undefined,
  {
    public: true,
    status: 302,
    query: [
      { name: "code", schema: { type: "string" } },
      { name: "state", schema: { type: "string" } },
    ],
  },
);
operation(
  "get",
  "/api/auth/session",
  "session",
  "Current identity, CSRF token, memberships, permissions and scoped shipment grants",
);
operation(
  "post",
  "/api/auth/logout",
  "logout",
  "Destroy the current server-side session",
);
operation(
  "get",
  t + "/settings",
  "settings",
  "Resolved settings, inherited values, source and lock provenance",
);
operation(
  "put",
  t + "/settings",
  "saveSettings",
  "Save versioned settings; requires tenant.settings.write and administrative MFA",
  z.strictObject({
    revision: z.number().int().positive(),
    overrides: settingsPatchSchema,
    locks: z.array(z.enum(settingKeys)),
  }),
);
operation(
  "get",
  t + "/roles",
  "roles",
  "Workspace roles and permission catalog; requires tenant.members.manage",
);
operation(
  "post",
  t + "/roles",
  "createRole",
  "Create a custom role within the actor permission ceiling",
  roleInputSchema,
  { status: 201 },
);
operation(
  "put",
  t + "/roles/{roleId}",
  "updateRole",
  "Edit a non-reserved custom role",
  roleInputSchema,
);
operation(
  "get",
  t + "/members",
  "members",
  "Workspace members; requires tenant.members.manage",
);
operation(
  "patch",
  t + "/members/{membershipId}",
  "updateMember",
  "Change a role or revoke access; protects the last administrator",
  z.strictObject({
    roleId: z.uuid().optional(),
    status: z.enum(["active", "revoked"]),
  }),
);
operation(
  "get",
  t + "/invitations",
  "invitations",
  "Invitations without their secret tokens",
);
operation(
  "post",
  t + "/invitations",
  "inviteMember",
  "Create a verified-email and issuer-bound invitation; link is returned once",
  z.strictObject({ email: z.email(), roleId: z.uuid() }),
  { status: 201 },
);
operation(
  "delete",
  t + "/invitations/{invitationId}",
  "revokeInvitation",
  "Revoke an unaccepted invitation",
);
operation(
  "post",
  "/api/invitations/accept",
  "acceptInvitation",
  "Redeem an invitation; recheck issuer, verified email and inviter authority",
  z.strictObject({ token: z.string().min(40).max(128) }),
);
operation(
  "get",
  t + "/audit",
  "audit",
  "Last 100 scoped audit events; requires tenant.audit.read",
);
operation(
  "get",
  t + "/accounts",
  "accounts",
  "Customer accounts; requires partner.accounts.manage",
);
operation(
  "post",
  t + "/accounts",
  "createAccount",
  "Create an account and invite its first administrator without implicit caller membership",
  z.strictObject({
    name: z.string().trim().min(1).max(200),
    ownerEmail: z.email(),
  }),
  { status: 201 },
);
operation(
  "post",
  "/api/platform/partners",
  "createPartner",
  "Platform operator provisions a partner and first-administrator invitation",
  z.strictObject({
    name: z.string().trim().min(1).max(200),
    ownerEmail: z.email(),
  }),
  { status: 201 },
);
operation(
  "get",
  t + "/shipments",
  "shipments",
  "List account shipments; requires shipment.read",
  undefined,
  {
    query: [
      {
        name: "limit",
        schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
      },
      { name: "q", schema: { type: "string", maxLength: 200 } },
      { name: "recent", schema: { type: "string", enum: ["true", "false"] } },
      { name: "cursor", schema: { type: "string", maxLength: 512 } },
      { name: "before", schema: { type: "string", format: "date-time" } },
    ],
  },
);
operation(
  "post",
  t + "/shipments",
  "createShipment",
  "Persist a new account draft; requires shipment.write",
  shipmentSchema,
  { status: 201 },
);
operation(
  "post",
  s + "/copy",
  "copyShipment",
  "Copy an authorized shipment into a new unnumbered draft with new goods-line identifiers",
  undefined,
  { status: 201 },
);
operation(
  "get",
  s,
  "shipment",
  "Read a shipment through membership or a valid named-shipment grant",
);
operation(
  "put",
  s,
  "saveShipment",
  "Persist a draft with optimistic concurrency; requires shipment.write",
  z.strictObject({
    version: z.number().int().positive(),
    data: shipmentSchema,
  }),
);
operation(
  "post",
  s + "/documents/{type}/pdf",
  "downloadDraft",
  "Legacy synchronous draft rendering; new clients should use document-jobs",
  z.strictObject({ version: z.number().int().positive() }),
  { pdf: true },
);
operation(
  "post",
  s + "/document-jobs",
  "prepareSavedDraft",
  "Persist a version-checked immutable snapshot and queue a PDF; same requester/key returns the same request",
  z.strictObject({
    version: z.number().int().positive(),
    type: z.enum(["invoice", "packing-list"]),
    idempotencyKey: z.uuid(),
  }),
  { status: 202 },
);
operation(
  "get",
  s + "/document-jobs",
  "draftHistory",
  "List the latest 50 draft requests; requires shipment.read and document.download",
);
operation(
  "get",
  s + "/document-jobs/{jobId}/file",
  "downloadSavedDraft",
  "Download a ready immutable PDF after current permission and SHA-256 verification",
  undefined,
  { pdf: true },
);
operation(
  "get",
  s + "/collaborators",
  "collaborators",
  "Named-shipment grants; requires tenant.members.manage",
);
operation(
  "post",
  s + "/collaborators",
  "inviteCollaborator",
  "Invite a collaborator with explicit read and optional download permissions",
  z.strictObject({
    email: z.email(),
    allowDownload: z.boolean().default(false),
  }),
  { status: 201 },
);
operation(
  "delete",
  s + "/collaborators/{grantId}",
  "revokeCollaborator",
  "Revoke a named-shipment grant",
);
operation(
  "delete",
  "/api/platform/invitations/{invitationId}",
  "revokePlatformInvitation",
  "Platform operator revokes an unaccepted partner administrator invitation",
);
operation(
  "post",
  "/api/onboarding/workspace",
  "onboardLocalWorkspace",
  "Explicit local-development-only self-service; creates new isolated workspaces, never joins existing tenants",
  z.strictObject({ companyName: z.string().trim().min(1).max(200) }),
  { status: 201 },
);
const json = {
  openapi: "3.1.0",
  info: {
    title: "Freightnaut Docs",
    version: "0.2.0",
    description:
      "Server-side session authentication and tenant-scoped APIs. Mutations require the exact configured Origin and X-CSRF-Token from /api/auth/session. Production cookie name is __Host-freightnaut_session; local HTTP development omits the __Host- prefix. No live issuance endpoint exists.",
  },
  servers: [{ url: "/" }],
  paths,
  components: {
    securitySchemes: {
      sessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "__Host-freightnaut_session",
      },
    },
    schemas: {
      Shipment: asJson(shipmentSchema),
      WorkspaceSettings: asJson(workspaceSettingsSchema),
    },
  },
};
writeFileSync(
  new URL("../docs/openapi.json", import.meta.url),
  await format(JSON.stringify(json), { parser: "json" }),
);
