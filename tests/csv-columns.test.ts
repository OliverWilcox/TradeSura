// The cover letter promises "Import your existing customers": a job-software
// export has to import as it comes, not only our own snake_case headings.
import { describe, expect, it } from "vitest";
import { parse } from "csv-parse/sync";
import { columnMap, missingColumns, rowFrom } from "@/lib/csv-columns";

const read = (csv: string) => {
  const rows = parse(csv, { columns: true, skip_empty_lines: true, trim: true, bom: true }) as Record<string, string>[];
  const map = columnMap(Object.keys(rows[0]!));
  return { map, rows: rows.map((r) => rowFrom(r, map)) };
};

describe("CSV customer import columns", () => {
  it("reads our own template", () => {
    const { rows } = read("first_name,last_name,phone,email,postcode\nPat,Hughes,07700 900123,pat@example.com,BN1 1AA\n");
    expect(rows[0]).toMatchObject({ firstName: "Pat", lastName: "Hughes", phone: "07700 900123", email: "pat@example.com", postcode: "BN1 1AA" });
  });

  it("reads headings the way job software writes them", () => {
    const { rows } = read("First Name,Surname,Mobile Number,E-mail,Address Line 1,Town/City,Post Code,Boiler Make\nPat,Hughes,07700900123,pat@example.com,14 Elm Grove,Brighton,BN1 1AA,Worcester\n");
    expect(rows[0]).toMatchObject({ firstName: "Pat", lastName: "Hughes", phone: "07700900123", addressLine1: "14 Elm Grove", town: "Brighton", postcode: "BN1 1AA", applianceMake: "Worcester" });
  });

  it("splits a single name column, dropping a title", () => {
    const { rows } = read("Customer Name,Tel\nMrs Pat Hughes,07700900123\nTariq,07700900124\n");
    expect(rows[0]).toMatchObject({ firstName: "Pat", lastName: "Hughes" });
    expect(rows[1]).toMatchObject({ firstName: "Tariq", lastName: "" });
  });

  it("reads a UK date as day/month", () => {
    const { rows } = read("Name,Mobile,Last Service\nPat Hughes,07700900123,12/06/2025\n");
    expect(rows[0]!.lastServiced).toBe("2025-06-12");
  });

  it("copes with the byte-order mark Excel puts at the start", () => {
    const { rows } = read("﻿First Name,Mobile\nPat,07700900123\n");
    expect(rows[0]!.firstName).toBe("Pat");
  });

  it("says plainly which column is missing", () => {
    expect(missingColumns(columnMap(["Name", "Email"]))).toMatch(/mobile number column/);
    expect(missingColumns(columnMap(["Mobile", "Email"]))).toMatch(/name column/);
    expect(missingColumns(columnMap(["Notes"]))).toMatch(/name or a mobile/);
    expect(missingColumns(columnMap(["Name", "Phone"]))).toBeNull();
  });
});
