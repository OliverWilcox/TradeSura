import type { ImportRow } from "@/lib/import-customers";

// The member pack letter promises "Import your existing customers", and job
// software exports don't use our snake_case headers: "First Name", "Mobile",
// "Customer Name", "Post Code". Headers are matched loosely (case, spaces and
// punctuation ignored) against the names each field commonly goes by.
const FIELDS: Record<keyof ImportRow | "fullName", string[]> = {
  firstName: ["firstname", "forename", "forenames", "givenname", "first"],
  lastName: ["lastname", "surname", "familyname", "last"],
  fullName: ["name", "fullname", "customername", "customer", "contactname", "contact", "clientname", "client"],
  phone: ["phone", "mobile", "mobilenumber", "mobilephone", "phonenumber", "telephone", "tel", "telephonenumber", "contactnumber", "mobileno", "phoneno", "cell"],
  email: ["email", "emailaddress", "e-mail"],
  addressLine1: ["addressline1", "address1", "address", "street", "streetaddress", "addressline", "line1", "firstlineofaddress"],
  town: ["town", "city", "towncity", "locality"],
  postcode: ["postcode", "postalcode", "zip", "zipcode"],
  applianceMake: ["appliancemake", "boilermake", "make", "boiler", "appliance", "manufacturer"],
  applianceModel: ["appliancemodel", "boilermodel", "model"],
  lastServiced: ["lastserviced", "lastservice", "lastservicedate", "servicedate", "lastserviceddate"],
};

const key = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

export type ColumnMap = Partial<Record<keyof typeof FIELDS, string>>;

/** Which header in the file feeds each field; the first matching header wins. */
export function columnMap(headers: string[]): ColumnMap {
  const map: ColumnMap = {};
  for (const [field, names] of Object.entries(FIELDS) as [keyof typeof FIELDS, string[]][]) {
    const wanted = names.map(key);
    const found = headers.find((h) => wanted.includes(key(h)));
    if (found !== undefined) map[field] = found;
  }
  return map;
}

/** A plain-words reason the file can't be imported, or null when it can. */
export function missingColumns(map: ColumnMap): string | null {
  const name = map.firstName || map.fullName;
  if (!name && !map.phone) return "We couldn't find a name or a mobile number column. Add headings like First name, Last name and Mobile.";
  if (!name) return "We couldn't find a name column. Add a heading like First name (or Name).";
  if (!map.phone) return "We couldn't find a mobile number column. Add a heading like Mobile (or Phone).";
  return null;
}

export function rowFrom(r: Record<string, string>, map: ColumnMap): ImportRow {
  const get = (f: keyof typeof FIELDS) => (map[f] ? (r[map[f]!] ?? "").trim() : "");
  let firstName = get("firstName");
  let lastName = get("lastName");
  if (!firstName && map.fullName) {
    // "Mrs Pat Hughes" → Pat / Hughes; a single word is the first name.
    const words = get("fullName").split(/\s+/).filter(Boolean);
    if (words.length > 1 && /^(mr|mrs|ms|miss|mx|dr)\.?$/i.test(words[0]!)) words.shift();
    firstName = words[0] ?? "";
    if (!lastName) lastName = words.slice(1).join(" ");
  }
  const opt = (f: keyof typeof FIELDS) => get(f) || undefined;
  return {
    firstName,
    lastName,
    phone: get("phone"),
    email: opt("email"),
    addressLine1: opt("addressLine1"),
    town: opt("town"),
    postcode: opt("postcode"),
    applianceMake: opt("applianceMake"),
    applianceModel: opt("applianceModel"),
    lastServiced: ukDate(get("lastServiced")),
  };
}

// UK files write 12/06/2025 for 12 June, which new Date() would read as
// 6 December. DD/MM/YYYY (or DD-MM-YY) becomes YYYY-MM-DD; anything else is
// passed through for importCustomers to parse or drop.
function ukDate(v: string): string | undefined {
  if (!v) return undefined;
  const m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (!m) return v;
  const year = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
  return `${year}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
}
