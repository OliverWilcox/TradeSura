import { NextResponse } from "next/server";
import { parse } from "csv-parse/sync";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { normaliseUkPhone } from "@/lib/phone";

// CSV import only in P0 (contacts/paste are later). Dedupe = exact match on
// normalised phone per engineer.
// ponytail: exact phone dedupe; fuzzy name/address matching when it earns its keep
export async function POST(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Attach a CSV file." }, { status: 400 });
  }
  if (file.size > 2 * 1024 * 1024) {
    return NextResponse.json({ error: "That file is too big (2MB max)." }, { status: 400 });
  }

  let rows: Record<string, string>[];
  try {
    rows = parse(await file.text(), { columns: true, skip_empty_lines: true, trim: true });
  } catch {
    return NextResponse.json({ error: "Couldn't read that CSV — check the format." }, { status: 400 });
  }

  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const phone = normaliseUkPhone(row.phone ?? "");
    const firstName = (row.first_name ?? "").trim();
    const lastName = (row.last_name ?? "").trim();
    if (!phone || !firstName || !lastName) {
      skipped++;
      continue;
    }
    const lastServiced = row.last_serviced ? new Date(row.last_serviced) : null;
    const existing = await prisma.customer.findUnique({
      where: { engineerId_phone: { engineerId, phone } },
    });
    if (existing) {
      await prisma.customer.update({
        where: { id: existing.id },
        data: { email: row.email || existing.email },
      });
      updated++;
      continue;
    }
    await prisma.customer.create({
      data: {
        engineerId,
        firstName,
        lastName,
        phone,
        email: row.email || null,
        ...(row.address_line1 && row.postcode
          ? {
              properties: {
                create: {
                  addressLine1: row.address_line1,
                  town: row.town || null,
                  postcode: row.postcode,
                  ...(row.appliance_make
                    ? {
                        appliances: {
                          create: {
                            make: row.appliance_make,
                            model: row.appliance_model || null,
                            type: "boiler",
                            lastServicedAt:
                              lastServiced && !isNaN(lastServiced.getTime()) ? lastServiced : null,
                          },
                        },
                      }
                    : {}),
                },
              },
            }
          : {}),
      },
    });
    imported++;
  }

  return NextResponse.json({ imported, updated, skipped });
}
