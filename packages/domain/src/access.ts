import { z } from "zod";
export const permissions = [
  "partner.accounts.manage",
  "tenant.settings.write",
  "tenant.members.manage",
  "tenant.roles.manage",
  "tenant.audit.read",
  "shipment.read",
  "shipment.write",
  "document.download",
  "document.number.reserve",
] as const;
export type Permission = (typeof permissions)[number];
export type TenantKind = "partner" | "account";
export const permissionSchema = z.enum(permissions);
export const permissionCeilings: Record<TenantKind, readonly Permission[]> = {
  partner: [
    "partner.accounts.manage",
    "tenant.settings.write",
    "tenant.members.manage",
    "tenant.roles.manage",
    "tenant.audit.read",
  ],
  account: [
    "tenant.settings.write",
    "tenant.members.manage",
    "tenant.roles.manage",
    "tenant.audit.read",
    "shipment.read",
    "shipment.write",
    "document.download",
    "document.number.reserve",
  ],
};
// Persona templates initialize editable roles. Permissions, not persona names, authorize requests.
export const roleTemplates: Record<
  TenantKind,
  {
    key: string;
    name: string;
    permissions: readonly Permission[];
    reserved?: boolean;
  }[]
> = {
  partner: [
    {
      key: "owner",
      name: "Partner administrator",
      permissions: permissionCeilings.partner,
      reserved: true,
    },
    {
      key: "developer",
      name: "Partner developer",
      permissions: ["tenant.audit.read"],
    },
  ],
  account: [
    {
      key: "owner",
      name: "Account administrator",
      permissions: permissionCeilings.account,
      reserved: true,
    },
    {
      key: "preparer",
      name: "Document preparer",
      permissions: ["shipment.read", "shipment.write", "document.download"],
    },
    {
      key: "reviewer",
      name: "Reviewer",
      permissions: ["shipment.read", "document.download"],
    },
  ],
};
export const roleInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  permissions: z.array(permissionSchema).max(permissions.length),
});
export function validateRolePermissions(
  kind: TenantKind,
  granted: readonly Permission[],
  actor: readonly Permission[],
): boolean {
  return (
    granted.every(
      (p) => permissionCeilings[kind].includes(p) && actor.includes(p),
    ) &&
    (!granted.includes("shipment.write") ||
      granted.includes("shipment.read")) &&
    (!granted.includes("document.number.reserve") ||
      (granted.includes("shipment.read") && granted.includes("shipment.write")))
  );
}
export interface TenantAccess {
  id: string;
  name: string;
  kind: TenantKind;
  parentId: string | null;
  roleId: string;
  roleName: string;
  permissions: Permission[];
  revision: number;
}
export interface SessionContext {
  user: {
    id: string;
    name: string;
    email: string;
    issuer: string;
    subject: string;
  };
  csrfToken: string;
  mfa: boolean;
  operator: boolean;
  tenants: TenantAccess[];
  sharedShipments: {
    id: string;
    tenantId: string;
    name: string;
    expiresAt: string;
    permissions: Permission[];
  }[];
}
