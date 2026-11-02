import { NextResponse } from "next/server";
import { track } from "@/lib/track";
import { claimLookupLimited, requestIp, resolveClaimCode } from "@/lib/claim";

// Used by the web claim page (C5) and the mobile signup prefill. Never a dead
// end: an unknown code just returns { valid: false } and the caller falls
// through to the generic signup. A bare code returns only what's printed on
// the letter; the mobile and addresses confirmed on the claim page need the
// personal link's token (`t`). Lookups are rate-limited per IP.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") ?? "";
  if (!code) return NextResponse.json({ valid: false });
  if (await claimLookupLimited(requestIp(req.headers))) {
    return NextResponse.json({ error: "Too many tries. Wait a few minutes and try again." }, { status: 429 });
  }

  const result = await resolveClaimCode(code, url.searchParams.get("t"));
  await track(
    result.valid ? "claim_code_resolved" : "claim_code_failed",
    { type: "SYSTEM" },
    { code: code.slice(0, 20), ...(result.valid ? { variantCell: result.variantCell } : {}) },
  );
  return NextResponse.json(result);
}
