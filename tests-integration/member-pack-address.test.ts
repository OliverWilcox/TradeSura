import { beforeEach, expect, it, vi } from "vitest";
import { GET as list } from "@/app/api/admin/v1/member-packs/route";
import { call, resetDb } from "./helpers";
import { makeEngineer } from "./factories";

// 6.1: 302 MD LTD's pack would have gone to its registered office (Gateway
// Tower, London), the address it gave at sign-up, not where it trades.

vi.mock("@/lib/admin/companies", () => ({
  companyProfile: async () => ({ number: "12345678", name: "302 MD LTD", type: "ltd", status: "active", registeredOffice: "Gateway Tower 32 Western Gateway, London, E16 1YL" }),
}));

beforeEach(resetDb);

it("blocks a limited company's pack addressed to its registered office", async () => {
  const ltd = { businessType: "ltd", companyNumber: "12345678", gasSafeVerifiedAt: new Date(), packRequestedAt: new Date() };
  const office = await makeEngineer({ ...ltd, packAddress: "Gateway Tower\n32 Western Gateway\nLondon\nE16 1YL" });
  const trading = await makeEngineer({ ...ltd, packAddress: "Unit 2, Station Road\nHolmfirth\nHD9 2TT" });
  const checks = Object.fromEntries((await call(list)).body.items.map((i: { id: string; addressCheck: string }) => [i.id, i.addressCheck]));
  expect(checks).toEqual({ [office.id]: "registered_office", [trading.id]: "ok" });
});
