import { SignJWT, jwtVerify } from "jose";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";

const secret = new TextEncoder().encode(process.env.SESSION_SECRET);

export async function signToken(payload: Record<string, string>, expiresIn: string) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresIn)
    .sign(secret);
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as Record<string, string>;
  } catch {
    return null;
  }
}

// Who is making this request (Build Review 2, section 8). An owner acts on
// their own business; a staff engineer signs in as themselves (actorId) but
// works inside their owner's business (businessId). Staff tokens carry the
// owner's id as `biz`, and are re-checked here on every request so removing
// staff, or deleting either account, cuts access off straight away.
export type Actor = { actorId: string; businessId: string; role: "owner" | "staff" };

export async function getActor(): Promise<Actor | null> {
  const auth = (await headers()).get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const payload = await verifyToken(auth.slice(7));
  const engineerId = payload?.engineerId;
  if (!engineerId) return null;
  const row = await prisma.engineer.findUnique({
    where: { id: engineerId },
    select: { ownerId: true, staffRemovedAt: true, deletedAt: true, owner: { select: { deletedAt: true } } },
  });
  if (!row || row.deletedAt) return null;
  if (row.ownerId) {
    if (row.staffRemovedAt || row.owner?.deletedAt || payload.biz !== row.ownerId) return null;
    return { actorId: engineerId, businessId: row.ownerId, role: "staff" };
  }
  return { actorId: engineerId, businessId: engineerId, role: "owner" };
}

// The engineer surface is the Expo app only now — it authenticates every
// request with a bearer token (see mobile/lib/api.ts), never a cookie.
// Owners only: staff get null here, so every route that hasn't explicitly
// opted in with getActor() (money, settings, plans, imports…) is closed to
// them by default.
export async function getEngineerId(): Promise<string | null> {
  const actor = await getActor();
  return actor?.role === "owner" ? actor.businessId : null;
}
