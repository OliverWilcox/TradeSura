import { NextResponse } from "next/server";
import { parse } from "csv-parse/sync";
import { getEngineerId } from "@/lib/auth";
import { importCustomers } from "@/lib/import-customers";
import { track } from "@/lib/track";

export async function POST(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Attach a CSV file." }, { status: 400 });
  }
  // Part 10 — "Import your book (CSV / phone contacts) keeps the
  // own-customers PECR checkbox." The contacts-import path
  // (/api/customers/import-contacts) already requires this; the CSV path
  // didn't. Same basis for the same reason: these contacts get texted plan
  // offers later, so consent has to exist before the import, not after.
  if (form?.get("confirmOwn") !== "1") {
    return NextResponse.json(
      { error: "Confirm these are your own customers before importing." },
      { status: 400 },
    );
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

  await track("import_consent_confirmed", { type: "ENGINEER", id: engineerId }, {
    source: "csv",
    count: rows.length,
  });

  const result = await importCustomers(
    engineerId,
    rows.map((r) => ({
      firstName: r.first_name ?? "",
      lastName: r.last_name ?? "",
      phone: r.phone ?? "",
      email: r.email,
      addressLine1: r.address_line1,
      town: r.town,
      postcode: r.postcode,
      applianceMake: r.appliance_make,
      applianceModel: r.appliance_model,
      lastServiced: r.last_serviced,
    })),
  );
  return NextResponse.json(result);
}
