import { NextResponse } from "next/server";
import { track } from "@/lib/track";
import { resolveClaimCode } from "@/lib/claim";

// Used by the web claim page (C5) and the mobile signup prefill. Never a dead
// end: an unknown code just returns { valid: false } and the caller falls
// through to the generic signup.
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code") ?? "";
  if (!code) return NextResponse.json({ valid: false });

  const result = await resolveClaimCode(code);
  await track(
    result.valid ? "claim_code_resolved" : "claim_code_failed",
    { type: "SYSTEM" },
    { code: code.slice(0, 20), ...(result.valid ? { variantCell: result.variantCell } : {}) },
  );
  return NextResponse.json(result);
}
