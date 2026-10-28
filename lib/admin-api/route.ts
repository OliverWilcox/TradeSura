import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminToken, type AdminPrincipal } from "@/lib/admin-api/token";
import type { AdminPermission } from "@/lib/admin-api/permissions";

// The one wrapper every admin API route uses: token → permission → handler,
// with every failure answered as { error: { code, message, fields? } } and
// never a stack trace. Responses are never cached. Handlers return plain data
// (sent as JSON) or a Response of their own (files, CSV).

export type AdminErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "NOT_CONFIGURED"
  | "UPSTREAM"
  | "TIMEOUT"
  | "INTERNAL";

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: AdminErrorCode,
    message: string,
    readonly fields?: Record<string, string[]>,
  ) {
    super(message);
  }
}

export const notFound = (message: string) => new AdminApiError(404, "NOT_FOUND", message);
export const conflict = (message: string) => new AdminApiError(409, "CONFLICT", message);

export type AdminRouteContext<P> = { req: Request; admin: AdminPrincipal; params: P; requestId: string };

const REQUEST_ID = /^[\w.:-]{1,100}$/;

/** Postgres refuses text with a NUL character in it, so it's refused here first. */
const NUL = "\u0000";
const nulRefused = () => new AdminApiError(400, "VALIDATION", "That contains a character that isn't allowed.");

function hasNul(value: unknown): boolean {
  if (typeof value === "string") return value.includes(NUL);
  if (Array.isArray(value)) return value.some(hasNul);
  if (value && typeof value === "object") return Object.entries(value).some(([k, v]) => k.includes(NUL) || hasNul(v));
  return false;
}

/**
 * The Postgres error code (SQLSTATE) behind a Prisma error, wherever the
 * driver adapter put it. Prisma's own codes (P2010…) aren't SQLSTATEs.
 */
function sqlState(err: unknown, depth = 0): string | null {
  if (!err || typeof err !== "object" || depth > 4) return null;
  const e = err as Record<string, unknown>;
  for (const key of ["originalCode", "code"]) {
    const v = e[key];
    if (typeof v === "string" && /^[0-9A-Z]{5}$/.test(v) && !/^P[1-6]\d{3}$/.test(v)) return v;
  }
  for (const key of ["cause", "meta", "driverAdapterError"]) {
    const found = sqlState(e[key], depth + 1);
    if (found) return found;
  }
  return null;
}

/** Database refusals that are the request's fault or a slow query, answered as such rather than as a 500. */
function fromDatabase(err: unknown): AdminApiError | null {
  const state = sqlState(err) ?? (/statement timeout/i.test(String((err as Error)?.message)) ? "57014" : null);
  // 57014: the query ran past ADMIN_QUERY_TIMEOUT_MS (lib/admin-api/db.ts) and Postgres stopped it.
  if (state === "57014") return new AdminApiError(503, "TIMEOUT", "That took too long to work out. Try a shorter date range, or try again in a moment.");
  // 22021 and 22P05: text Postgres can't store (a NUL byte, an invalid escape).
  if (state === "22021" || state === "22P05") return nulRefused();
  return null;
}

/** `permission` null means any signed-in admin may call it. */
export function adminRoute<P extends Record<string, string> = Record<string, never>>(
  permission: AdminPermission | null,
  handler: (ctx: AdminRouteContext<P>) => Promise<unknown>,
) {
  return async (req: Request, ctx?: { params: Promise<P> }): Promise<Response> => {
    const sent = req.headers.get("x-request-id");
    const requestId = sent && REQUEST_ID.test(sent) ? sent : crypto.randomUUID();
    const headers = { "Cache-Control": "no-store", "X-Request-Id": requestId };
    try {
      const auth = req.headers.get("authorization");
      if (!auth?.startsWith("Bearer ")) throw new AdminApiError(401, "UNAUTHENTICATED", "Sign in to the admin app to continue.");
      const verified = await verifyAdminToken(auth.slice(7));
      if (!verified.ok) {
        throw verified.reason === "not_configured"
          ? new AdminApiError(503, "NOT_CONFIGURED", "The admin API isn't set up on this server.")
          : new AdminApiError(401, "UNAUTHENTICATED", "Sign in to the admin app to continue.");
      }
      if (permission && !verified.admin.permissions.includes(permission)) {
        throw new AdminApiError(403, "FORBIDDEN", "You don't have access to this.");
      }
      const admin = { ...verified.admin, requestId: verified.admin.requestId ?? requestId };
      const params = (ctx?.params ? await ctx.params : {}) as P;
      if (hasNul(params)) throw nulRefused();
      const result = await handler({ req, admin, params, requestId });
      if (result instanceof Response) {
        for (const [k, v] of Object.entries(headers)) if (!result.headers.has(k)) result.headers.set(k, v);
        return result;
      }
      return NextResponse.json(result ?? { ok: true }, { headers });
    } catch (caught) {
      const err = caught instanceof AdminApiError ? caught : (fromDatabase(caught) ?? caught);
      if (err instanceof AdminApiError) {
        if (err.code === "TIMEOUT") console.error(`[admin-api] ${req.method} ${new URL(req.url).pathname} timed out (request ${requestId})`);
        return NextResponse.json(
          { error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } },
          { status: err.status, headers },
        );
      }
      console.error(`[admin-api] ${req.method} ${new URL(req.url).pathname} failed (request ${requestId}):`, err);
      return NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong. Try again." } }, { status: 500, headers });
    }
  };
}

function validationError(error: z.ZodError): AdminApiError {
  const { formErrors, fieldErrors } = z.flattenError(error);
  const fields = Object.fromEntries(Object.entries(fieldErrors).filter((e): e is [string, string[]] => Array.isArray(e[1])));
  // The first field's own message, so a caller whose form doesn't have that
  // field still says what was wrong.
  return new AdminApiError(400, "VALIDATION", formErrors[0] ?? Object.values(fields)[0]?.[0] ?? "Check the highlighted fields.", fields);
}

/** Query-string values, validated. Unknown keys are refused when the schema is strict. */
export function parseQuery<T extends z.ZodType>(req: Request, schema: T): z.output<T> {
  const values = Object.fromEntries(new URL(req.url).searchParams);
  if (hasNul(values)) throw nulRefused();
  const parsed = schema.safeParse(values);
  if (!parsed.success) throw validationError(parsed.error);
  return parsed.data;
}

const MAX_BODY_BYTES = 64 * 1024;

/** A JSON body, validated. Bodies over 64 KB, or not JSON, are refused. */
export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.output<T>> {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new AdminApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Send the request body as JSON.");
  }
  // Refused before reading when the size is declared; checked again after.
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    throw new AdminApiError(413, "PAYLOAD_TOO_LARGE", "That request is too large.");
  }
  const text = await req.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new AdminApiError(413, "PAYLOAD_TOO_LARGE", "That request is too large.");
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new AdminApiError(400, "VALIDATION", "The request body isn't valid JSON.");
  }
  if (hasNul(json)) throw nulRefused();
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw validationError(parsed.error);
  return parsed.data;
}
