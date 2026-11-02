// Import data/gas_safe.csv into the GasSafeRecord lookup table.
// Columns: reg no, name, company, categories; and, when the register file has
// them, address, postcode and card_expiry (YYYY-MM-DD or DD/MM/YYYY), which the
// admin's check page sets beside what the engineer gave (QA-07). Records when
// the copy was imported (AppSetting gas_safe_register_imported_at), so the
// check page can say how old it is. Refresh is a cron concern later.
//   npm run import:gas-safe               imports, as before
//   npm run import:gas-safe -- --dry-run  says what it would import, changes nothing
import "dotenv/config";
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { prisma } from "../lib/db";
import { normaliseRegNo } from "../lib/gas-safe";
import { normalisePostcode, UK_POSTCODE } from "../lib/validate";
import { REGISTER_IMPORTED_SETTING } from "../lib/admin/verifications";

const dryRun = process.argv.includes("--dry-run");

/** A card expiry as a UTC date, or null when it's missing or unreadable. */
function cardExpiryOf(v: string | undefined): Date | null {
  const s = (v ?? "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const uk = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : uk ? [uk[3], uk[2], uk[1]] : [];
  if (!y) return null;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.getUTCDate() === Number(d) && date.getUTCMonth() === Number(m) - 1 ? date : null;
}

async function main() {
  const csv = readFileSync("data/gas_safe.csv", "utf8");
  const rows: Record<string, string>[] = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  let imported = 0;
  let skipped = 0;
  const withExtra = { address: 0, cardExpiry: 0 };
  for (const row of rows) {
    const regNo = normaliseRegNo(row.reg_no ?? "");
    if (!regNo) {
      skipped++;
      continue;
    }
    const postcode = row.postcode ? normalisePostcode(row.postcode) : "";
    const extra = {
      address: row.address?.trim() || null,
      postcode: UK_POSTCODE.test(postcode) ? postcode : null,
      cardExpiresOn: cardExpiryOf(row.card_expiry),
    };
    if (extra.address || extra.postcode) withExtra.address++;
    if (extra.cardExpiresOn) withExtra.cardExpiry++;
    if (!dryRun) {
      await prisma.gasSafeRecord.upsert({
        where: { regNo },
        update: { name: row.name, company: row.company, categories: row.categories, ...extra },
        create: { regNo, name: row.name, company: row.company, categories: row.categories, ...extra },
      });
    }
    imported++;
  }
  console.log(
    `Gas Safe import: ${imported} records ${dryRun ? "would be imported" : "imported"}, ${skipped} skipped; ${withExtra.address} with an address, ${withExtra.cardExpiry} with a card expiry`,
  );
  if (dryRun) {
    console.log("Dry run: nothing changed.");
    return;
  }
  const at = new Date().toISOString();
  await prisma.appSetting.upsert({ where: { key: REGISTER_IMPORTED_SETTING }, update: { value: at }, create: { key: REGISTER_IMPORTED_SETTING, value: at } });
}

main().then(() => process.exit(0));
