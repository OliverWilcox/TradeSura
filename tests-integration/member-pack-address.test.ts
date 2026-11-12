import { beforeEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { GET as list } from "@/app/api/admin/v1/member-packs/route";
import { call, resetDb } from "./helpers";
import { makeEngineer } from "./factories";

// 6.1: 302 MD LTD's pack would have gone to its registered office (Gateway
// Tower, London), the address it gave at sign-up, not where it trades.

const companies = vi.hoisted(() => ({ answers: true }));
vi.mock("@/lib/admin/companies", () => ({
  companyProfile: async () =>
    companies.answers ? { number: "12345678", name: "302 MD LTD", type: "ltd", status: "active", registeredOffice: "Gateway Tower 32 Western Gateway, London, E16 1YL" } : null,
}));

beforeEach(async () => {
  companies.answers = true;
  await resetDb();
});

const ltd = { businessType: "ltd", companyNumber: "12345678", gasSafeVerifiedAt: new Date(), gasSafeRegisterCheckedAt: new Date(), packRequestedAt: new Date() };
const checks = async () => Object.fromEntries((await call(list)).body.items.map((i: { id: string; addressCheck: string }) => [i.id, i.addressCheck]));

it("blocks a limited company's pack addressed to its registered office", async () => {
  const office = await makeEngineer({ ...ltd, packAddress: "Gateway Tower\n32 Western Gateway\nLondon\nE16 1YL" });
  const trading = await makeEngineer({ ...ltd, packAddress: "Unit 2, Station Road\nHolmfirth\nHD9 2TT" });
  expect(await checks()).toEqual({ [office.id]: "registered_office", [trading.id]: "ok" });
});

it("keeps a company's pack unchecked when Companies House can't be asked, until someone confirms the address (QA-06)", async () => {
  companies.answers = false;
  const signup = await makeEngineer({ ...ltd, packAddress: "Unit 2, Station Road\nHolmfirth\nHD9 2TT" });
  const soleTrader = await makeEngineer({ ...ltd, businessType: "sole_trader", companyNumber: null, packAddress: "3 Mill Lane\nLeeds\nLS1 4AB" });
  const none = await makeEngineer({ ...ltd, packAddress: null });
  expect(await checks()).toEqual({ [signup.id]: "unchecked", [soleTrader.id]: "ok", [none.id]: "missing" });

  // Confirmed by an admin (or the engineer) with Edit addresses: it goes where they said, even to the registered office.
  await prisma.engineerTradingAddress.create({ data: { engineerId: signup.id, lines: ["Unit 2, Station Road"], town: "Holmfirth", postcode: "HD9 2TT", source: "admin" } });
  companies.answers = true;
  const office = await makeEngineer({ ...ltd, packAddress: "Gateway Tower\n32 Western Gateway\nLondon\nE16 1YL" });
  await prisma.engineerTradingAddress.create({ data: { engineerId: office.id, lines: ["Gateway Tower", "32 Western Gateway"], town: "London", postcode: "E16 1YL", source: "engineer" } });
  // Copied from sign-up by the script: not a confirmation.
  const copied = await makeEngineer({ ...ltd, packAddress: "Gateway Tower\n32 Western Gateway\nLondon\nE16 1YL" });
  await prisma.engineerTradingAddress.create({ data: { engineerId: copied.id, lines: ["Gateway Tower"], town: "London", postcode: "E16 1YL", source: "signup" } });
  expect(await checks()).toMatchObject({ [signup.id]: "ok", [office.id]: "ok", [copied.id]: "registered_office" });
});

it("counts the packs matching the search that won't print, past the page, only when asked (QA-23)", async () => {
  companies.answers = false;
  await makeEngineer({ ...ltd, tradingName: "Holme Heating", packAddress: "Unit 2, Station Road\nHolmfirth\nHD9 2TT" });
  await makeEngineer({ ...ltd, tradingName: "Holme Gas", packAddress: null });
  const printable = await makeEngineer({ ...ltd, tradingName: "Holme Boilers", businessType: "sole_trader", companyNumber: null, packAddress: "3 Mill Lane\nLeeds\nLS1 4AB" });
  const plan = await prisma.planTier.create({ data: { engineerId: printable.id, name: "Boiler Care", priceMonthlyPence: 1250, sortOrder: 0, status: "LIVE" } });
  await makeEngineer({ ...ltd, tradingName: "Leeds Plumbing", packAddress: null });

  const asked = await call(list, { query: { count: "wont_print", q: "Holme", size: "1" } });
  expect(asked.body).toMatchObject({ total: 3, wontPrint: 2 });
  // No live plan for the cover letter's lines: that won't print either (Matt, 4 Nov).
  await prisma.planTier.update({ where: { id: plan.id }, data: { status: "STOPPED" } });
  expect((await call(list, { query: { count: "wont_print", q: "Holme" } })).body.wontPrint).toBe(3);
  await prisma.planTier.update({ where: { id: plan.id }, data: { status: "LIVE" } });
  expect(asked.body.items).toHaveLength(1);
  expect((await call(list, { query: { count: "wont_print" } })).body.wontPrint).toBe(3);
  expect((await call(list)).body.wontPrint).toBeNull();
  expect((await call(list, { query: { tab: "held", count: "wont_print" } })).body.wontPrint).toBeNull();
});
