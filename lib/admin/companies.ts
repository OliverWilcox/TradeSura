// Companies House for the admin API: a company's own record (name, type,
// status, registered office), and whether a business's name and the type
// the engineer picked agree. Uses the same key as lib/companies-house.ts.

export type CompanyProfile = {
  number: string;
  name: string;
  /** Companies House's type, e.g. "ltd", "llp", "plc". */
  type: string;
  status: string;
  registeredOffice: string | null;
};

type ApiAddress = { premises?: string; address_line_1?: string; address_line_2?: string; locality?: string; region?: string; postal_code?: string };

export function formatOffice(a: ApiAddress | undefined): string | null {
  if (!a) return null;
  const first = [a.premises, a.address_line_1].filter(Boolean).join(" ");
  const parts = [first, a.address_line_2, a.locality, a.region, a.postal_code].map((p) => p?.trim()).filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** The company's record, or null when there's no key, no such company, or Companies House didn't answer in time. */
export async function companyProfile(companyNumber: string): Promise<CompanyProfile | null> {
  const key = process.env.COMPANIES_HOUSE_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`https://api.company-information.service.gov.uk/company/${encodeURIComponent(companyNumber)}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      if (res.status !== 404) console.error(`[admin-api] Companies House profile failed (${res.status}) for ${companyNumber}`);
      return null;
    }
    const d = (await res.json()) as { company_number?: string; company_name?: string; type?: string; company_status?: string; registered_office_address?: ApiAddress };
    return {
      number: d.company_number ?? companyNumber,
      name: d.company_name ?? "",
      type: d.type ?? "",
      status: d.company_status ?? "",
      registeredOffice: formatOffice(d.registered_office_address),
    };
  } catch (err) {
    console.error(`[admin-api] Companies House profile failed for ${companyNumber}:`, err);
    return null;
  }
}

/** A company word as a word of its own: "Test Trading LTD", "Smith & Co. Limited", "Acme plc", "Jones LLP". */
const COMPANY_WORD = /(^|[^a-z])(ltd|limited|plc|llp)\.?($|[^a-z])/i;

/**
 * Whether a business's name and type disagree: a name that says it's a
 * company (Ltd, Limited, PLC, LLP) with a type that isn't, or a limited
 * company whose registered name doesn't. A trading name may leave "Ltd" out,
 * so the reverse is judged on the registered (legal) name when there is one.
 */
export function businessTypeMismatch(b: { tradingName: string | null; legalName: string | null; businessType: string | null }): "name_says_company" | "type_says_company" | null {
  const names = [b.tradingName, b.legalName].filter((n): n is string => !!n?.trim());
  const isCompany = b.businessType === "ltd";
  const llpPartnership = b.businessType === "partnership" && names.some((n) => /(^|[^a-z])llp\.?($|[^a-z])/i.test(n));
  if (!isCompany && !llpPartnership && names.some((n) => COMPANY_WORD.test(n))) return "name_says_company";
  const registered = b.legalName?.trim() || b.tradingName?.trim();
  if (isCompany && registered && !COMPANY_WORD.test(registered)) return "type_says_company";
  return null;
}
