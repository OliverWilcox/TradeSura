import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";

// Small builders for test rows. Every value is fictional.

let n = 0;
const next = () => ++n;

export async function makeEngineer(data: Partial<Prisma.EngineerUncheckedCreateInput> = {}) {
  const i = next();
  return prisma.engineer.create({
    data: {
      email: `engineer${i}@example.test`,
      slug: `engineer-${i}`,
      firstName: "Dave",
      lastName: `Smith${i}`,
      tradingName: `Smith Heating ${i}`,
      phone: `+447700900${String(i).padStart(3, "0")}`,
      gasSafeNo: String(500000 + i),
      postcode: "LS1 4AB",
      createdAt: new Date(Date.UTC(2026, 9, 1, 9, i)),
      ...data,
    },
  });
}

export async function makeCustomer(engineerId: string, data: Partial<Prisma.CustomerUncheckedCreateInput> = {}) {
  const i = next();
  return prisma.customer.create({
    data: {
      engineerId,
      firstName: "Jane",
      lastName: `Doe${i}`,
      phone: `+447700901${String(i).padStart(3, "0")}`,
      email: `customer${i}@example.test`,
      ...data,
    },
  });
}

export async function makePlan(engineerId: string, customerId: string, data: Partial<Prisma.PlanUncheckedCreateInput> = {}) {
  const i = next();
  return prisma.plan.create({
    data: {
      ref: `TS-P${i}`,
      engineerId,
      customerId,
      signupToken: `signup-${i}`,
      portalToken: `portal-${i}`,
      status: "ACTIVE",
      priceMonthlyPence: 1500,
      activatedAt: new Date(Date.UTC(2026, 9, 5)),
      ...data,
    },
  });
}
