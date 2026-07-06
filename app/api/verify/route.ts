import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyGasSafe } from "@/lib/gas-safe";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";

const Body = z.object({ regNo: z.string().min(1).max(20) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter your Gas Safe registration number." }, { status: 400 });
  }
  const record = await verifyGasSafe(parsed.data.regNo);
  if (!record) {
    return NextResponse.json(
      { error: "No match on the Gas Safe register. Check the number and try again." },
      { status: 404 },
    );
  }
  const engineerId = await getEngineerId();
  await track(
    "gas_safe_verified",
    engineerId ? { type: "ENGINEER", id: engineerId } : { type: "SYSTEM" },
    { regNo: record.regNo },
  );
  return NextResponse.json({
    regNo: record.regNo,
    name: record.name,
    company: record.company,
    categories: record.categories,
  });
}
