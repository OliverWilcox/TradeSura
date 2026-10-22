import { NextResponse } from "next/server";
import { z } from "zod";
import { track } from "@/lib/track";
import { linkSticker, stickerCodeFromScan, stickerStock } from "@/lib/stickers";
import { passportAccess } from "../access";

const Body = z.object({ code: z.string().trim().min(4).max(200) });

// Section 4 — "Link sticker": tie a pack sticker to this home's passport,
// scanned with the camera or typed in.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await passportAccess(id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!access.passportId) {
    return NextResponse.json(
      { error: "Stickers link to a Home Passport, which starts when they join a plan." },
      { status: 409 },
    );
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter the code from the sticker." }, { status: 400 });

  const businessId = access.actor.businessId;
  // The camera hands over the QR's URL; a typed code comes as-is.
  const code = stickerCodeFromScan(parsed.data.code) ?? parsed.data.code;
  const result = await linkSticker(businessId, code, access.passportId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  await track("sticker_linked", { type: "ENGINEER", id: access.actor.actorId }, {
    code: result.code,
    customerId: id,
    engineerId: businessId,
  });
  return NextResponse.json({ ok: true, code: result.code, stock: await stickerStock(businessId) });
}
