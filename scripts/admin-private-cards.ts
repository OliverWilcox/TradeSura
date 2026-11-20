import "dotenv/config";
import { del, put } from "@vercel/blob";
import { prisma } from "../lib/db";
import { cleanCardPhoto } from "../lib/gas-safe-card";
import { sniffImage } from "../lib/image-metadata";

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const [key, value = ""] = a.replace(/^--/, "").split("=");
  args.set(key, value);
}

const USAGE = [
  "Gas Safe card photos still in the public Blob store, moved to the private one with their location and camera data removed (a HEIC is moved as it is: ask the engineer for a new photo).",
  "  npx tsx scripts/admin-private-cards.ts                      lists them, changes nothing",
  "  npx tsx scripts/admin-private-cards.ts --apply --host=<db>  copies each to the private store (CARD_BLOB_READ_WRITE_TOKEN), points the records at it and deletes the public copy",
].join("\n");

const OLD_UPLOAD_LIMIT = 8 * 1024 * 1024;

const isPublic = (url: string | null): url is string => Boolean(url && /^https:\/\/[^/]+\.public\.blob\.vercel-storage\.com\//.test(url));

async function publicUrls() {
  const [engineers, reads] = await Promise.all([
    prisma.engineer.findMany({ where: { OR: [{ gasSafeCardUrl: { contains: ".public.blob.vercel-storage.com/" } }, { gasSafeCardBackUrl: { contains: ".public.blob.vercel-storage.com/" } }] }, select: { gasSafeCardUrl: true, gasSafeCardBackUrl: true } }),
    prisma.gasSafeCardRead.findMany({ where: { OR: [{ cardUrl: { contains: ".public.blob.vercel-storage.com/" } }, { backUrl: { contains: ".public.blob.vercel-storage.com/" } }] }, select: { cardUrl: true, backUrl: true } }),
  ]);
  return [...new Set([...engineers.flatMap((e) => [e.gasSafeCardUrl, e.gasSafeCardBackUrl]), ...reads.flatMap((r) => [r.cardUrl, r.backUrl])].filter(isPublic))];
}

async function moveOne(url: string): Promise<string | null> {
  const res = await fetch(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    console.log(`  ${url}: can't be fetched (${res.status}), left as it is`);
    return null;
  }
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const bytes = new Uint8Array(await res.arrayBuffer());
  const heic = sniffImage(bytes) === "image/heic";
  const clean = heic ? { ok: true as const, bytes, type: "image/heic" } : cleanCardPhoto(bytes, type || "image/jpeg", OLD_UPLOAD_LIMIT);
  if (!clean.ok) {
    console.log(`  ${url}: ${clean.error} Left as it is; ask the engineer for a new photo.`);
    return null;
  }
  if (heic) console.log(`  ${url}: a HEIC, moved as it is; ask the engineer for a new photo.`);
  const ext = clean.type === "image/png" ? "png" : clean.type === "image/webp" ? "webp" : clean.type === "image/heic" ? "heic" : "jpg";
  const blob = await put(`gas-safe-cards/card.${ext}`, Buffer.from(clean.bytes), { access: "private", contentType: clean.type, addRandomSuffix: true, token: process.env.CARD_BLOB_READ_WRITE_TOKEN?.trim() });
  await prisma.$transaction([
    prisma.engineer.updateMany({ where: { gasSafeCardUrl: url }, data: { gasSafeCardUrl: blob.url } }),
    prisma.engineer.updateMany({ where: { gasSafeCardBackUrl: url }, data: { gasSafeCardBackUrl: blob.url } }),
    prisma.gasSafeCardRead.updateMany({ where: { cardUrl: url }, data: { cardUrl: blob.url } }),
    prisma.gasSafeCardRead.updateMany({ where: { backUrl: url }, data: { backUrl: blob.url } }),
  ]);
  await del(url);
  return blob.url;
}

async function main() {
  if (args.has("help")) {
    console.log(USAGE);
    return;
  }
  const host = new URL(process.env.DATABASE_URL ?? "postgresql://unset").hostname;
  console.log(`Database: ${host}`);
  const urls = await publicUrls();
  console.log(`${urls.length} card photo(s) in the public store.`);
  if (!args.has("apply")) {
    for (const url of urls) console.log(`  ${url}`);
    console.log(`Dry run: nothing changed.\n${USAGE}`);
    return;
  }
  if (args.get("host") !== host) throw new Error(`Refusing to change anything: --host=${args.get("host") ?? ""} doesn't name this database (${host}).`);
  if (!process.env.CARD_BLOB_READ_WRITE_TOKEN?.trim()) throw new Error("CARD_BLOB_READ_WRITE_TOKEN isn't set: connect the private Blob store first.");
  let moved = 0;
  for (const url of urls) {
    if (await moveOne(url)) moved += 1;
  }
  console.log(`${moved} of ${urls.length} moved.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
