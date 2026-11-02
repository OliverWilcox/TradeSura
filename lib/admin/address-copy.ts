import { prisma } from "@/lib/db";
import { parseAddress, postcodeOf, type PostalAddress } from "@/lib/addresses";
import { companyProfile } from "@/lib/admin/companies";
import { townSlugOf } from "@/lib/town";

// Copying the addresses engineers gave before trading addresses were kept
// (scripts/admin-copy-addresses.ts). Each owner without one gets their pack
// address as their trading address, which is what sign-up asked for, unless:
// - it can't be split into street, town and postcode;
// - it's a limited company's registered office (302 MD LTD), or Companies
//   House couldn't be asked: the engineer has to give their trading address;
// - its town isn't the town their profile already uses, which an admin
//   decides (moving it moves their town page).
// An empty town is filled from the address. Postcode and pack address are
// left as they are.

export type CopyStep =
  | { id: string; name: string; action: "copy"; address: PostalAddress; fillsTown: boolean }
  | { id: string; name: string; action: "skip"; why: string };

export async function planAddressCopy(): Promise<CopyStep[]> {
  const rows = await prisma.engineer.findMany({
    where: { ownerId: null, deletedAt: null, id: { notIn: (await prisma.engineerTradingAddress.findMany({ select: { engineerId: true } })).map((r) => r.engineerId) } },
    select: { id: true, tradingName: true, legalName: true, slug: true, businessType: true, companyNumber: true, packAddress: true, town: true },
    orderBy: { createdAt: "asc" },
  });
  const steps: CopyStep[] = [];
  for (const e of rows) {
    const name = e.tradingName ?? e.legalName ?? e.slug;
    const address = parseAddress(e.packAddress);
    if (!address) {
      steps.push({ id: e.id, name, action: "skip", why: e.packAddress ? "the pack address can't be split into street, town and postcode" : "no address given" });
      continue;
    }
    if (e.businessType === "ltd" && e.companyNumber) {
      const profile = await companyProfile(e.companyNumber);
      if (!profile) {
        steps.push({ id: e.id, name, action: "skip", why: "Companies House couldn't be checked for the registered office" });
        continue;
      }
      if (postcodeOf(profile.registeredOffice) === postcodeOf(address.postcode)) {
        steps.push({ id: e.id, name, action: "skip", why: `it's the registered office (${profile.registeredOffice}): ask the engineer for their trading address` });
        continue;
      }
    }
    if (e.town && townSlugOf(e.town) !== townSlugOf(address.town)) {
      steps.push({ id: e.id, name, action: "skip", why: `its town (${address.town}) isn't their profile's town (${e.town}): an admin decides` });
      continue;
    }
    steps.push({ id: e.id, name, action: "copy", address, fillsTown: !e.town });
  }
  return steps;
}

/** Writes the copies a plan holds; an engineer who's since been given a trading address is left alone. */
export async function applyAddressCopy(steps: CopyStep[]) {
  let copied = 0;
  for (const s of steps) {
    if (s.action !== "copy") continue;
    const slug = townSlugOf(s.address.town);
    const done = await prisma.$transaction(async (tx) => {
      if (await tx.engineerTradingAddress.findUnique({ where: { engineerId: s.id } })) return false;
      await tx.engineerTradingAddress.create({ data: { engineerId: s.id, ...s.address, source: "signup" } });
      if (s.fillsTown) {
        await tx.engineer.updateMany({ where: { id: s.id, town: null }, data: { town: s.address.town, townSlug: slug } });
        await tx.townPage.upsert({ where: { slug }, update: {}, create: { slug, name: s.address.town } });
      }
      return true;
    });
    if (done) copied += 1;
  }
  return { copied };
}
