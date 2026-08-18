import { NextResponse } from "next/server";
import { getEngineerId, signToken } from "@/lib/auth";
import { gcConfigured, oauthAuthorizeUrl } from "@/lib/gocardless";

// The only GC OAuth initiator now that the engineer surface is mobile-only.
// Returns the authorize URL as JSON (bearer-authenticated fetch) rather than
// redirecting, since expo-web-browser's auth session needs the URL itself —
// and the browser navigation that follows can't carry an Authorization
// header, so /api/gc/callback identifies the engineer from this signed state.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!gcConfigured()) {
    return NextResponse.json(
      { error: "Payment provider credentials aren't configured yet." },
      { status: 400 },
    );
  }
  const state = await signToken({ engineerId }, "15m");
  return NextResponse.json({ url: oauthAuthorizeUrl(state) });
}
