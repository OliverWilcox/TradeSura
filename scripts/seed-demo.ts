// Demo data for local development and admin demos: a believable six months
// of TradeSura, every value fictional (faker, en_GB; phone numbers from
// Ofcom's drama range; emails at example.com). Deterministic: the same IDs
// every run, with dates anchored to today.
//
//   npm run db:up && npm run seed:demo -- --reset
//
// Refuses to run against anything but a database on this machine.
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { fakerEN_GB as faker } from "@faker-js/faker";
import { prisma } from "../lib/db";
import { normaliseRegNo } from "../lib/gas-safe";
import { CLAUSE_TEMPLATES, TRADESURA_FEE_RATE } from "../lib/clauses";
import { snapshotTier } from "../lib/plan-tier";
import { EDITABLE_SETTINGS } from "../lib/admin-metrics";
import type { Prisma } from "../lib/generated/prisma/client";

const DAY = 86_400_000;
const NOW = Date.now();
const daysAgo = (d: number) => new Date(NOW - d * DAY);
const after = (base: Date, days: number) => new Date(base.getTime() + days * DAY);

function assertLocal() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL isn't set. Copy .env from the README and run `npm run db:up`.");
  const host = new URL(raw).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(host) || process.env.VERCEL) {
    throw new Error(`Refusing to seed demo data into ${host}: only a database on this machine.`);
  }
}

faker.seed(2026);
const pick = <T>(xs: readonly T[]) => faker.helpers.arrayElement(xs);
const chance = (p: number) => faker.number.float({ min: 0, max: 1 }) < p;
const cuid = () => `c${faker.string.alphanumeric({ length: 24, casing: "lower" })}`;
const token = () => randomBytes(18).toString("base64url");

const BLOB = process.env.DEMO_BLOB_URL ?? "http://127.0.0.1:54321";
const TOWNS = [
  { name: "Huddersfield", slug: "huddersfield", pc: "HD" },
  { name: "Leeds", slug: "leeds", pc: "LS" },
  { name: "Bradford", slug: "bradford", pc: "BD" },
  { name: "Halifax", slug: "halifax", pc: "HX" },
  { name: "Wakefield", slug: "wakefield", pc: "WF" },
  { name: "Harrogate", slug: "harrogate", pc: "HG" },
  { name: "York", slug: "york", pc: "YO" },
  { name: "Sheffield", slug: "sheffield", pc: "S" },
] as const;
const CHANNELS = ["letter", "letter", "letter", "engineer", "engineer", "online", "online", "email", "other"] as const;
const LETTER_BATCHES = ["2026-05-A", "2026-07-A", "2026-09-A"];
const BOILERS = [
  ["Worcester Bosch", "Greenstar 30i"],
  ["Vaillant", "ecoTEC plus 832"],
  ["Ideal", "Logic Combi 30"],
  ["Baxi", "800 Combi"],
  ["Viessmann", "Vitodens 050-W"],
] as const;
const TIER_SHAPES = [
  { name: "Boiler care", price: [1200, 1500], codes: ["ANNUAL_SERVICE", "HEALTH_CHECK"] },
  { name: "Boiler & heating", price: [1700, 2200], codes: ["ANNUAL_SERVICE", "HEALTH_CHECK", "RADIATOR_BALANCE"] },
  { name: "Complete home", price: [2600, 3500], codes: ["ANNUAL_SERVICE", "HEALTH_CHECK", "RADIATOR_BALANCE", "GAS_FIRE_SERVICE"] },
];

function postcode(prefix: string) {
  return `${prefix}${faker.number.int({ min: 1, max: 9 })} ${faker.number.int({ min: 1, max: 9 })}${faker.string.alpha({ length: 2, casing: "upper", exclude: ["C", "I", "K", "M", "O", "V"] })}`;
}

async function reset() {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"public"."${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

/** The sample register (data/gas_safe.csv), as `npm run import:gas-safe` loads it. Some tests read it. */
async function seedSampleRegister() {
  const rows: Record<string, string>[] = parse(readFileSync("data/gas_safe.csv", "utf8"), { columns: true, skip_empty_lines: true, trim: true });
  for (const row of rows) {
    const regNo = normaliseRegNo(row.reg_no ?? "");
    if (!regNo) continue;
    const data = { name: row.name ?? "", company: row.company ?? "", categories: row.categories ?? "" };
    await prisma.gasSafeRecord.upsert({ where: { regNo }, update: data, create: { regNo, ...data } });
  }
}

async function seedLibrary() {
  await seedSampleRegister();
  for (const [i, c] of CLAUSE_TEMPLATES.entries()) {
    const row = {
      title: c.title,
      bodyText: c.bodyText,
      kind: c.kind,
      status: c.status,
      category: c.category,
      upliftPence: c.upliftPence,
      pricingLabel: c.pricingLabel ?? null,
      highlight: c.highlight ?? false,
      note: c.note ?? null,
      engineerNote: c.engineerNote ?? null,
      sortOrder: i,
    };
    await prisma.clauseTemplate.upsert({ where: { code: c.code }, update: row, create: { code: c.code, ...row } });
  }
  for (const s of EDITABLE_SETTINGS) {
    await prisma.appSetting.upsert({ where: { key: s.key }, update: {}, create: { key: s.key, value: String(s.fallback) } });
  }
  return new Map((await prisma.clauseTemplate.findMany()).map((c) => [c.code, c]));
}

type EngineerPlan = {
  id: string;
  createdAt: Date;
  verifiedAt: Date | null;
  paymentsAt: Date | null;
  town: (typeof TOWNS)[number];
  firstName: string;
  lastName: string;
  phoneIndex: number;
};

async function main() {
  assertLocal();
  if (process.argv.includes("--reset")) {
    await reset();
    console.log("Emptied every table.");
  } else if (await prisma.engineer.count()) {
    throw new Error("This database already has engineers. Run with --reset to replace everything with demo data.");
  }

  const library = await seedLibrary();
  const engineers: Prisma.EngineerCreateManyInput[] = [];
  const gasSafe: Prisma.GasSafeRecordCreateManyInput[] = [];
  const events: Prisma.EventCreateManyInput[] = [];
  const claimCodes: Prisma.ClaimCodeCreateManyInput[] = [];
  const active: EngineerPlan[] = [];
  const verifiedSoFar: { id: string; createdAt: Date }[] = [];
  let phone = 0;
  // Seven digits, clear of the six-digit sample register in data/gas_safe.csv.
  let regNo = 3_100_000;

  // --- Engineers: ~150 owners, faster growth recently ---------------------
  const OWNERS = 150;
  const ages = Array.from({ length: OWNERS }, () => Math.floor(182 * Math.pow(faker.number.float({ min: 0, max: 1 }), 1.8))).sort((a, b) => b - a);
  for (const [i, age] of ages.entries()) {
    const id = cuid();
    // Some time on that day, but never later than an hour ago.
    const createdAt = new Date(Math.min(after(daysAgo(age), faker.number.float({ min: 0.3, max: 0.9 })).getTime(), NOW - 3_600_000 * faker.number.float({ min: 1, max: 20 })));
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const town = pick(TOWNS);
    const businessType = chance(0.35) ? "ltd" : chance(0.08) ? "partnership" : "sole_trader";
    const trading = chance(0.5) ? `${lastName} Heating` : chance(0.5) ? `${town.name} Gas & Plumbing` : `${firstName} ${lastName} Boilers`;
    const channel = pick(CHANNELS);
    const recent = age <= 9;
    const submitted = recent ? chance(0.85) : chance(0.97);
    const rejected = submitted && !recent && chance(0.04);
    const verified = submitted && !rejected && !recent;
    const verifiedAt = verified ? after(createdAt, faker.number.float({ min: 0.2, max: 3 })) : null;
    const charges = verified && chance(0.88);
    const needsInfo = verified && !charges && chance(0.4);
    const paymentsAt = charges ? after(verifiedAt!, faker.number.float({ min: 0.2, max: 5 })) : null;
    const number = submitted ? String(regNo++) : null;
    const attribution: Record<string, string> = { heardVia: channel };
    let referrerId: string | null = null;
    if (channel === "letter") {
      const sentBefore = LETTER_BATCHES.filter((b) => new Date(`${b.slice(0, 7)}-01`).getTime() < createdAt.getTime());
      const batch = sentBefore.length ? pick(sentBefore) : null;
      if (batch) {
        const code = `TS-${faker.string.numeric(5)}`;
        attribution.letterBatch = batch;
        attribution.referralCode = code;
        claimCodes.push({ code, firstName, businessName: trading, letterBatch: batch, variantCell: pick(["A", "B", "C", "D"]), redeemedByEngineerId: id, redeemedAt: createdAt });
      }
    }
    if (channel === "engineer") {
      const earlier = verifiedSoFar.filter((v) => v.createdAt < createdAt);
      if (earlier.length) referrerId = pick(earlier).id;
    }
    if (number) {
      const onRegister = chance(0.9);
      if (onRegister) {
        const mismatch = chance(0.06);
        gasSafe.push({
          regNo: number,
          name: `${(mismatch ? faker.person.firstName() : firstName)[0]}. ${mismatch ? faker.person.lastName() : lastName}`,
          company: trading,
          categories: chance(0.3) ? "Domestic: boilers, gas fires, cookers" : "Domestic: boilers",
        });
      }
    }
    const packRequested = verified && chance(0.65);
    engineers.push({
      id,
      email: `${firstName}.${lastName}.${i}`.toLowerCase().replace(/[^a-z0-9.]/g, "") + "@example.com",
      slug: `${trading}-${i}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      firstName,
      lastName,
      phone: `+447700900${String(phone++).padStart(3, "0")}`,
      phoneVerifiedAt: createdAt,
      emailVerifiedAt: createdAt,
      tradingName: trading,
      legalName: businessType === "ltd" ? `${trading.toUpperCase()} LTD` : null,
      businessType,
      companyNumber: businessType === "ltd" ? faker.string.numeric(8) : null,
      companyStatus: businessType === "ltd" ? (recent && chance(0.15) ? "dissolved" : "active") : null,
      postcode: postcode(town.pc),
      town: town.name,
      townSlug: town.slug,
      marketingConsent: chance(0.6),
      gasSafeNo: number,
      gasSafeCardUrl: submitted && chance(0.92) ? `${BLOB}/gas-safe-cards/sample-card-${pick(["a", "b", "c"])}.svg` : null,
      gasSafeReviewRequestedAt: submitted && chance(0.05) ? createdAt : null,
      gasSafeVerifiedAt: verifiedAt,
      gasSafeRejectedAt: rejected ? after(createdAt, 1.5) : null,
      gasSafeRejectReason: rejected ? pick(["Name on the card doesn't match the register", "Card photo is unreadable", "Licence has expired"]) : null,
      qualificationConfirmations: chance(0.15) ? { [pick(["GAS_FIRE_SERVICE", "UNVENTED_CYLINDER"])]: after(createdAt, 1).toISOString() } : undefined,
      stripeAccountId: charges || needsInfo ? `acct_demo${faker.string.alphanumeric({ length: 10 })}` : null,
      stripeDetailsSubmitted: charges || needsInfo,
      stripeChargesEnabled: charges,
      stripePayoutsEnabled: charges,
      attribution,
      referrerId,
      packAddress: packRequested ? `${faker.location.streetAddress()}\n${town.name}\n${postcode(town.pc)}` : null,
      packRequestedAt: packRequested ? after(verifiedAt!, 0.5) : null,
      packShippedAt: packRequested && age > 20 && chance(0.85) ? after(verifiedAt!, faker.number.float({ min: 2, max: 8 })) : null,
      profilePublishedAt: verified && chance(0.45) ? after(verifiedAt!, 3) : null,
      profileBio: verified ? `Gas Safe registered engineer covering ${town.name} and nearby. Boiler servicing, repairs and installs.` : null,
      serviceArea: `${town.name} and surrounding areas`,
      websiteConnectedAt: verified && chance(0.1) ? after(verifiedAt!, 10) : null,
      websiteHost: null,
      vatRegistered: businessType === "ltd" && chance(0.5),
      createdAt,
    });
    if (verified) verifiedSoFar.push({ id, createdAt });
    if (verifiedAt) events.push({ name: "gas_safe_verified", actorType: "SYSTEM", actorId: null, ts: verifiedAt, meta: { engineerId: id, via: "admin_review" } });
    if (rejected) events.push({ name: "gas_safe_rejected", actorType: "SYSTEM", actorId: null, ts: after(createdAt, 1.5), meta: { engineerId: id } });
    if (paymentsAt) {
      events.push({ name: "stripe_onboarded", actorType: "ENGINEER", actorId: id, ts: paymentsAt, meta: { accountId: "acct_demo" } });
      active.push({ id, createdAt, verifiedAt, paymentsAt, town, firstName, lastName, phoneIndex: i });
    }
  }

  // Two waiting applications that share a company number with a verified
  // account, so the queue's "Flagged duplicates" tab has something in it.
  const verifiedLtd = engineers.filter((e) => e.gasSafeVerifiedAt && e.businessType === "ltd");
  const waitingLtd = engineers.filter((e) => e.gasSafeNo && !e.gasSafeVerifiedAt && !e.gasSafeRejectedAt && e.businessType === "ltd");
  for (const [i, applicant] of waitingLtd.slice(0, 2).entries()) {
    if (verifiedLtd[i]) applicant.companyNumber = verifiedLtd[i].companyNumber;
  }

  // A few accounts in each standing, so every admin filter has rows.
  const verifiedRows = engineers.filter((e) => e.gasSafeVerifiedAt);
  const [toPause1, toPause2, toBan, toLeave] = faker.helpers.shuffle(verifiedRows).slice(0, 4);
  Object.assign(toPause1, { pausedAt: daysAgo(6), pauseReason: "Customer complaint under review" });
  Object.assign(toPause2, { pausedAt: daysAgo(2), pauseReason: "Stripe flagged unusual refunds" });
  Object.assign(toBan, { bannedAt: daysAgo(20), banReason: "Signed up customers without their agreement" });
  Object.assign(toLeave, { leftAt: daysAgo(12) });

  // Referrers are linked once every row exists (the column points at Engineer).
  await prisma.engineer.createMany({ data: engineers.map((e) => ({ ...e, referrerId: null })) });
  for (const e of engineers.filter((x) => x.referrerId)) {
    await prisma.engineer.update({ where: { id: e.id! }, data: { referrerId: e.referrerId } });
  }
  await prisma.gasSafeRecord.createMany({ data: gasSafe, skipDuplicates: true });

  // Staff on some company accounts (Build Review 2, section 8).
  const staffRows: Prisma.EngineerCreateManyInput[] = [];
  for (const owner of faker.helpers.shuffle(engineers.filter((e) => e.businessType === "ltd" && e.gasSafeVerifiedAt)).slice(0, 10)) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const createdAt = after(owner.gasSafeVerifiedAt as Date, faker.number.float({ min: 3, max: 30 }));
    if (createdAt.getTime() > NOW) continue;
    staffRows.push({
      id: cuid(),
      email: `${firstName}.${lastName}.staff${staffRows.length}`.toLowerCase().replace(/[^a-z0-9.]/g, "") + "@example.com",
      slug: `staff-${staffRows.length}-${lastName}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      firstName,
      lastName,
      phone: `+447700900${String(phone++).padStart(3, "0")}`,
      ownerId: owner.id,
      gasSafeNo: String(regNo++),
      gasSafeVerifiedAt: after(createdAt, 1),
      createdAt,
    });
  }
  await prisma.engineer.createMany({ data: staffRows });

  // --- Plans, customers, homes ---------------------------------------------
  const tiers: Prisma.PlanTierCreateManyInput[] = [];
  const tierClauses: Prisma.TierClauseCreateManyInput[] = [];
  const customers: Prisma.CustomerCreateManyInput[] = [];
  const properties: Prisma.PropertyCreateManyInput[] = [];
  const appliances: Prisma.ApplianceCreateManyInput[] = [];
  const plans: Prisma.PlanCreateManyInput[] = [];
  const cancels: Prisma.CancelRequestCreateManyInput[] = [];
  const earnings: Prisma.ReferralEarningCreateManyInput[] = [];
  const stripeEvents: Prisma.StripeWebhookEventCreateManyInput[] = [];
  const referrerOf = new Map(engineers.filter((e) => e.referrerId).map((e) => [e.id!, e.referrerId!]));
  let ref = 0;

  for (const eng of active) {
    const liveAt = after(eng.paymentsAt!, faker.number.float({ min: 0.5, max: 6 }));
    // Too recent to have a book of customers yet.
    if (liveAt.getTime() > NOW - DAY / 4) continue;
    const shapes = faker.helpers.shuffle(TIER_SHAPES).slice(0, faker.number.int({ min: 1, max: 3 }));
    const engTiers = shapes.map((s, i) => {
      const id = cuid();
      tiers.push({
        id,
        engineerId: eng.id,
        name: s.name,
        priceMonthlyPence: faker.number.int({ min: s.price[0] / 50, max: s.price[1] / 50 }) * 50,
        isRecommended: i === 0,
        sortOrder: i,
        status: "LIVE",
        providerAttestedAt: liveAt,
      });
      for (const code of s.codes) tierClauses.push({ tierId: id, clauseId: library.get(code)!.id });
      return { id, shape: s };
    });
    events.push({ name: "plan_live", actorType: "ENGINEER", actorId: eng.id, ts: liveAt, meta: { tierId: engTiers[0].id } });

    const weeksLive = (NOW - liveAt.getTime()) / (7 * DAY);
    const book = Math.min(60, Math.round(weeksLive * faker.number.float({ min: 0.4, max: 2.2 })));
    for (let c = 0; c < book; c++) {
      const customerId = cuid();
      const addedAt = new Date(faker.number.int({ min: liveAt.getTime(), max: NOW - DAY / 4 }));
      const firstName = faker.person.firstName();
      const lastName = faker.person.lastName();
      customers.push({
        id: customerId,
        engineerId: eng.id,
        firstName,
        lastName,
        phone: `+447700900${String(c).padStart(3, "0")}`,
        email: chance(0.8) ? `${firstName}.${lastName}.${customerId.slice(1, 6)}`.toLowerCase().replace(/[^a-z0-9.]/g, "") + "@example.com" : null,
        source: pick(["added", "added", "doorstep", "web", "import"]),
        createdAt: addedAt,
      });
      const propertyId = cuid();
      properties.push({ id: propertyId, customerId, addressLine1: faker.location.streetAddress(), town: eng.town.name, postcode: postcode(eng.town.pc) });
      const [make, model] = pick(BOILERS);
      appliances.push({ id: cuid(), propertyId, make, model, type: "boiler", installedAt: daysAgo(faker.number.int({ min: 400, max: 4000 })), lastServicedAt: daysAgo(faker.number.int({ min: 20, max: 360 })) });
      if (chance(0.12)) continue; // on the book, never offered a plan

      const tier = pick(engTiers);
      const tierRow = tiers.find((t) => t.id === tier.id)!;
      const offeredAt = new Date(Math.min(after(addedAt, faker.number.float({ min: 0, max: 2 })).getTime(), NOW - 3_600_000));
      const recentOffer = NOW - offeredAt.getTime() < 6 * DAY;
      const drawn = recentOffer && chance(0.55) ? "PENDING" : chance(0.08) ? "PENDING" : chance(0.12) ? "CANCELLED" : chance(0.04) ? "PAUSED" : "ACTIVE";
      const activatedAt = drawn === "PENDING" ? null : after(offeredAt, faker.number.float({ min: 0.05, max: 4 }));
      if (activatedAt && activatedAt.getTime() > NOW) continue;
      // A plan started less than a day ago hasn't had time to be cancelled.
      const outcome = drawn === "CANCELLED" && activatedAt!.getTime() + DAY >= NOW ? "ACTIVE" : drawn;
      const monthsPaid = activatedAt ? Math.max(0, Math.floor((NOW - activatedAt.getTime() - 14 * DAY) / (30 * DAY))) : 0;
      const cancelledAt = outcome === "CANCELLED" ? new Date(faker.number.int({ min: activatedAt!.getTime() + DAY, max: NOW })) : null;
      const failed = outcome === "ACTIVE" && monthsPaid > 0 && chance(0.05);
      const planId = cuid();
      const clauses = tier.shape.codes.map((code) => ({ clause: library.get(code)! }));
      plans.push({
        id: planId,
        ref: `TS-${(++ref).toString(36).toUpperCase().padStart(5, "0")}`,
        engineerId: eng.id,
        customerId,
        tierId: tier.id,
        status: outcome,
        priceMonthlyPence: tierRow.priceMonthlyPence,
        signupToken: token(),
        portalToken: token(),
        linkOpenedAt: outcome === "PENDING" && chance(0.5) ? after(offeredAt, 0.2) : activatedAt,
        mandateStatus: activatedAt ? (cancelledAt ? "inactive" : "active") : null,
        stripeSubscriptionId: activatedAt ? `sub_demo_${planId.slice(1, 15)}` : null,
        stripeCustomerId: activatedAt ? `cus_demo_${customerId.slice(1, 15)}` : null,
        coolingOffEndsAt: activatedAt ? after(activatedAt, 14) : null,
        activatedAt,
        serviceStartsAt: activatedAt && monthsPaid > 0 ? after(activatedAt, 15) : null,
        paymentsCleared: monthsPaid,
        cancelledAt,
        paymentFailedAt: failed ? daysAgo(faker.number.int({ min: 1, max: 25 })) : null,
        paymentRecoveredAt: failed && chance(0.5) ? daysAgo(faker.number.int({ min: 0, max: 1 })) : null,
        pausedUntil: outcome === "PAUSED" ? after(new Date(NOW), faker.number.int({ min: 10, max: 60 })) : null,
        termsVersion: activatedAt ? "2026-10" : null,
        termsAgreedAt: activatedAt,
        billingInterval: chance(0.15) ? "year" : "month",
        agreedTier: activatedAt ? snapshotTier({ name: tierRow.name, isRecommended: Boolean(tierRow.isRecommended), clauses }) : undefined,
        createdAt: offeredAt,
      });
      events.push({ name: "offer_sent", actorType: "ENGINEER", actorId: eng.id, ts: offeredAt, meta: { planId, customerId } });
      if (activatedAt && monthsPaid > 0) {
        events.push({ name: "payment_confirmed", actorType: "SYSTEM", actorId: null, ts: after(activatedAt, 15), meta: { planId, engineerId: eng.id } });
        // Each paid month as the webhook stores it (StripeWebhookEvent), the admin's collections source.
        // Paid 15 days after starting (after cooling-off), then every 30 days until today or the cancellation.
        const until = (cancelledAt ?? new Date(NOW)).getTime();
        for (let m = 0; ; m++) {
          const paidAt = after(activatedAt, 15 + 30 * m);
          if (paidAt.getTime() > until) break;
          const invoiceId = `in_demo_${planId.slice(1, 13)}_${m}`;
          stripeEvents.push({
            id: `evt_demo_${planId.slice(1, 13)}_${m}`,
            type: "invoice.paid",
            processedAt: paidAt,
            payload: {
              id: `evt_demo_${planId.slice(1, 13)}_${m}`,
              type: "invoice.paid",
              data: {
                object: {
                  id: invoiceId,
                  amount_paid: tierRow.priceMonthlyPence,
                  application_fee_amount: Math.floor(tierRow.priceMonthlyPence * TRADESURA_FEE_RATE),
                  status_transitions: { paid_at: Math.floor(paidAt.getTime() / 1000) },
                  parent: { subscription_details: { subscription: `sub_demo_${planId.slice(1, 15)}` } },
                  metadata: { planId },
                },
              },
            },
          });
        }
      }
      if (cancelledAt) {
        cancels.push({ planId, engineerId: eng.id, reason: pick(["too_expensive", "moving", "not_using", "unhappy", "other"]), offer: pick(["cheaper_plan", "move_plan", "show_value", "pause"]), outcome: "cancelled", createdAt: after(cancelledAt, -2), resolvedAt: cancelledAt });
      } else if (outcome === "ACTIVE" && chance(0.02)) {
        cancels.push({ planId, engineerId: eng.id, reason: pick(["too_expensive", "moving"]), outcome: "pending", createdAt: daysAgo(1) });
      }
      const referrer = referrerOf.get(eng.id);
      if (referrer && monthsPaid > 0) {
        for (let m = 0; m < Math.min(monthsPaid, 4); m++) {
          const fee = Math.floor(tierRow.priceMonthlyPence * TRADESURA_FEE_RATE);
          earnings.push({ referrerId: referrer, inviteeId: eng.id, invoiceId: `in_demo_${planId}_${m}`, feePence: fee, ratePercent: 25, amountPence: Math.floor(fee * 0.25), createdAt: after(activatedAt!, 15 + 30 * m) });
        }
      }
    }
  }

  await prisma.planTier.createMany({ data: tiers });
  await prisma.tierClause.createMany({ data: tierClauses });
  for (let i = 0; i < customers.length; i += 1000) await prisma.customer.createMany({ data: customers.slice(i, i + 1000) });
  for (let i = 0; i < properties.length; i += 1000) await prisma.property.createMany({ data: properties.slice(i, i + 1000) });
  for (let i = 0; i < appliances.length; i += 1000) await prisma.appliance.createMany({ data: appliances.slice(i, i + 1000) });
  for (let i = 0; i < plans.length; i += 500) await prisma.plan.createMany({ data: plans.slice(i, i + 500) });
  // Weekly Friday payouts to each engineer's bank (payout.paid, as the
  // Connect webhook stores it): what their customers paid that week, less
  // TradeSura's fee.
  const accountOf = new Map(engineers.filter((e) => e.stripeAccountId).map((e) => [e.id!, e.stripeAccountId!]));
  const weekly = new Map<string, number>();
  for (const ev of stripeEvents) {
    const obj = (ev.payload as { data: { object: { amount_paid: number; application_fee_amount: number; status_transitions: { paid_at: number }; metadata: { planId: string } } } }).data.object;
    const plan = plans.find((p) => p.id === obj.metadata.planId);
    if (!plan || !accountOf.has(plan.engineerId)) continue;
    const paid = new Date(obj.status_transitions.paid_at * 1000);
    const friday = new Date(paid);
    friday.setUTCDate(paid.getUTCDate() + ((5 - paid.getUTCDay() + 7) % 7 || 7));
    const key = `${plan.engineerId}|${friday.toISOString().slice(0, 10)}`;
    weekly.set(key, (weekly.get(key) ?? 0) + obj.amount_paid - obj.application_fee_amount);
  }
  for (const [key, amount] of weekly) {
    const [engineerId, day] = key.split("|");
    const at = new Date(`${day}T10:00:00Z`);
    if (at.getTime() > NOW) continue;
    const id = `evt_demo_po_${engineerId.slice(1, 9)}_${day}`;
    stripeEvents.push({ id, type: "payout.paid", processedAt: at, payload: { id, type: "payout.paid", account: accountOf.get(engineerId), data: { object: { id: `po_demo_${engineerId.slice(1, 9)}_${day.replace(/-/g, "")}`, amount, arrival_date: Math.floor(at.getTime() / 1000), status: "paid" } } } });
  }

  await prisma.cancelRequest.createMany({ data: cancels });
  await prisma.referralEarning.createMany({ data: earnings });
  for (let i = 0; i < stripeEvents.length; i += 1000) await prisma.stripeWebhookEvent.createMany({ data: stripeEvents.slice(i, i + 1000) });

  // --- Letters, towns, ratings, enquiries -----------------------------------
  for (const batch of LETTER_BATCHES) {
    for (let i = 0; i < 120; i++) {
      claimCodes.push({ code: `TS-${faker.string.numeric(5)}`, firstName: faker.person.firstName(), businessName: `${faker.person.lastName()} Heating`, letterBatch: batch, variantCell: pick(["A", "B", "C", "D"]), suppressedAt: chance(0.02) ? new Date() : null });
    }
  }
  await prisma.claimCode.createMany({ data: claimCodes, skipDuplicates: true });
  await prisma.townPage.createMany({ data: TOWNS.map((t) => ({ slug: t.slug, name: t.name, publishedAt: daysAgo(60) })) });

  const rated = faker.helpers.shuffle(plans.filter((p) => p.status === "ACTIVE" && (p.paymentsCleared ?? 0) >= 3)).slice(0, 140);
  for (const p of rated) {
    const property = properties.find((x) => x.customerId === p.customerId)!;
    const passport = await prisma.homePassport.create({
      data: { addressKey: `${property.postcode.replace(/\s/g, "")}|${property.addressLine1.toLowerCase()}|${p.id}`, addressLine1: property.addressLine1, town: property.town, postcode: property.postcode, viewToken: token() },
    });
    await prisma.property.update({ where: { id: property.id }, data: { passportId: passport.id } });
    const doneAt = daysAgo(faker.number.int({ min: 2, max: 60 }));
    const record = await prisma.serviceRecord.create({ data: { passportId: passport.id, engineerId: p.engineerId, planId: p.id, kind: "service", doneAt, notes: "Annual service, flue gas analysis within limits." } });
    const stars = pick([5, 5, 5, 5, 4, 4, 3, 2]);
    const customer = customers.find((c) => c.id === p.customerId)!;
    await prisma.rating.create({
      data: {
        engineerId: p.engineerId,
        planId: p.id!,
        serviceRecordId: record.id,
        requestToken: token(),
        stars,
        comment: stars >= 4 ? pick(["On time and tidy.", "Explained everything clearly.", "Really pleased with the service.", "Quick and friendly."]) : pick(["Arrived later than the slot.", "Had to chase for the certificate."]),
        customerName: `${customer.firstName} ${customer.lastName[0]}.`,
        ratedAt: after(doneAt, 1),
        removedAt: stars === 2 && chance(0.3) ? daysAgo(1) : null,
        removedReason: null,
      },
    });
  }
  const published = engineers.filter((e) => e.profilePublishedAt);
  const enquiries: Prisma.EnquiryCreateManyInput[] = [];
  for (const e of published) {
    for (let i = faker.number.int({ min: 0, max: 6 }); i > 0; i--) {
      enquiries.push({ engineerId: e.id!, kind: pick(["call", "message"]), name: faker.person.firstName(), message: chance(0.5) ? "Could you quote for a boiler service next month?" : null, source: pick(["profile", "town", "widget"]), createdAt: daysAgo(faker.number.int({ min: 0, max: 40 })) });
    }
  }
  await prisma.enquiry.createMany({ data: enquiries });
  for (let i = 0; i < events.length; i += 2000) await prisma.event.createMany({ data: events.slice(i, i + 2000) });

  const counts = {
    engineers: await prisma.engineer.count(),
    waitingForVerification: await prisma.engineer.count({ where: { gasSafeNo: { not: null }, gasSafeVerifiedAt: null, gasSafeRejectedAt: null } }),
    customers: await prisma.customer.count(),
    plans: await prisma.plan.count(),
    livePlans: await prisma.plan.count({ where: { status: "ACTIVE" } }),
    ratings: await prisma.rating.count(),
    paidInvoices: await prisma.stripeWebhookEvent.count({ where: { type: "invoice.paid" } }),
    events: await prisma.event.count(),
  };
  console.log("Demo data ready:", counts);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await prisma.$disconnect();
    process.exit(1);
  });
