import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";
import { checkWording } from "@/lib/compliance/blocklist";
import { normaliseUkPhone } from "@/lib/phone";
import { canonicalProfileDisplay, canonicalProfileUrl } from "@/lib/public-url";
import { ensureEngineerTown, townSlugOf } from "@/lib/town";

const Body = z.object({
  profileBio: z.string().max(600).default(""),
  serviceArea: z.string().max(120).default(""),
  publish: z.boolean().default(false),
  // Section 8 — Get found: Call/Message switches and the number shown.
  showCallButton: z.boolean().optional(),
  showMessageButton: z.boolean().optional(),
  enquiryPhone: z.string().max(30).optional(),
  // Optional override of the town the profile URL uses.
  town: z.string().max(60).optional(),
});

async function view(engineerId: string) {
  const e = await prisma.engineer.findUniqueOrThrow({ where: { id: engineerId } });
  return {
    profileBio: e.profileBio ?? "",
    serviceArea: e.serviceArea ?? "",
    published: Boolean(e.profilePublishedAt),
    url: canonicalProfileUrl(e),
    display: canonicalProfileDisplay(e),
    town: e.town ?? "",
    photos: e.profilePhotos,
    showCallButton: e.showCallButton,
    showMessageButton: e.showMessageButton,
    enquiryPhone: e.enquiryPhone ?? "",
    accountPhone: e.phone ?? "",
  };
}

// "Get found on Google" — the engineer's public profile at
// tradesura.com/gas-engineers/{town}/{slug} (Section 6).
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const exists = await prisma.engineer.count({ where: { id: engineerId } });
  if (!exists) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(await view(engineerId));
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
  const b = parsed.data;
  const bio = b.profileBio.trim();
  const area = b.serviceArea.trim();
  const town = b.town?.trim();
  // Customers read this, so it's held to the same wording rules as plans.
  for (const [field, text] of [["profileBio", bio], ["serviceArea", area], ["town", town ?? ""]] as const) {
    const check = checkWording(text);
    if (!check.ok) {
      return NextResponse.json({ error: "blocked_wording", field, ...check }, { status: 422 });
    }
  }
  if (b.publish && area.length < 2) {
    return NextResponse.json(
      { error: "Add the areas you cover — it's what people search for.", field: "serviceArea" },
      { status: 400 },
    );
  }
  let enquiryPhone: string | null | undefined = undefined;
  if (b.enquiryPhone !== undefined) {
    if (b.enquiryPhone.trim() === "") enquiryPhone = null;
    else {
      enquiryPhone = normaliseUkPhone(b.enquiryPhone);
      if (!enquiryPhone) {
        return NextResponse.json(
          { error: "That doesn't look like a UK phone number.", field: "enquiryPhone" },
          { status: 400 },
        );
      }
    }
  }
  if (town !== undefined && town !== "" && !townSlugOf(town)) {
    return NextResponse.json({ error: "Enter the town you're based in.", field: "town" }, { status: 400 });
  }

  const current = await prisma.engineer.findUnique({
    where: { id: engineerId },
    select: { profilePublishedAt: true },
  });
  const publishing = b.publish && !current?.profilePublishedAt;
  await prisma.engineer.update({
    where: { id: engineerId },
    data: {
      profileBio: bio || null,
      serviceArea: area || null,
      profilePublishedAt: b.publish ? (current?.profilePublishedAt ?? new Date()) : null,
      ...(b.showCallButton !== undefined ? { showCallButton: b.showCallButton } : {}),
      ...(b.showMessageButton !== undefined ? { showMessageButton: b.showMessageButton } : {}),
      ...(enquiryPhone !== undefined ? { enquiryPhone } : {}),
      ...(town ? { town, townSlug: townSlugOf(town) } : {}),
    },
  });
  // Backfill town/townSlug (and its TownPage row) when the profile goes out.
  if (b.publish || town) await ensureEngineerTown(engineerId);
  if (publishing) await track("profile_published", { type: "ENGINEER", id: engineerId }, {});
  return NextResponse.json({ ok: true, ...(await view(engineerId)) });
}
