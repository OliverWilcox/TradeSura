import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";

// Database helpers for the admin API's heavier reads. The admin app gives up
// on a call after 15 seconds, but Postgres doesn't know that: a query it's
// still running keeps going on the database the live app shares. Bounded
// queries are stopped by Postgres itself first, and adminRoute answers that
// as a 503 (TIMEOUT).

export const ADMIN_QUERY_TIMEOUT_MS = 10_000;

/**
 * Runs one query with a statement timeout. SET LOCAL lasts only for its
 * transaction, so the connection goes back to the pool as it was (this works
 * through Supabase's transaction pooler too).
 */
export async function bounded<T>(query: Prisma.PrismaPromise<T>, timeoutMs = ADMIN_QUERY_TIMEOUT_MS): Promise<T> {
  const [, result] = await prisma.$transaction([
    prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = ${Math.floor(timeoutMs)}`),
    query,
  ]);
  return result;
}

const inFlight = new Map<string, Promise<unknown>>();

/**
 * Callers asking for the same thing while it's being worked out share one
 * answer: ten admins opening the dashboard at once run its money query once,
 * not ten times. Nothing is kept once it's answered.
 */
export function shared<T>(key: string, work: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const promise = work().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

/**
 * Search text for a LIKE pattern (Prisma's `contains` too), with its
 * wildcards taken literally: "%" finds a percent sign, not everything.
 */
export function likeTerm(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}
