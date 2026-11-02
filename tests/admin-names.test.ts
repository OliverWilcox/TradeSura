import { describe, expect, it } from "vitest";
import { matchPersonName } from "@/lib/admin/names";

// 3.1: Companies House lists "WOOD, Matthew Dean"; the applicant signed up as Matt Wood.

describe("matching a register's name to the applicant", () => {
  it("calls Matt Wood a likely match for WOOD, Matthew Dean", () => {
    expect(matchPersonName("WOOD, Matthew Dean", "Matt", "Wood")).toBe("likely");
  });

  it("matches surname first or last, whatever the case and punctuation", () => {
    expect(matchPersonName("WOOD, Matthew Dean", "Matthew", "Wood")).toBe("match");
    expect(matchPersonName("Matthew Dean Wood", "matthew", "WOOD")).toBe("match");
    expect(matchPersonName("O'BRIEN, Siobhán", "Siobhan", "O’Brien")).toBe("match");
    expect(matchPersonName("ARMSTRONG-MEDHURST, Justin", "Justin", "Armstrong Medhurst")).toBe("match");
    expect(matchPersonName("WOOD, Mr Matthew Dean", "Matthew", "Wood")).toBe("match");
  });

  it("calls short forms, a shared start and a middle name likely", () => {
    expect(matchPersonName("SMITH, David", "Dave", "Smith")).toBe("likely");
    expect(matchPersonName("JONES, Christopher Paul", "Chris", "Jones")).toBe("likely");
    expect(matchPersonName("BROWN, Robert", "Bob", "Brown")).toBe("likely");
    expect(matchPersonName("TAYLOR, Jonathan Mark", "Mark", "Taylor")).toBe("likely");
  });

  it("matches the Gas Safe register's initials as far as they go", () => {
    expect(matchPersonName("D. Smith", "Dave", "Smith")).toBe("match");
    expect(matchPersonName("P. Smith", "Dave", "Smith")).toBe("none");
  });

  it("says no match for a different surname, a different first name or a missing name", () => {
    expect(matchPersonName("WOOD, Matthew Dean", "Matt", "Woods")).toBe("none");
    expect(matchPersonName("WOOD, Sarah Jane", "Matt", "Wood")).toBe("none");
    expect(matchPersonName("WOOD, Matthew", null, "Wood")).toBe("none");
    expect(matchPersonName("WOOD,", "Matt", "Wood")).toBe("none");
  });
});
