import { NextResponse } from "next/server";
import { z } from "zod";
import { getEngineerId } from "@/lib/auth";
import { importCustomers } from "@/lib/import-customers";

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
});

// Phone-book import via the browser Contact Picker API (Android Chrome).
export async function POST(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "No contacts received." }, { status: 400 });
  }

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
