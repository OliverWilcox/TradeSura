import { SignJWT, jwtVerify } from "jose";
import { isAdminPermission, type AdminPermission } from "@/lib/admin-api/permissions";

// The admin app (a separate Next.js app on its own domain) signs a short-lived
// token for each call it makes on a staff member's behalf: who they are, their
// role and the permissions that role holds. Server to server only; no browser
// ever sees one. HS256 with ADMIN_API_SECRET, which must differ from
// SESSION_SECRET so an engineer's app token can never pass as an admin token,
// or the other way round. Issuer and audience are pinned for the same reason.

export const ADMIN_TOKEN_ISSUER = "tradesura-admin";
export const ADMIN_TOKEN_AUDIENCE = "tradesura-api:admin";
/** Longest a token may live (exp − iat). The admin app signs per request. */
export const ADMIN_TOKEN_MAX_SECONDS = 120;

export type AdminPrincipal = {
  id: string;
  name: string;
  role: string;
  permissions: AdminPermission[];
  /** The admin app's request ID, for joining up logs and audit across the two apps. */
  requestId?: string;
};

export type AdminTokenResult = { ok: true; admin: AdminPrincipal } | { ok: false; reason: "not_configured" | "invalid" };

const usable = (secret: string | undefined): secret is string =>
  Boolean(secret && secret.length >= 32 && secret !== process.env.SESSION_SECRET);

/** The signing key, or null when the admin API isn't set up (it then refuses every call). */
export function adminApiKey(): Uint8Array | null {
  const secret = process.env.ADMIN_API_SECRET;
  return usable(secret) ? new TextEncoder().encode(secret) : null;
}

/**
 * Keys a token may be signed with. To change the secret without an outage:
 * set the new one as ADMIN_API_SECRET_NEXT here, move the admin app onto it,
 * then make it ADMIN_API_SECRET and remove the _NEXT.
 */
function adminApiKeys(): Uint8Array[] {
  const current = adminApiKey();
  if (!current) return [];
  const next = process.env.ADMIN_API_SECRET_NEXT;
  return usable(next) ? [current, new TextEncoder().encode(next)] : [current];
}

async function verifyWithAny(token: string, keys: Uint8Array[]) {
  let failure: unknown;
  for (const key of keys) {
    try {
      return await jwtVerify(token, key, {
        algorithms: ["HS256"],
        issuer: ADMIN_TOKEN_ISSUER,
        audience: ADMIN_TOKEN_AUDIENCE,
        requiredClaims: ["sub", "iat", "exp"],
        maxTokenAge: `${ADMIN_TOKEN_MAX_SECONDS}s`,
        clockTolerance: 5,
      });
    } catch (err) {
      failure = err;
    }
  }
  throw failure;
}

export async function verifyAdminToken(token: string): Promise<AdminTokenResult> {
  const keys = adminApiKeys();
  if (!keys.length) return { ok: false, reason: "not_configured" };
  try {
    const { payload } = await verifyWithAny(token, keys);
    if (payload.exp! - payload.iat! > ADMIN_TOKEN_MAX_SECONDS) return { ok: false, reason: "invalid" };
    const { sub, name, role, perms, rid } = payload as Record<string, unknown>;
    if (typeof sub !== "string" || !sub || typeof name !== "string" || typeof role !== "string") return { ok: false, reason: "invalid" };
    if (!Array.isArray(perms) || !perms.every(isAdminPermission)) return { ok: false, reason: "invalid" };
    return {
      ok: true,
      admin: { id: sub, name, role, permissions: perms, requestId: typeof rid === "string" ? rid.slice(0, 100) : undefined },
    };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

/**
 * Signs a token the way the admin app does. Used by tests and local scripts;
 * the admin app has its own copy of this (same claims).
 */
export async function signAdminToken(admin: AdminPrincipal, opts: { secret?: string; seconds?: number } = {}) {
  const secret = opts.secret ?? process.env.ADMIN_API_SECRET;
  if (!secret) throw new Error("ADMIN_API_SECRET is not set");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ name: admin.name, role: admin.role, perms: admin.permissions, ...(admin.requestId ? { rid: admin.requestId } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ADMIN_TOKEN_ISSUER)
    .setAudience(ADMIN_TOKEN_AUDIENCE)
    .setSubject(admin.id)
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.seconds ?? 60))
    .sign(new TextEncoder().encode(secret));
}
