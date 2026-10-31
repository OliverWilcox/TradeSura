// Wipe the engineers and customers marked as test data in the admin app
// (AdminTestMark), the same way the admin's Delete accounts page deletes
// them (lib/admin/accounts.ts): engineers anonymised with their customers
// scrubbed, payment records kept. Anyone still on a live plan is left alone.
//
// Dry run by default: prints what would go and changes nothing.
//   npx tsx scripts/admin-wipe-test-data.ts
// To wipe, name the database host as well, so it can't run somewhere by mistake:
//   npx tsx scripts/admin-wipe-test-data.ts --apply --host=<database host> --reason="Testers' accounts"
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/db";
import { ADMIN_PERMISSIONS } from "../lib/admin-api/permissions";
import { deleteAccounts, planWipe } from "../lib/admin/accounts";

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const [key, value = ""] = a.replace(/^--/, "").split("=");
  args.set(key, value);
}

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgresql://unset").hostname;
  const plan = await planWipe();
  const deletable = { engineers: plan.engineers.filter((e) => e.canDelete), customers: plan.customers.filter((c) => c.canDelete) };
  console.log(`Database: ${host}`);
  for (const e of plan.engineers) {
    console.log(`  engineer ${e.id} ${e.name}: ${e.customers} customers${e.canDelete ? "" : `, ${e.livePlans} on a live plan: LEFT ALONE until those end`}`);
  }
  for (const c of plan.customers) console.log(`  customer ${c.id} ${c.name}${c.canDelete ? "" : `: ${c.livePlans} live plan(s), LEFT ALONE`}`);
  console.log(`Would delete ${deletable.engineers.length} engineer(s) and ${deletable.customers.length} customer(s).`);

  if (!args.has("apply")) {
    console.log("Dry run: nothing changed. Add --apply --host=<database host> to wipe.");
    return;
  }
  if (args.get("host") !== host) throw new Error(`Refusing to wipe: --host=${args.get("host") ?? ""} doesn't name this database (${host}).`);
  const admin = { id: "script:wipe-test-data", name: "Test data wipe (script)", role: "super_admin", permissions: [...ADMIN_PERMISSIONS], requestId: randomUUID() };
  const { items } = await deleteAccounts(admin, {
    engineerIds: deletable.engineers.map((e) => e.id),
    customerIds: deletable.customers.map((c) => c.id),
    reason: args.get("reason") ?? "Test data wipe",
  });
  for (const i of items) console.log(`  ${i.type} ${i.id}: ${i.outcome}${i.message ? ` (${i.message})` : ""}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
