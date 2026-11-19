import "dotenv/config";
import { prisma } from "../lib/db";
import { cardReadConfigured } from "../lib/card-read";
import { runCardCheck, tellReopened } from "../lib/admin/verifications";

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const [key, value = ""] = a.replace(/^--/, "").split("=");
  args.set(key, value);
}

const USAGE = [
  "Engineers migration 0052 took off live because their Gas Safe card was never read, and what to do about them.",
  "  npx tsx scripts/admin-card-check.ts                      lists them, changes nothing",
  "  npx tsx scripts/admin-card-check.ts --read               reads each card photo on file (needs ANTHROPIC_API_KEY); a clean reading puts them live again with their original dates",
  "  npx tsx scripts/admin-card-check.ts --tell --host=<db>   asks each one with no card photo for one, once, by push, text and email",
  "  npx tsx scripts/admin-card-check.ts --undo --host=<db>   puts the ones still waiting back live with their original dates and any re-check 0052 cleared; only with the backend rolled back to the release before 0052",
].join("\n");

const reopened = () =>
  prisma.engineer.findMany({
    where: { deletedAt: null, gasSafeReopenedAt: { not: null }, gasSafeVerifiedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, firstName: true, lastName: true, tradingName: true, gasSafeCardUrl: true, gasSafeVerifiedBeforeReopenAt: true, gasSafeRegisterCheckedBeforeReopenAt: true },
  });

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "never");

function needHost(host: string) {
  if (args.get("host") !== host) throw new Error(`Refusing to change anything: --host=${args.get("host") ?? ""} doesn't name this database (${host}).`);
}

async function main() {
  if (args.has("help")) {
    console.log(USAGE);
    return;
  }
  const host = new URL(process.env.DATABASE_URL ?? "postgresql://unset").hostname;
  console.log(`Database: ${host}`);
  if (args.has("read")) {
    if (!cardReadConfigured()) throw new Error("ANTHROPIC_API_KEY isn't set, so cards can't be read.");
    for (const e of await reopened()) {
      if (!e.gasSafeCardUrl) continue;
      const read = await runCardCheck(e.id, { force: true });
      console.log(`  read ${e.id}: ${read?.outcome ?? "no photo"}${read?.complete ? ", complete" : ""}`);
    }
  }
  const rows = await reopened();
  const told = new Set(
    (await prisma.event.findMany({ where: { name: "gas_safe_card_check_reopen_told" }, select: { meta: true } })).map((ev) => (ev.meta as { engineerId?: string } | null)?.engineerId),
  );
  for (const e of rows) {
    const name = [e.firstName, e.lastName].filter(Boolean).join(" ") || "Name not given";
    console.log(
      `  ${e.id} ${name}, ${e.tradingName ?? "no business name"}: ${e.gasSafeCardUrl ? "card photo on file, waiting for a person" : "no card photo"}, live since ${day(e.gasSafeVerifiedBeforeReopenAt)}, register check ${day(e.gasSafeRegisterCheckedBeforeReopenAt)}${told.has(e.id) ? ", told" : ""}`,
    );
  }
  console.log(`${rows.length} engineer(s) waiting for their card check.`);
  if (args.has("tell")) {
    needHost(host);
    for (const e of rows) {
      if (e.gasSafeCardUrl || told.has(e.id)) continue;
      await tellReopened(e.id);
      console.log(`  ${e.id}: asked for a card photo`);
    }
    return;
  }
  if (args.has("undo")) {
    needHost(host);
    for (const e of rows) {
      await prisma.$transaction(async (tx) => {
        const reopen = (await tx.event.findUnique({ where: { id: `reopen-0052-${e.id}` }, select: { meta: true } }))?.meta as { recheckRequestedAt?: string | null; recheckReason?: string | null } | undefined;
        await tx.engineer.update({
          where: { id: e.id },
          data: {
            gasSafeVerifiedAt: e.gasSafeVerifiedBeforeReopenAt,
            gasSafeRegisterCheckedAt: e.gasSafeRegisterCheckedBeforeReopenAt,
            gasSafeReopenedAt: null,
            gasSafeVerifiedBeforeReopenAt: null,
            gasSafeRegisterCheckedBeforeReopenAt: null,
            ...(reopen?.recheckRequestedAt ? { gasSafeRecheckRequestedAt: new Date(reopen.recheckRequestedAt), gasSafeRecheckReason: reopen.recheckReason ?? null } : {}),
          },
        });
        await tx.event.create({ data: { name: "gas_safe_card_check_reopen_undone", actorType: "SYSTEM", meta: { engineerId: e.id, via: "scripts/admin-card-check.ts" } } });
      });
      console.log(`  ${e.id}: live again from ${day(e.gasSafeVerifiedBeforeReopenAt)}`);
    }
    return;
  }
  console.log(`Nothing changed.\n${USAGE}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
