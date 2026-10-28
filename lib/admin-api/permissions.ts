// Permissions the admin app grants its staff, as "resource:action". The admin
// app decides who holds which (its roles); every admin API route names the one
// it needs and checks it again here. Keep in step with the admin app's
// src/server/auth/permissions.ts.

export const ADMIN_PERMISSIONS = [
  "dashboard:read",
  "verification:read",
  "verification:decide",
  "engineers:read",
  "engineers:notes",
  "engineers:status",
  "engineers:ban",
  "engineers:view_as",
  "customers:read",
  "customers:notes",
  "pii:reveal",
  "money:read",
  "money:refund",
  "affiliates:read",
  "affiliates:pay",
  "settings:read",
  "settings:write",
  "member_packs:read",
  "member_packs:export",
  "member_packs:mark_posted",
  "interest:read",
  "letters:read",
  "letters:write",
  "audit:read",
  "data:export",
  "data:delete",
  "admins:manage",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export function isAdminPermission(v: unknown): v is AdminPermission {
  return typeof v === "string" && (ADMIN_PERMISSIONS as readonly string[]).includes(v);
}
