// Import data/gas_safe.csv into the GasSafeRecord lookup table.
// Columns: reg no, name, company, categories. Refresh is a cron concern later.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { prisma } from "../lib/db";
import { normaliseRegNo } from "../lib/gas-safe";

async function main() {
  const csv = readFileSync("data/gas_safe.csv", "utf8");
  const rows: Record<string, string>[] = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  let imported = 0;
  let skipped = 0;
  for (const row of rows) {
    const regNo = normaliseRegNo(row.reg_no ?? "");
    if (!regNo) {
      skipped++;
      continue;
    }
    await prisma.gasSafeRecord.upsert({
      where: { regNo },
      update: { name: row.name, company: row.company, categories: row.categories },
      create: { regNo, name: row.name, company: row.company, categories: row.categories },
    });
    imported++;
  }
  console.log(`Gas Safe import: ${imported} records imported, ${skipped} skipped`);
}

main().then(() => process.exit(0));
