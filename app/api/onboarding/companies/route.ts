import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyToken } from "@/lib/auth";

const Body = z.object({ phoneToken: z.string().min(1), q: z.string().trim().min(2).max(80) });

type ChItem = {
  title?: string;
  company_number?: string;
  company_status?: string;
  address?: {
    premises?: string;
    address_line_1?: string;
    address_line_2?: string;
    locality?: string;
    postal_town?: string;
    postal_code?: string;
  };
};

// Signup step 3 — "Find your company" (30 Sept build notes). The Companies
// House key stays on the server; the app only ever talks to this route.
// Authorised by the verified-phone token from step 1 (no account exists yet)
// so it isn't an open proxy on our Companies House rate limit.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ items: [] });

  const phone = await verifyToken(parsed.data.phoneToken);
  if (phone?.verified !== "1") {
    return NextResponse.json(
      { error: "Phone verification expired — go back and verify your mobile number again." },
      { status: 400 },
    );
  }

  const key = process.env.COMPANIES_HOUSE_API_KEY;
  if (!key) {
    // Not configured yet — the app falls back to typing the number.
    return NextResponse.json({ items: [], unavailable: true });
  }

  const url = new URL("https://api.company-information.service.gov.uk/search/companies");
  url.searchParams.set("q", parsed.data.q);
  url.searchParams.set("items_per_page", "6");
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` },
    cache: "no-store",
  });
  if (!res.ok) {
    console.error(`[companies] search failed (${res.status})`);
    return NextResponse.json({ items: [], unavailable: true });
  }
  const data = (await res.json()) as { items?: ChItem[] };
  const items = (data.items ?? [])
    .filter((i) => i.title && i.company_number)
    .map((i) => ({
      name: i.title!,
      number: i.company_number!,
      status: i.company_status ?? null,
      town: i.address?.locality ?? i.address?.postal_town ?? null,
      // Registered office — pre-fills signup step 3's correspondence address
      // for a limited company (4 Oct notes, step 3.1), editable.
      office:
        i.address?.postal_code && i.address?.address_line_1
          ? {
              line1: [i.address.premises, i.address.address_line_1, i.address.address_line_2]
                .filter(Boolean)
                .join(", "),
              town: i.address.locality ?? i.address.postal_town ?? "",
              postcode: i.address.postal_code.toUpperCase(),
            }
          : null,
    }));
  return NextResponse.json({ items });
}
