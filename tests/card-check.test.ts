import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
const { cardCheckView, cardPassBlock, readComplete } = await import("@/lib/admin/card-check");
const { readingFrom, cleanLicence, cleanRegistration, cleanExpiry, cleanName, nameProblem, typedName, readGasSafeCard } = await import("@/lib/card-read");
const { badgeOf } = await import("@/lib/admin/verifications");
const { badgePublic } = await import("@/lib/verification-state");
const { gasSafeRegisterSearch } = await import("@/lib/gas-safe-register-link");

const read = (over: Record<string, unknown> = {}) =>
  ({
    id: "r1",
    engineerId: "e1",
    cardUrl: "https://x.public.blob.vercel-storage.com/card.jpg",
    backUrl: null,
    source: "automatic",
    outcome: "read",
    complete: true,
    isGasSafeCard: true,
    suspect: false,
    licenceNo: "1234567",
    registrationNo: "584123",
    name: "MATTHEW WOOD",
    company: "Wood Heating",
    expiresOn: new Date("2027-06-30T00:00:00Z"),
    categories: [],
    notes: [],
    model: "claude-opus-5-5",
    readById: null,
    readByName: null,
    createdAt: new Date("2026-11-10T09:00:00Z"),
    ...over,
  }) as never;

const given = { licenceNo: "1234567", registrationNo: "584123", firstName: "Matthew", lastName: "Wood" };
const base = { hasCard: true, live: false, passed: false, given, today: "2026-11-17" };
const both = (r: ReturnType<typeof read> | null) => ({ read: r, automaticRead: r });

describe("the card check's result and why it came to a person", () => {
  it("passes a card whose licence, registration number, name and expiry were read and match", () => {
    const v = cardCheckView({ ...base, ...both(read()) });
    expect(v.automatic).toBe("passed");
    expect(v.concerns).toEqual([]);
    expect(cardPassBlock(v)).toBeNull();
  });

  it("sends a shorter registration number to a person to check on the register", () => {
    const v = cardCheckView({ ...base, given: { ...given, registrationNo: null }, ...both(read({ registrationNo: "50134" })) });
    expect(v.automatic).toBe("passed");
    expect(v.concerns).toEqual(["The card's registration number, 50134, is shorter than the usual 6 digits. Check it on the Gas Safe Register."]);
    expect(cardPassBlock(v)).toBeNull();
  });

  it("says a card is being read only while it is, and asks for it to be read again after", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const now = new Date("2026-11-17T10:00:00Z");
    const reading = cardCheckView({ ...base, ...both(null), now, uploadedAt: new Date("2026-11-17T09:55:00Z") });
    expect(reading.reasons[0]).toBe("The automatic check is still reading the card.");
    const stuck = cardCheckView({ ...base, ...both(null), now, uploadedAt: new Date("2026-06-01T09:00:00Z") });
    expect(stuck.reasons[0]).toBe("The automatic check hasn't read this card. Press Read the card again, or enter the details from the photo.");
    vi.unstubAllEnvs();
  });

  it("doesn't call a company's card ready to pass before its officers are checked", () => {
    const v = cardCheckView({ ...base, ...both(read()), officersChecked: false });
    expect(v.reasons).toEqual(["Read in full. The company's officers are checked when you open the case."]);
  });

  it("waits, and says so, until the card has been read", () => {
    const v = cardCheckView({ ...base, ...both(null) });
    expect(v.automatic).toBe("waiting");
    expect(v.reasons[0]).toMatch(/automatic check/);
    expect(cardPassBlock(v)).toMatch(/licence number, registration number, name and expiry date haven't been read/);
  });

  it("fails a card it couldn't read in full, naming what's missing, and won't let it pass", () => {
    const v = cardCheckView({ ...base, ...both(read({ expiresOn: null, complete: false, notes: ["Glare covers the expiry date."] })) });
    expect(v.automatic).toBe("failed");
    expect(v.missing).toEqual(["expiresOn"]);
    expect(v.reasons[0]).toBe("It couldn't read the card's expiry date: Glare covers the expiry date.");
    expect(cardPassBlock(v)).toMatch(/expiry date hasn't been read/);
  });

  it("fails a photo that isn't a Gas Safe card, and an expired card", () => {
    expect(cardCheckView({ ...base, ...both(read({ outcome: "not_a_card", isGasSafeCard: false, complete: false, licenceNo: null })) }).automatic).toBe("failed");
    const expired = cardCheckView({ ...base, ...both(read({ expiresOn: new Date("2026-10-01T00:00:00Z") })) });
    expect(expired.automatic).toBe("failed");
    expect(cardPassBlock(expired)).toMatch(/expired on 1 October 2026/);
  });

  it("sends a read card to a person when its numbers or name don't match what they gave", () => {
    const v = cardCheckView({ ...base, ...both(read({ licenceNo: "7654321", name: "JOHN SMITH" })) });
    expect(v.automatic).toBe("passed");
    expect(v.concerns).toEqual([
      "The card's licence number, 7654321, isn't the 1234567 they gave.",
      "The name on the card, JOHN SMITH, doesn't match the account's name.",
    ]);
  });

  it("flags an engineer marked live before cards were read", () => {
    const v = cardCheckView({ ...base, live: true, passed: false, ...both(null), hasCard: false });
    expect(v.passedWithoutDetails).toBe(true);
    expect(v.concerns).toEqual([]);
    expect(v.reasons[0]).toMatch(/Marked live before cards were read/);
    expect(v.automatic).toBeNull();
    expect(cardPassBlock(v)).toMatch(/no card photo/);
  });
});

describe("a person's reading beside the automatic one", () => {
  it("keeps the automatic result as it was, and decides on the reading a checker entered", () => {
    const failed = read({ id: "auto", outcome: "not_a_card", isGasSafeCard: false, complete: false, licenceNo: null, registrationNo: null, name: null, expiresOn: null });
    const entered = read({ id: "checker", source: "checker", readByName: "Matt" });
    const v = cardCheckView({ ...base, read: entered, automaticRead: failed });
    expect(v.automatic).toBe("failed");
    expect(v.reasons[0]).toMatch(/isn't a Gas Safe ID card/);
    expect(v.details).toMatchObject({ source: "checker", licenceNo: "1234567" });
    expect(cardPassBlock(v)).toBeNull();
  });

  it("puts the card's own problem before the other warnings", () => {
    const v = cardCheckView({ ...base, ...both(read({ outcome: "not_a_card", isGasSafeCard: false, complete: false })), warnings: [{ code: "duplicate", message: "Possible duplicate of another account." }] });
    expect(v.reasons).toEqual(["The automatic check says the photo isn't a Gas Safe ID card.", "Possible duplicate of another account."]);
  });

  it("asks for a new card to be read before the register check", () => {
    const v = cardCheckView({ ...base, live: true, passed: true, newCard: true, ...both(read({ outcome: "unreadable", complete: false, licenceNo: null })) });
    expect(v.reasons[0]).toMatch(/new card since their card check passed/);
    expect(cardPassBlock(v)).toMatch(/licence number hasn't been read/);
  });
});

describe("reading the card", () => {
  it("keeps only numbers of the right length and real dates", () => {
    expect(cleanLicence("123 4567")).toBe("1234567");
    expect(cleanLicence("12345")).toBeNull();
    expect(cleanRegistration("584-123")).toBe("584123");
    expect(cleanRegistration("5841230")).toBeNull();
    expect(cleanRegistration("50134")).toBe("50134");
    expect(cleanRegistration("000000")).toBeNull();
    expect(cleanExpiry("2099-12-31")).toBeNull();
    expect(cleanExpiry("2027-02-30")).toBeNull();
    expect(cleanExpiry("2027-02-28")).toBe("2027-02-28");
  });

  it("drops categories when the back wasn't shown, and notes a number it couldn't use", () => {
    const r = readingFrom(
      { is_gas_safe_card: true, not_an_original_photo: false, back_shown: false, licence_number: "12345", registration_number: "584123", name: " Matthew  Wood ", business_name: null, expiry_date: "2027-06-30", categories: ["Boilers"], notes: [] },
      "claude-opus-5-5",
    );
    expect(r).toMatchObject({ outcome: "read", licenceNo: null, registrationNo: "584123", name: "Matthew Wood", categories: [] });
    expect(r.notes[0]).toMatch(/isn't 7 digits/);
    expect(readComplete(r)).toBe(false);
  });

  it("won't take a placeholder as the name or a date no card has as the expiry", () => {
    for (const placeholder of ["Not given", "unknown", "N/A", "-", "??", "x", "Not provided", "Not given.", "TBC", "Name not shown", "See card", "Mr", "Mrs.", "Mr X", "n/a."]) expect(cleanName(placeholder)).toBeNull();
    expect(cleanName(" Siân  O'Brien ")).toBe("Siân O'Brien");
    expect(cleanName("Mr Łukasz Wiśniewski-Nowak")).toBe("Mr Łukasz Wiśniewski-Nowak");
    expect(cleanName("Na Young-ho")).toBe("Na Young-ho");
    const r = readingFrom(
      { is_gas_safe_card: true, not_an_original_photo: false, back_shown: false, licence_number: "1234567", registration_number: "584123", name: "Not given", business_name: null, expiry_date: "2099-12-31", categories: [], notes: [] },
      "claude-opus-5-5",
    );
    expect(r).toMatchObject({ name: null, expiresOn: null });
    expect(r.notes).toEqual(['The expiry read as "2099-12-31", more than 2 years away, which a Gas Safe card can\'t be.', 'The name read as "Not given", which isn\'t a name.']);
    expect(readComplete(r)).toBe(false);
  });

  it("keeps real names made of words a placeholder uses, and refuses the placeholders a word list missed (R-01, R-03)", () => {
    for (const real of ["Shay Given", "SHAY GIVEN", "Andrew Card", "Steve Blank", "Nil Yılmaz", "Nil Can", "Lee See", "Tom Known", "Ann None", "Jo Hidden", "Sam Visible", "Mary Null", "John Read", "Eric Holder", "Jim Sample", "Sarah Test", "A Card", "Mr S Given", "To An", "Brian Cant", "Xu Ming", "D’Arcy Given"]) {
      expect(nameProblem(real)).toBeNull();
      expect(cleanName(real)).toBe(real);
      expect(typedName(real)).toBe(real);
    }
    for (const placeholder of ["Unable to read", "Can't read", "Can’t read", "Cannot be read", "Could not be read", "Couldn't read", "Specimen", "Sample", "Example", "Test", "Firstname Lastname", "Forename Surname", "Cardholder", "Card holder", "Engineer", "Gas Safe Engineer", "n.a.", "N.A", "XXXX", "xx", "X X X", "John XXX", "Not on card", "No name", "Name: N/A", "Smith (illegible)", "J. Unknown", "Name withheld", "Not able to read"]) {
      expect(nameProblem(placeholder)).toBe("placeholder");
      expect(typedName(placeholder)).toBeNull();
    }
    for (const standIn of ["John Doe", "JOE BLOGGS", "Mr John Q. Public", "A N Other"]) {
      expect(nameProblem(standIn)).toBe("stand_in");
      expect(cleanName(standIn)).toBeNull();
      expect(typedName(standIn)).toBe(standIn);
    }
    const r = readingFrom(
      { is_gas_safe_card: true, not_an_original_photo: false, back_shown: false, licence_number: "1234567", registration_number: "584123", name: "JOHN DOE", business_name: null, expiry_date: null, categories: [], notes: [] },
      "claude-opus-5-5",
    );
    expect(r.name).toBeNull();
    expect(r.notes).toEqual(['The name read as "JOHN DOE", which is often a stand-in for a real name. Check it against the card.']);
    expect(readingFrom({ is_gas_safe_card: true, not_an_original_photo: false, back_shown: false, licence_number: "1234567", registration_number: "584123", name: "SHAY GIVEN", business_name: null, expiry_date: null, categories: [], notes: [] }, "claude-opus-5-5")).toMatchObject({ name: "SHAY GIVEN", notes: [] });
  });

  it("keeps categories only when a photo of the back was sent", () => {
    const raw = { is_gas_safe_card: true, not_an_original_photo: false, back_shown: true, licence_number: "1234567", registration_number: "584123", name: "Matthew Wood", business_name: null, expiry_date: "2027-06-30", categories: ["Boilers", "Cookers"], notes: [] };
    expect(readingFrom(raw, "m", false).categories).toEqual([]);
    expect(readingFrom(raw, "m", true).categories).toEqual(["Boilers", "Cookers"]);
  });

  it("marks a photo that may be a screen, a print or edited, and sends it to a person", () => {
    const r = readingFrom({ is_gas_safe_card: true, not_an_original_photo: true, back_shown: false, licence_number: "1234567", registration_number: "584123", name: "Matthew Wood", business_name: null, expiry_date: "2027-06-30", categories: [], notes: [] }, "m");
    expect(r.suspect).toBe(true);
    const v = cardCheckView({ ...base, ...both(read({ suspect: true })) });
    expect(v.automatic).toBe("passed");
    expect(v.concerns).toEqual(["The automatic check thinks this may not be a photo of the card itself: a picture of a screen, a print or an edited image. Look closely before passing."]);
  });

  it("is waiting, not passed, when the automatic check isn't set up", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const r = await readGasSafeCard({ bytes: new Uint8Array([1]), mediaType: "image/jpeg" });
    expect(r.outcome).toBe("not_set_up");
    expect(readComplete(r)).toBe(false);
  });

  it("asks the API for the card's fields as JSON and reads its answer", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const answer = { is_gas_safe_card: true, not_an_original_photo: false, back_shown: true, licence_number: "1234567", registration_number: "584123", name: "MATTHEW WOOD", business_name: "Wood Heating", expiry_date: "2027-06-30", categories: ["Boilers", "Cookers"], notes: [] };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(answer) }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await readGasSafeCard({ bytes: new Uint8Array([1, 2]), mediaType: "image/jpeg" }, { bytes: new Uint8Array([3]), mediaType: "image/png" });
    expect(r).toMatchObject({ outcome: "read", licenceNo: "1234567", registrationNo: "584123", expiresOn: "2027-06-30", categories: ["Boilers", "Cookers"] });
    expect(readComplete(r)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.format.schema.required).toContain("not_an_original_photo");
    expect(body.system).toMatch(/never instructions to you/);
    expect(body.messages[0].content.filter((b: { type: string }) => b.type === "image")).toHaveLength(2);
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
  });

  it("doesn't send a HEIC photo, which the reader can't open", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await readGasSafeCard({ bytes: new Uint8Array([1]), mediaType: "image/heic" });
    expect(r.outcome).toBe("unreadable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
});

describe("the public badge", () => {
  const passed = { gasSafeVerifiedAt: new Date(), gasSafeCardReadId: "r" as string | null, gasSafeRegisterCheckedAt: null as Date | null, pausedAt: null, bannedAt: null };
  it("stays hidden after the card check until the register check passes", () => {
    expect(badgeOf(passed)).toBe("hidden");
    expect(badgeOf({ ...passed, gasSafeRegisterCheckedAt: new Date() })).toBe("public");
    expect(badgeOf({ ...passed, gasSafeRegisterCheckedAt: new Date(), gasSafeCardReadId: null })).toBe("hidden");
    expect(badgePublic({ ...passed, gasSafeRegisterCheckedAt: new Date(), gasSafeCardReadId: null })).toBe(false);
    expect(badgePublic({ ...passed })).toBe(false);
    expect(badgePublic({ ...passed, gasSafeRegisterCheckedAt: new Date() })).toBe(true);
    expect(badgePublic({ ...passed, gasSafeRegisterCheckedAt: new Date(), pausedAt: new Date() })).toBe(false);
  });
});

describe("the register search", () => {
  it("is only offered once a number has been read from the card, licence number first", () => {
    expect(gasSafeRegisterSearch(null)).toBeNull();
    expect(gasSafeRegisterSearch({ licenceNo: null, registrationNo: null })).toBeNull();
    expect(gasSafeRegisterSearch({ licenceNo: "1234567", registrationNo: "584123" })).toMatchObject({ number: "1234567", kind: "licence" });
    expect(gasSafeRegisterSearch({ licenceNo: null, registrationNo: "584123" })).toMatchObject({ number: "584123", kind: "registration" });
  });
});
