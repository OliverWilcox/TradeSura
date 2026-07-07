import { prisma } from "@/lib/db";
import { normaliseUkPhone } from "@/lib/phone";

export type ImportRow = {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  addressLine1?: string;
  town?: string;
  postcode?: string;
  applianceMake?: string;
  applianceModel?: string;
  lastServiced?: string;
};

// Shared by CSV upload and phone-book import. Dedupe = exact match on
// normalised phone per engineer.
// ponytail: exact phone dedupe; fuzzy name/address matching when it earns its keep
export async function importCustomers(engineerId: string, rows: ImportRow[]) {
  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const phone = normaliseUkPhone(row.phone ?? "");
    const firstName = (row.firstName ?? "").trim();
    const lastName = (row.lastName ?? "").trim();
    if (!phone || !firstName) {
      skipped++;
      continue;
    }
    const lastServiced = row.lastServiced ? new Date(row.lastServiced) : null;
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
        lastName: lastName || "—",
        phone,
        email: row.email || null,
        ...(row.addressLine1 && row.postcode
          ? {
              properties: {
                create: {
                  addressLine1: row.addressLine1,
                  town: row.town || null,
                  postcode: row.postcode,
                  ...(row.applianceMake
                    ? {
                        appliances: {
                          create: {
                            make: row.applianceMake,
                            model: row.applianceModel || null,
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
  return { imported, updated, skipped };
}
