// Dev-only: create a fresh engineer and print a session token, skipping the
// sign-up email/SMS codes so the plan → offer → Direct Debit loop can be
// walked on React Native Web without a real inbox or phone.
//
//   npx tsx scripts/dev-test-engineer.ts            # badge granted (offers unlocked)
//   npx tsx scripts/dev-test-engineer.ts --unverified
//
// Then in the web app's browser console:
//   localStorage.setItem("ts_engineer_token", "<token>"); location.reload()
//
// Refuses to run against anything but a localhost database — test accounts
// must never land in the shared admin queue.
import "dotenv/config";
import { faker } from "@faker-js/faker";
import { prisma } from "../lib/db";
import { sessionToken } from "../lib/sign-in-code";
import { uniqueSlug } from "../lib/slug";

async function main() {
  const db = process.env.DATABASE_URL ?? "";
  if (process.env.NODE_ENV === "production" || !/@(localhost|127\.0\.0\.1)[:/]/.test(db)) {
    throw new Error("dev-test-engineer only runs against a localhost DATABASE_URL.");
  }
  const verified = !process.argv.includes("--unverified");

  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const tradingName = `${lastName} Heating`;
  const stamp = Date.now().toString().slice(-7);
  const now = new Date();

  const engineer = await prisma.engineer.create({
    data: {
      email: `test+${stamp}@example.com`,
      slug: await uniqueSlug(tradingName),
      firstName,
      lastName,
      phone: `+447700${stamp.slice(-6)}`,
      emailVerifiedAt: now,
      tradingName,
      businessType: "sole_trader",
      postcode: "BN1 1AA",
      gasSafeNo: `9${stamp.slice(-6)}`,
      gasSafeName: `${firstName} ${lastName}`,
      gasSafeVerifiedAt: verified ? now : null,
      attribution: { heardVia: "dev-test" },
    },
  });

  console.log(`Engineer ${engineer.email} (${tradingName}), badge ${verified ? "granted" : "pending"}`);
  console.log(`localStorage.setItem("ts_engineer_token", "${await sessionToken(engineer.id)}"); location.reload()`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
