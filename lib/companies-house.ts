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

// People with significant control (Matt 16 Nov: owners who aren't officers
// count too). Names come as "Mr John Michael Smith"; companies that own the
// company are skipped.
export async function companyPscNames(companyNumber: string): Promise<string[] | null> {
  const key = process.env.COMPANIES_HOUSE_API_KEY;
  if (!key) return null;
  const res = await fetch(
    `https://api.company-information.service.gov.uk/company/${encodeURIComponent(companyNumber)}/persons-with-significant-control?items_per_page=25`,
    {
      headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` },
      cache: "no-store",
    },
  );
  // 404: the company files no PSC list (some don't); the officers still decide.
  if (res.status === 404) return [];
  if (!res.ok) {
    console.error(`[companies-house] PSC lookup failed (${res.status}) for ${companyNumber}`);
    return null;
  }
  const data = (await res.json()) as {
    items?: { name?: string; kind?: string; ceased_on?: string; name_elements?: { forename?: string; middle_name?: string; surname?: string } }[];
  };
  return (data.items ?? [])
    .filter((p) => !p.ceased_on && (p.kind ?? "").startsWith("individual"))
    .map((p) => {
      const n = p.name_elements;
      return n?.surname ? `${n.surname}, ${[n.forename, n.middle_name].filter(Boolean).join(" ")}` : (p.name ?? "");
    })
    .filter(Boolean);
}
