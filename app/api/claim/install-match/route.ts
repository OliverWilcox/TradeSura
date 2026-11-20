import { NextResponse } from "next/server";
import { matchInstall } from "@/lib/install-match";

// The app's first open with no claim code: the code whose claim page sent
// this network to the App Store in the last hour, if there was exactly one
// (lib/install-match.ts). The app then resolves it like a typed code.
export async function GET(req: Request) {
  return NextResponse.json({ code: await matchInstall(req) });
}
