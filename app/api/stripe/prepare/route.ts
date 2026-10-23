import { NextResponse } from "next/server";
import { getEngineerId } from "@/lib/auth";
import { stripeConfigured } from "@/lib/stripe";
import { ensureConnectAccount } from "@/lib/stripe-onboarding";

// The Get paid screen calls this when it opens, so the connected account is
// created and pre-filled (several slow Stripe calls) while the engineer reads
// the explainer. "Continue to Stripe" then only waits for the link.
export async function POST() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!stripeConfigured()) return NextResponse.json({ ok: false });
  try {
    await ensureConnectAccount(engineerId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[stripe] prepare failed:", err);
    return NextResponse.json({ ok: false });
  }
}
