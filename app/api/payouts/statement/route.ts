import { getEngineerId, verifyToken } from "@/lib/auth";
import { buildStatement, isMonth, statementHtml } from "@/lib/fee-statement";

// Matt, 30 Oct §9.5 — the monthly statement / invoice of our 20% fee, as a
// printable page. Signed in (bearer), or by a 15-minute link from
// statement-link for one month.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const month = params.get("month");
  if (!isMonth(month)) return new Response("Pick a month.", { status: 400 });
  let engineerId = await getEngineerId();
  const t = params.get("t");
  if (!engineerId && t) {
    const p = await verifyToken(t);
    if (p?.purpose === "fee-statement" && p.month === month && !p.engineerId) engineerId = p.statementFor ?? null;
  }
  if (!engineerId) return new Response("This link has expired. Open it again from Payouts in the app.", { status: 401 });
  const html = statementHtml(await buildStatement(engineerId, month));
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" },
  });
}
