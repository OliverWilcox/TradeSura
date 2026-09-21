import { NextResponse, type NextRequest } from "next/server";

// Dev-tooling CORS for the API. This app's real clients are the native
// mobile app (no browser same-origin policy applies) and same-origin
// server-rendered customer pages — no real external site ever needs to call
// this bearer-token-authed API cross-origin, so this only ever opens the
// door for localhost.
//
// Gated on the request's Origin being localhost/127.0.0.1, not on an
// environment flag: Origin is set by the browser itself and cannot be
// spoofed by page JavaScript, so a real attacker's site can never present
// "http://localhost:xxxx" as its Origin and get through this check. That
// makes it safe to leave active unconditionally — including in real
// production — unlike an environment-based toggle (VERCEL_ENV, NODE_ENV),
// which either has to be re-enabled per deployment for local testing to
// work at all, or risks accidentally staying on for real traffic. This is
// what lets the Expo web preview (localhost:8081, a different origin from
// the API) reach the API for testing, on any deployment, permanently.
function isLocalhostOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export function middleware(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!req.nextUrl.pathname.startsWith("/api/") || !isLocalhostOrigin(origin)) {
    return NextResponse.next();
  }
  if (req.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin!,
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Max-Age": "86400",
      },
    });
  }
  const res = NextResponse.next();
  res.headers.set("Access-Control-Allow-Origin", origin!);
  res.headers.set("Access-Control-Allow-Credentials", "true");
  return res;
}

export const config = {
  matcher: "/api/:path*",
};
