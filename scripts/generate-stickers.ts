// Section 4 — mint boiler-sticker codes for an engineer's member pack
// (20–30 per pack) or a free top-up. Prints each code with the URL its QR
// must encode, as CSV, ready for the printer.
//
//   npx tsx scripts/generate-stickers.ts --engineer <id|slug|email> [--count 25]
//   npx tsx scripts/generate-stickers.ts --engineer daves-heating --count 30 > daves.csv
import "dotenv/config";
import { prisma } from "../lib/db";
import { mintStickers, stickerUrl } from "../lib/stickers";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const who = arg("engineer");
  const count = Number.parseInt(arg("count") ?? "25", 10);
  if (!who) throw new Error("Pass --engineer <id|slug|email>.");
  if (!Number.isInteger(count) || count < 1 || count > 500) throw new Error("--count must be 1–500.");

  const engineer = await prisma.engineer.findFirst({
    where: { OR: [{ id: who }, { slug: who }, { email: who.toLowerCase() }] },
    select: { id: true, slug: true, tradingName: true },
  });
  if (!engineer) throw new Error(`No engineer matches "${who}".`);

  const codes = await mintStickers(engineer.id, count);
  console.error(`Minted ${codes.length} stickers for ${engineer.tradingName ?? engineer.slug} (${engineer.id}).`);
  console.log("code,url");
  for (const code of codes) console.log(`${code},${stickerUrl(code)}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
