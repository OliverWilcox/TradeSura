import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { GET as list, POST as upload } from "@/app/api/admin/v1/letters/batches/route";
import { GET as mailHouse } from "@/app/api/admin/v1/letters/batches/[batch]/mail-house/route";
import { GET as resolve } from "@/app/api/claim/resolve/route";
import { addDays, ukDay } from "@/lib/admin/time";
import { claimForPage } from "@/lib/claim";
import { foundingDeadline, foundingMemberIds } from "@/lib/founding";
import { findFirm } from "@/lib/team-join";
import { call, CHECKER, resetDb, withPermissions } from "./helpers";
import { makeEngineer } from "./factories";

// Letter batches (Matt, 4 Nov): an uploaded list becomes reserved codes at
// once; the claim page shows back only the business name and town; the mail
// house gets its file per batch.

beforeEach(resetDb);

const today = ukDay(new Date());
const reservedUntil = addDays(today, 30);
const month = today.slice(0, 7);
const CODE = /^[A-Z]{1,10}-(?=[^-]*\d)[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;

const rows = [
  { businessName: "Smith Heating", firstName: "Dave", lastName: "Smith", town: "Leeds", mailingAddress: { lines: ["4 Mill Lane", "Headingley"], town: "Leeds", postcode: "ls6 2ab" } },
  { businessName: "Bright Boilers Ltd", firstName: "Asha", town: "York", variant: "C" as const },
  { businessName: "O'Brien Gas", firstName: "Sean", town: "Leeds" },
];

describe("letter batches", () => {
  it("make a reserved code for every row at once, named for the month", async () => {
    const res = await call(upload, { body: { reservedUntil, rows } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: `${month}-A`, count: 3, reservedUntil });

    const codes = await prisma.claimCode.findMany({ orderBy: { businessName: "asc" } });
    expect(codes.map((c) => c.code.split("-")[0])).toEqual(["BRIGHT", "OBRIEN", "SMITH"]);
    for (const c of codes) expect(c.code).toMatch(CODE);
    expect(codes.map((c) => [c.town, c.variantCell, c.letterBatch, c.reservedUntil?.toISOString().slice(0, 10)])).toEqual([
      ["York", "C", `${month}-A`, reservedUntil],
      ["Leeds", "A", `${month}-A`, reservedUntil],
      ["Leeds", "A", `${month}-A`, reservedUntil],
    ]);
    expect(codes[2]!.mailingAddress).toBe("4 Mill Lane\nHeadingley\nLeeds\nLS6 2AB");
    expect(await prisma.appSetting.findUnique({ where: { key: `founding_deadline:${month}-A` } })).toMatchObject({ value: reservedUntil });
    expect(await prisma.event.count({ where: { name: "letter_batch_uploaded" } })).toBe(1);

    // The next one this month is B.
    expect((await call(upload, { body: { reservedUntil, rows: rows.slice(0, 1) } })).body.name).toBe(`${month}-B`);
  });

  it("are listed with how far their codes have got", async () => {
    await call(upload, { body: { reservedUntil, rows } });
    const [first, second] = await prisma.claimCode.findMany({ orderBy: { code: "asc" } });
    const engineer = await makeEngineer();
    await prisma.claimCode.update({ where: { code: first!.code }, data: { claimedAt: new Date(), redeemedByEngineerId: engineer.id, redeemedAt: new Date() } });
    await prisma.claimCode.update({ where: { code: second!.code }, data: { suppressedAt: new Date() } });

    const res = await call(list);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      { name: `${month}-A`, reservedUntil, codes: 3, claimed: 1, signedUp: 1, suppressed: 1, uploadedAt: expect.any(String), uploadedBy: "Test Super" },
    ]);
  });

  it("give the mail house its file, without the codes whose owner opted out", async () => {
    await call(upload, { body: { reservedUntil, rows } });
    const york = await prisma.claimCode.findFirstOrThrow({ where: { town: "York" } });
    await prisma.claimCode.update({ where: { code: york.code }, data: { suppressedAt: new Date() } });

    const res = await call(mailHouse, { params: { batch: `${month}-A` } });
    expect(res.status).toBe(200);
    expect(res.body.suppressed).toBe(1);
    expect(res.body.rows).toEqual([
      { businessName: "O'Brien Gas", firstName: "Sean", town: "Leeds", reservedUntil, code: expect.stringMatching(/^OBRIEN-/), link: expect.stringMatching(/\/c\/OBRIEN-/), mailingAddress: null },
      {
        businessName: "Smith Heating",
        firstName: "Dave",
        town: "Leeds",
        reservedUntil,
        code: expect.stringMatching(/^SMITH-/),
        link: expect.stringMatching(/\/c\/SMITH-/),
        mailingAddress: { lines: ["4 Mill Lane", "Headingley"], town: "Leeds", postcode: "LS6 2AB" },
      },
    ]);
    expect(res.body.rows[1].link.endsWith(`/c/${res.body.rows[1].code}`)).toBe(true);
    expect((await call(mailHouse, { params: { batch: "2020-01-A" } })).status).toBe(404);
  });

  it("show back only the business name and town on the claim page, however the code is typed", async () => {
    await call(upload, { body: { reservedUntil, rows } });
    const smith = await prisma.claimCode.findFirstOrThrow({ where: { businessName: "Smith Heating" } });
    const typed = smith.code.toLowerCase().replace("-", " ");
    const res = await resolve(new Request(`http://localhost:3000/api/claim/resolve?code=${encodeURIComponent(typed)}`, { headers: { "x-forwarded-for": "203.0.113.9" } }));
    const body = await res.json();
    expect(body).toEqual({ valid: true, personalised: true, businessName: "Smith Heating", town: "Leeds", letterBatch: `${month}-A`, variantCell: "A" });
    expect(JSON.stringify(body)).not.toMatch(/Dave|Mill Lane|LS6/);
  });

  it("hold a Founding place until the end of the reservation date", async () => {
    await call(upload, { body: { reservedUntil, rows: rows.slice(0, 1) } });
    const code = await prisma.claimCode.findFirstOrThrow();
    const deadline = await foundingDeadline(code);
    expect(ukDay(deadline)).toBe(reservedUntil);
    expect(ukDay(new Date(deadline.getTime() + 1000))).toBe(addDays(reservedUntil, 1));

    const engineer = await makeEngineer();
    await prisma.claimCode.update({ where: { code: code.code }, data: { claimedAt: new Date(), redeemedByEngineerId: engineer.id, redeemedAt: new Date() } });
    expect(await foundingMemberIds([engineer.id])).toEqual(new Set([engineer.id]));
  });

  it("refuse a reservation date that has passed, a bad row, or nothing to send", async () => {
    const refused = async (body: unknown) => (await call(upload, { body })).body.error;
    expect(await refused({ reservedUntil: today, rows })).toMatchObject({ code: "VALIDATION", message: "The reservation date has to be after today." });
    expect(await refused({ reservedUntil: addDays(today, 400), rows })).toMatchObject({ message: "The reservation date has to be within a year." });
    expect(await refused({ reservedUntil, rows: [] })).toMatchObject({ message: "The batch has no letters." });
    expect(await refused({ reservedUntil, rows: [{ ...rows[0], mailingAddress: { lines: ["1 Road"], town: "Leeds", postcode: "nowhere" } }] })).toMatchObject({ code: "VALIDATION" });
    expect(await prisma.claimCode.count()).toBe(0);
  });

  it("need letters:write to upload and letters:export for the mail house's file", async () => {
    const reader = withPermissions("letters:read");
    expect((await call(list, { as: reader })).status).toBe(200);
    expect((await call(upload, { as: reader, body: { reservedUntil, rows } })).status).toBe(403);
    await call(upload, { body: { reservedUntil, rows } });
    expect((await call(mailHouse, { as: reader, params: { batch: `${month}-A` } })).status).toBe(403);
    expect((await call(list, { as: CHECKER })).status).toBe(403);
  });
});

describe("codes made before letter batches", () => {
  const lookup = async (typed: string) => (await resolve(new Request(`http://localhost:3000/api/claim/resolve?code=${encodeURIComponent(typed)}`, { headers: { "x-forwarded-for": "203.0.113.10" } }))).json();
  const code = (c: string, businessName: string) => ({ code: c, firstName: "Sam", businessName, letterBatch: "2026-09-A", variantCell: "A", town: "Leeds" });

  it("are still found by the claim API, the claim page and team joining, however they're typed", async () => {
    const owner = await makeEngineer();
    await prisma.claimCode.createMany({
      data: [
        { ...code("TS-48217", "Dave Smith Heating"), redeemedByEngineerId: owner.id, redeemedAt: new Date() },
        // A code loaded without a dash, in a shape a letter code could have: it was found before, so it still is.
        code("ABCDE234", "Hand Loaded Gas"),
      ],
    });
    for (const typed of ["TS-48217", "ts 48217", "ts48217"]) expect(await lookup(typed), typed).toMatchObject({ valid: true, businessName: "Dave Smith Heating" });
    for (const typed of ["ABCDE234", "abcde234", "abcde 234"]) expect(await lookup(typed), typed).toMatchObject({ valid: true, businessName: "Hand Loaded Gas" });
    expect((await claimForPage("abcde234"))?.code).toBe("ABCDE234");
    expect((await claimForPage("ts48217"))?.code).toBe("TS-48217");
    expect(await findFirm({ claimCode: "ts 48217" })).toMatchObject({ ownerId: owner.id });
    expect(await lookup("TS-99999")).toEqual({ valid: false });
  });
});
