// Copy each engineer's sign-up address into their trading address
// (EngineerTradingAddress), filling an empty town from it. See
// lib/admin/address-copy.ts for who's left out and why; 302 MD LTD, whose
// sign-up address is its registered office, is one of them.
//
// Dry run by default: prints what would change and changes nothing.
//   npx tsx scripts/admin-copy-addresses.ts
// To copy, name the database host as well, so it can't run somewhere by mistake:
//   npx tsx scripts/admin-copy-addresses.ts --apply --host=<database host>
import "dotenv/config";
import { prisma } from "../lib/db";
import { formatAddress } from "../lib/addresses";
import { applyAddressCopy, planAddressCopy } from "../lib/admin/address-copy";

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const [key, value = ""] = a.replace(/^--/, "").split("=");
  args.set(key, value);
}

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgresql://unset").hostname;
  const steps = await planAddressCopy();
  console.log(`Database: ${host}`);
  for (const s of steps) {
    if (s.action === "copy") {
      console.log(`  copy  ${s.id} ${s.name}: ${formatAddress(s.address).replace(/\n/g, ", ")}${s.fillsTown ? ` (town set to ${s.address.town})` : ""}`);
    } else {
      console.log(`  skip  ${s.id} ${s.name}: ${s.why}`);
    }
  }
  const copies = steps.filter((s) => s.action === "copy").length;
  console.log(`Would copy ${copies} address(es); ${steps.length - copies} left for an admin.`);

  if (!args.has("apply")) {
    console.log("Dry run: nothing changed. Add --apply --host=<database host> to copy.");
    return;
  }
  if (args.get("host") !== host) throw new Error(`Refusing to copy: --host=${args.get("host") ?? ""} doesn't name this database (${host}).`);
  const { copied } = await applyAddressCopy(steps);
  console.log(`Copied ${copied}.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
