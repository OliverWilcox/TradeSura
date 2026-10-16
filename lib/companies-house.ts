// Companies House officers for the admin verification queue (Build Review 2,
// section 3): any company can be picked at sign-up, so the queue shows that
// company's current officers next to the person's name and a person confirms
// they're a director before the badge goes live.
export type Officer = { name: string; role: string };

export async function companyOfficers(companyNumber: string): Promise<Officer[] | null> {
  const key = process.env.COMPANIES_HOUSE_API_KEY;
  if (!key) return null;
  const res = await fetch(
    `https://api.company-information.service.gov.uk/company/${encodeURIComponent(companyNumber)}/officers?items_per_page=20`,
    {
      headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` },
      cache: "no-store",
    },
  );
  if (!res.ok) {
    console.error(`[companies-house] officers lookup failed (${res.status}) for ${companyNumber}`);
    return null;
  }
  const data = (await res.json()) as { items?: { name?: string; officer_role?: string; resigned_on?: string }[] };
  return (data.items ?? [])
    .filter((o) => o.name && !o.resigned_on)
    .map((o) => ({ name: o.name!, role: (o.officer_role ?? "").replace(/-/g, " ") }));
}

// Companies House lists names as "SURNAME, Forenames". A match on surname
// plus first forename is a strong hint, never a decision.
export function officerMatches(officer: string, firstName: string | null, lastName: string | null): boolean {
  if (!firstName || !lastName) return false;
  const [surname, forenames = ""] = officer.split(",").map((p) => p.trim().toLowerCase());
  return surname === lastName.trim().toLowerCase() && forenames.split(/\s+/)[0] === firstName.trim().toLowerCase();
}
