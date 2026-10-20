import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";
import { checkWording } from "@/lib/compliance/blocklist";
import { profileDisplay, profileUrl } from "@/lib/public-url";

const Body = z.object({
  profileBio: z.string().max(600).default(""),
  serviceArea: z.string().max(120).default(""),
  publish: z.boolean().default(false),
});

// "Get found on Google" — the engineer's public profile at tradesura.com/{slug}.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const e = await prisma.engineer.findUnique({ where: { id: engineerId } });
  if (!e) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({
    profileBio: e.profileBio ?? "",
    serviceArea: e.serviceArea ?? "",
    published: Boolean(e.profilePublishedAt),
    url: profileUrl(e.slug),
    display: profileDisplay(e.slug),
  });
}

export async function PUT(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Keep the about text under 600 characters and the area under 120." },
      { status: 400 },
    );
  }
  const bio = parsed.data.profileBio.trim();
  const area = parsed.data.serviceArea.trim();
  // Customers read this, so it's held to the same wording rules as plans.
  for (const [field, text] of [["profileBio", bio], ["serviceArea", area]] as const) {
    const check = checkWording(text);
    if (!check.ok) {
      return NextResponse.json({ error: "blocked_wording", field, ...check }, { status: 422 });
    }
  }
  if (parsed.data.publish && area.length < 2) {
    return NextResponse.json(
      { error: "Add the areas you cover — it's what people search for.", field: "serviceArea" },
      { status: 400 },
    );
  }
  const current = await prisma.engineer.findUnique({
    where: { id: engineerId },
    select: { profilePublishedAt: true },
  });
  const publishing = parsed.data.publish && !current?.profilePublishedAt;
  await prisma.engineer.update({
    where: { id: engineerId },
    data: {
      profileBio: bio || null,
      serviceArea: area || null,
      profilePublishedAt: parsed.data.publish ? (current?.profilePublishedAt ?? new Date()) : null,
    },
  });
  if (publishing) await track("profile_published", { type: "ENGINEER", id: engineerId }, {});
  return NextResponse.json({ ok: true, published: parsed.data.publish });
}
