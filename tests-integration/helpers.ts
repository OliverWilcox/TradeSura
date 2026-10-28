import { prisma } from "@/lib/db";
import { signAdminToken, type AdminPrincipal } from "@/lib/admin-api/token";
import { ADMIN_PERMISSIONS, type AdminPermission } from "@/lib/admin-api/permissions";

/** Empties every table (not the migration history). */
export async function resetDb() {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"public"."${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
}

export const SUPER_ADMIN: AdminPrincipal = {
  id: "adm_test_super",
  name: "Test Super",
  role: "super_admin",
  permissions: [...ADMIN_PERMISSIONS],
};

export const CHECKER: AdminPrincipal = {
  id: "adm_test_checker",
  name: "Test Checker",
  role: "verification_checker",
  permissions: ["verification:read", "verification:decide"],
};

export function tokenFor(admin: AdminPrincipal = SUPER_ADMIN, opts?: { secret?: string; seconds?: number }) {
  return signAdminToken(admin, opts);
}

export function withPermissions(...permissions: AdminPermission[]): AdminPrincipal {
  return { ...SUPER_ADMIN, id: "adm_test_limited", role: "limited", permissions };
}

type Handler<P> = (req: Request, ctx: { params: Promise<P> }) => Promise<Response>;

/** Calls a route handler as Next.js would. token: null sends no Authorization header. */
export async function call<P extends Record<string, string> = Record<string, never>>(
  handler: Handler<P>,
  opts: {
    method?: string;
    path?: string;
    query?: Record<string, string>;
    params?: P;
    token?: string | null;
    as?: AdminPrincipal;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
) {
  const url = new URL(`http://localhost:3000${opts.path ?? "/api/admin/v1/test"}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const headers = new Headers(opts.headers);
  if (opts.token !== null) headers.set("authorization", `Bearer ${opts.token ?? (await tokenFor(opts.as))}`);
  if (opts.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  const req = new Request(url, {
    method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
    headers,
    body: opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body),
  });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? ({} as P)) });
  const type = res.headers.get("content-type") ?? "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests read whatever shape the route sent
  const body: any = type.includes("json") && !type.includes("ndjson") ? await res.json() : await res.text();
  return { status: res.status, body, headers: res.headers };
}
