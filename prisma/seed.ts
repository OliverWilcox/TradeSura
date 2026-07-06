// Dev seed — faker data only, no real personal data (CLAUDE.md §Compliance 6).
import "dotenv/config";
import { faker } from "@faker-js/faker";
import { prisma } from "../lib/db";
import { CLAUSE_TEMPLATES } from "../lib/clauses";

async function main() {
  for (const c of CLAUSE_TEMPLATES) {
    await prisma.clauseTemplate.upsert({
      where: { code: c.code },
      update: { title: c.title, bodyText: c.bodyText, kind: c.kind, sortOrder: c.sortOrder },
      create: { ...c },
    });
  }
  console.log(`Seeded ${CLAUSE_TEMPLATES.length} clause templates`);

  // A book of no-plan customers for an engineer to import against is created
  // via the CSV import in the demo; here we only add a handful of faker
  // customers for the first engineer if one exists (dashboard has data on
  // first open after onboarding).
  const engineer = await prisma.engineer.findFirst();
  if (engineer) {
    const existing = await prisma.customer.count({ where: { engineerId: engineer.id } });
    if (existing === 0) {
      for (let i = 0; i < 12; i++) {
        await prisma.customer.create({
          data: {
            engineerId: engineer.id,
            firstName: faker.person.firstName(),
            lastName: faker.person.lastName(),
            phone: `+4477${faker.string.numeric(8)}`,
            email: faker.internet.email().toLowerCase(),
            properties: {
              create: {
                addressLine1: `${faker.number.int({ min: 1, max: 140 })} ${faker.location.street()}`,
                town: faker.location.city(),
                postcode: `LS${faker.number.int({ min: 1, max: 28 })} ${faker.number.int({ min: 1, max: 9 })}${faker.string.alpha({ length: 2, casing: "upper" })}`,
                appliances: {
                  create: {
                    make: faker.helpers.arrayElement(["Worcester", "Ideal", "Baxi", "Vaillant"]),
                    model: faker.helpers.arrayElement(["30i", "Logic 30", "630", "ecoTEC plus"]),
                    type: "boiler",
                    lastServicedAt: faker.date.past({ years: 1 }),
                  },
                },
              },
            },
          },
        });
      }
      console.log("Seeded 12 faker customers for", engineer.slug);
    }
  }
}

main().then(() => process.exit(0));
