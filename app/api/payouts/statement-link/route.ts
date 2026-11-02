import { NextResponse } from "next/server";
import { getEngineerId, signToken } from "@/lib/auth";
import { appUrl } from "@/lib/app-url";
import { isMonth } from "@/lib/fee-statement";

// The app opens the statement in the in-app browser, which can't send the
// bearer token — so it asks for a short-lived link to that one month.
export async function GET(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const month = new URL(req.url).searchParams.get("month");
  if (!isMonth(month)) return NextResponse.json({ error: "Pick a month." }, { status: 400 });
  // No `engineerId` claim: getActor() treats any token with one as a
  // sign-in, and this one sits in a URL. It only opens this statement.
  const t = await signToken({ statementFor: engineerId, month, purpose: "fee-statement" }, "15m");
  return NextResponse.json({ url: `${appUrl()}/api/payouts/statement?month=${month}&t=${encodeURIComponent(t)}` });
}
