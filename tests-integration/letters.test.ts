import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("APP_URL", "https://tradesura.com");
});
afterEach(() => vi.unstubAllEnvs());

const today = ukDay(new Date());
const reservedUntil = addDays(today, 30);
const NAME = "Leeds November";
const batch = (over: Record<string, unknown> = {}) => {
  const r = (over.rows as typeof rows | undefined) ?? rows;
  return { name: NAME, area: "Leeds and York", postedOn: today, count: r.length, reservedUntil, rows: r, ...over };
};
const CODE = /^[A-Z]{1,10}-(?=[^-]*\d)[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;

const rows = [
  { businessName: "Smith Heating", firstName: "Dave", lastName: "Smith", town: "Leeds", mailingAddress: { lines: ["4 Mill Lane", "Headingley"], town: "Leeds", postcode: "ls6 2ab" } },
  { businessName: "Bright Boilers Ltd", firstName: "Asha", town: "York", variant: "C" as const },
  { businessName: "O'Brien Gas", firstName: "Sean", town: "Leeds" },
];

describe("letter batches", () => {
  it("make a claim code and link for every letter at once, under the batch's name, area and posting date", async () => {
    const res = await call(upload, { body: batch() });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: NAME, area: "Leeds and York", postedOn: today, count: 3, reservedUntil });
    expect(await prisma.letterBatch.findUnique({ where: { name: NAME } })).toMatchObject({ area: "Leeds and York", letters: 3, createdBy: "Test Super" });

    const codes = await prisma.claimCode.findMany({ orderBy: { businessName: "asc" } });
    expect(codes.map((c) => c.code.split("-")[0])).toEqual(["BRIGHT", "OBRIEN", "SMITH"]);
    for (const c of codes) expect(c.code).toMatch(CODE);
    expect(codes.map((c) => [c.town, c.variantCell, c.letterBatch, c.reservedUntil?.toISOString().slice(0, 10)])).toEqual([
      ["York", "C", NAME, reservedUntil],
      ["Leeds", "A", NAME, reservedUntil],
      ["Leeds", "A", NAME, reservedUntil],
    ]);
    expect(codes[2]!.mailingAddress).toBe("4 Mill Lane\nHeadingley\nLeeds\nLS6 2AB");
    expect(await prisma.appSetting.findUnique({ where: { key: `founding_deadline:${NAME}` } })).toMatchObject({ value: reservedUntil });
    expect(await prisma.event.count({ where: { name: "letter_batch_uploaded" } })).toBe(1);

    const again = await call(upload, { body: batch({ rows: rows.slice(0, 1), name: "leeds november" }) });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/already a batch called leeds november/);
  });

  it("are listed with how far their codes have got", async () => {
    await call(upload, { body: batch() });
    const [first, second] = await prisma.claimCode.findMany({ orderBy: { code: "asc" } });
    const engineer = await makeEngineer();
    await prisma.claimCode.update({ where: { code: first!.code }, data: { claimedAt: new Date(), redeemedByEngineerId: engineer.id, redeemedAt: new Date() } });
    await prisma.claimCode.update({ where: { code: second!.code }, data: { suppressedAt: new Date() } });

    const res = await call(list);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      { name: NAME, area: "Leeds and York", postedOn: today, planned: 3, reservedUntil, codes: 3, claimed: 1, signedUp: 1, suppressed: 1, unclaimed: 1, secondLetterFrom: addDays(today, 10), uploadedAt: expect.any(String), uploadedBy: "Test Super" },
    ]);
  });

  it("give the mail house its file, without the codes whose owner opted out", async () => {
    await call(upload, { body: batch() });
    const york = await prisma.claimCode.findFirstOrThrow({ where: { town: "York" } });
    await prisma.claimCode.update({ where: { code: york.code }, data: { suppressedAt: new Date() } });

    const res = await call(mailHouse, { params: { batch: NAME } });
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
    expect(res.body.rows[1].link).toBe(`https://tradesura.com/c/${res.body.rows[1].code}`);
    expect(res.body.linkBase).toBe("https://tradesura.com");
    expect((await call(mailHouse, { params: { batch: "2020-01-A" } })).status).toBe(404);
  });

  it("won't give the mail house links that don't go to the live site over https (M-09, N-07, R-05)", async () => {
    await call(upload, { body: batch() });
    for (const base of ["http://localhost:3000", "http://tradesura.com", "https://tradesura-git-main-oliver.vercel.app", "https://staging.tradesura.com", "https://tradesura.com.example.net", "https://10.0.0.5", "https://localhost.", "https://tradesura.com:8443", "https://tradesura.com/staging", "https://tradesura.com?ref=x", "https://tradesura.com#top", "https://tradesura.com//", "https://tradesura.com:443", "https://TradeSura.com"]) {
      vi.stubEnv("APP_URL", base);
      const res = await call(mailHouse, { params: { batch: NAME } });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/Set APP_URL to the live site/);
    }
    vi.stubEnv("APP_URL", "https://www.tradesura.com/");
    expect((await call(mailHouse, { params: { batch: NAME } })).status).toBe(200);
  });

  it("show back only the business name and town on the claim page, however the code is typed", async () => {
    await call(upload, { body: batch() });
    const smith = await prisma.claimCode.findFirstOrThrow({ where: { businessName: "Smith Heating" } });
    const typed = smith.code.toLowerCase().replace("-", " ");
    const res = await resolve(new Request(`http://localhost:3000/api/claim/resolve?code=${encodeURIComponent(typed)}`, { headers: { "x-forwarded-for": "203.0.113.9" } }));
    const body = await res.json();
    expect(body).toEqual({ valid: true, personalised: true, businessName: "Smith Heating", town: "Leeds", letterBatch: NAME, variantCell: "A" });
    expect(JSON.stringify(body)).not.toMatch(/Dave|Mill Lane|LS6/);
  });

  it("hold a Founding place until the end of the reservation date", async () => {
    await call(upload, { body: batch({ rows: rows.slice(0, 1) }) });
    const code = await prisma.claimCode.findFirstOrThrow();
    const deadline = await foundingDeadline(code);
    expect(ukDay(deadline)).toBe(reservedUntil);
    expect(ukDay(new Date(deadline.getTime() + 1000))).toBe(addDays(reservedUntil, 1));

    const engineer = await makeEngineer();
    await prisma.claimCode.update({ where: { code: code.code }, data: { claimedAt: new Date(), redeemedByEngineerId: engineer.id, redeemedAt: new Date() } });
    expect(await foundingMemberIds([engineer.id])).toEqual(new Set([engineer.id]));
  });

  it("refuse a reservation date that has passed, a bad row, a count that doesn't match, or nothing to send", async () => {
    const refused = async (body: unknown) => (await call(upload, { body })).body.error;
    expect(await refused(batch({ reservedUntil: today }))).toMatchObject({ code: "VALIDATION", message: "The reservation date has to be after today." });
    expect(await refused(batch({ reservedUntil: addDays(today, 400) }))).toMatchObject({ message: "The reservation date has to be within a year." });
    expect(await refused(batch({ rows: [], count: 1 }))).toMatchObject({ message: "The batch has no letters." });
    expect(await refused(batch({ rows: [{ ...rows[0], mailingAddress: { lines: ["1 Road"], town: "Leeds", postcode: "nowhere" } }] }))).toMatchObject({ code: "VALIDATION" });
    expect(await refused(batch({ count: 5 }))).toMatchObject({ message: "The list has 3 letters, not 5. Check the count or the file.", fields: { count: expect.any(Array) } });
    expect(await refused(batch({ postedOn: addDays(today, -200) }))).toMatchObject({ fields: { postedOn: expect.any(Array) } });
    expect(await refused(batch({ name: "" }))).toMatchObject({ code: "VALIDATION" });
    expect(await refused(batch({ area: "" }))).toMatchObject({ code: "VALIDATION" });
    expect(await prisma.claimCode.count()).toBe(0);
  });

  it("need letters:write to upload and letters:export for the mail house's file", async () => {
    const reader = withPermissions("letters:read");
    expect((await call(list, { as: reader })).status).toBe(200);
    expect((await call(upload, { as: reader, body: batch() })).status).toBe(403);
    await call(upload, { body: batch() });
    expect((await call(mailHouse, { as: reader, params: { batch: NAME } })).status).toBe(403);
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
