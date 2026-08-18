import { SignJWT, jwtVerify } from "jose";
import { headers } from "next/headers";

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

// The engineer surface is the Expo app only now — it authenticates every
// request with a bearer token (see mobile/lib/api.ts), never a cookie.
export async function getEngineerId(): Promise<string | null> {
  const auth = (await headers()).get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const payload = await verifyToken(auth.slice(7));
  return payload?.engineerId ?? null;
}
