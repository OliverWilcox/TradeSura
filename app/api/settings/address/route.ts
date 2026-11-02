import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { checkChosenSlug, moveSlug } from "@/lib/slug";
import { profileDisplay } from "@/lib/public-url";
import { track } from "@/lib/track";

// Review 4 — "let engineers choose their name once at setup". GET checks a
// name as they type; POST saves it for good. The address they had before
// keeps redirecting, so nothing already shared breaks. Owners only.
export async function GET(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const wanted = new URL(req.url).searchParams.get("slug") ?? "";
  const r = await checkChosenSlug(wanted, engineerId);
  return NextResponse.json("error" in r ? { ok: false, error: r.error } : { ok: true, slug: r.slug, display: profileDisplay(r.slug) });
}

const Body = z.object({ slug: z.string().trim().min(1).max(60) });

export async function POST(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter the address you'd like." }, { status: 400 });

  const engineer = await prisma.engineer.findUniqueOrThrow({
    where: { id: engineerId },
    select: { slug: true, previousSlugs: true, slugChosenAt: true },
  });
  if (engineer.slugChosenAt) {
    return NextResponse.json(
      { error: "Your address is already set. Message support if it really needs to change." },
      { status: 409 },
    );
  }
  const r = await checkChosenSlug(parsed.data.slug, engineerId);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 409 });

  await prisma.engineer.update({
    where: { id: engineerId },
    data: { ...moveSlug(engineer, r.slug), slugChosenAt: new Date() },
  });
  await track("address_chosen", { type: "ENGINEER", id: engineerId }, { slug: r.slug, from: engineer.slug }).catch(() => {});
  return NextResponse.json({ ok: true, slug: r.slug, display: profileDisplay(r.slug) });
}
