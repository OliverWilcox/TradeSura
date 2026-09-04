import { NextResponse } from "next/server";
import { z } from "zod";
import { getEngineerId } from "@/lib/auth";
import { importCustomers } from "@/lib/import-customers";
import { track } from "@/lib/track";

const Body = z.object({
  contacts: z
    .array(
      z.object({
        name: z.string().max(120),
        phone: z.string().min(6).max(20),
        email: z.string().max(200).optional(),
      }),
    )
    .min(1)
    .max(500),
  // PECR basis for later messaging these contacts: the engineer confirms
  // they're his own customers before any import proceeds (review #10).
  confirmOwn: z.literal(true),
});

// Phone-book import via the browser Contact Picker API (Android Chrome).
export async function POST(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Confirm these are your own customers before importing." },
      { status: 400 },
    );
  }

  await track("import_consent_confirmed", { type: "ENGINEER", id: engineerId }, {
    source: "contacts",
    count: parsed.data.contacts.length,
  });

  const result = await importCustomers(
    engineerId,
    parsed.data.contacts.map((c) => {
      const parts = c.name.trim().split(/\s+/);
      return {
        firstName: parts[0] ?? "",
        lastName: parts.slice(1).join(" "),
        phone: c.phone,
        email: c.email,
      };
    }),
  );
  return NextResponse.json(result);
}
