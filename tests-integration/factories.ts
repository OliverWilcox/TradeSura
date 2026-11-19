import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";

// Small builders for test rows. Every value is fictional.

let n = 0;
const next = () => ++n;

export const TEST_CARD_URL = "https://test.public.blob.vercel-storage.com/gas-safe-cards/card.jpg";

const segment = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
export const TEST_CARD_JPEG = Buffer.from([
  0xff, 0xd8,
  ...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
  ...segment(0xdb, [0, ...Array(64).fill(1)]),
  ...segment(0xc0, [8, 0, 16, 0, 16, 1, 1, 0x11, 0]),
  ...segment(0xda, [1, 1, 0, 0, 63, 0]),
  0x12, 0x34,
  0xff, 0xd9,
]).toString("base64");

export async function readCard(engineerId: string, data: Partial<Prisma.GasSafeCardReadUncheckedCreateInput> = {}) {
  const e = await prisma.engineer.findUniqueOrThrow({ where: { id: engineerId }, select: { gasSafeNo: true, firstName: true, lastName: true, gasSafeCardUrl: true, gasSafeRegistrationNo: true } });
  return prisma.gasSafeCardRead.create({
    data: {
      engineerId,
      cardUrl: e.gasSafeCardUrl ?? TEST_CARD_URL,
      source: "automatic",
      outcome: "read",
      complete: true,
      isGasSafeCard: true,
      licenceNo: e.gasSafeNo && /^\d{7}$/.test(e.gasSafeNo) ? e.gasSafeNo : "1234567",
      registrationNo: e.gasSafeRegistrationNo ?? (e.gasSafeNo && /^\d{6}$/.test(e.gasSafeNo) ? e.gasSafeNo : "584123"),
      name: [e.firstName, e.lastName].filter(Boolean).join(" ") || "Test Engineer",
      expiresOn: new Date("2027-06-30T00:00:00Z"),
      categories: [],
      notes: [],
      ...data,
    },
  });
}

export async function makeEngineer(data: Partial<Prisma.EngineerUncheckedCreateInput> = {}, opts: { cardRead?: boolean } = {}) {
  const e = await createEngineer(data);
  if (opts.cardRead ?? Boolean(data.gasSafeVerifiedAt)) {
    const read = await readCard(e.id);
    if (data.gasSafeVerifiedAt) return prisma.engineer.update({ where: { id: e.id }, data: { gasSafeCardReadId: read.id } });
  }
  return e;
}

async function createEngineer(data: Partial<Prisma.EngineerUncheckedCreateInput>) {
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
