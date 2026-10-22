import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { startOfMonth } from "@/lib/enquiries";

// The engineer's enquiries from their TradeSura profile, town page and
// widget: messages to reply to, and call taps (Section 6).
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const since = startOfMonth();
  const [items, calls, messages] = await Promise.all([
    prisma.enquiry.findMany({ where: { engineerId }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.enquiry.count({ where: { engineerId, kind: "call", createdAt: { gte: since } } }),
    prisma.enquiry.count({ where: { engineerId, kind: "message", createdAt: { gte: since } } }),
  ]);
  return NextResponse.json({
    thisMonth: { total: calls + messages, calls, messages },
    items: items.map((q) => ({
      id: q.id,
      kind: q.kind,
      name: q.name,
      phone: q.phone,
      email: q.email,
      message: q.message,
      source: q.source,
      createdAt: q.createdAt.toISOString(),
    })),
  });
}
