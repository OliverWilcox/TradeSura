import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

const secret = new TextEncoder().encode(process.env.SESSION_SECRET);
const SESSION_COOKIE = "pl_session";

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

export async function createSession(engineerId: string) {
  const token = await signToken({ engineerId }, "30d");
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
}

export async function clearSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getEngineerId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  return payload?.engineerId ?? null;
}

// For engineer-surface pages: redirects to sign-in when not authenticated.
export async function requireEngineer() {
  const id = await getEngineerId();
  if (!id) redirect("/signin");
  const engineer = await prisma.engineer.findUnique({ where: { id } });
  if (!engineer) redirect("/signin");
  return engineer;
}
