import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActor, verifyToken } from "@/lib/auth";

const Body = z.object({
  postcode: z.string().min(4).max(10),
  // Signup step 3 has no account yet — the verified-phone token from step 1
  // stands in, so this still isn't an open proxy on our lookup quota.
  phoneToken: z.string().max(2000).optional(),
  // Email-first signup now verifies the email before an optional SMS check.
  // Accept that signed proof as well so postcode lookup does not require an
  // authenticated account during the signup wizard.
  emailToken: z.string().max(2000).optional(),
  signupToken: z.string().min(1).max(200).optional(),
});

export type LookedUpAddress = {
  line1: string;
  line2?: string;
  town: string;
  postcode: string;
};

// Build Guide v2 Part 17.3 — "PAF address lookup: one shared component used
// everywhere an address appears (signup, pack order, route 3, checkout, and
// every future flow). Provider is your pick: getAddress / Ideal Postcodes /
// Loqate / Postcoder. API key server-side." Wired to GoAddress (goaddress.io)
// on 2 Oct; every caller keeps the manual fallback regardless.
//
// ADDRESS_LOOKUP_API_KEY unset → `configured: false`, no addresses; every
// caller is expected to fall back to manual entry (Part 17.3's acceptance
// criterion explicitly requires that fallback to exist regardless).
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a postcode." }, { status: 400 });
  }
  // Owners and staff both look addresses up when adding a customer.
  const engineerId = (await getActor())?.actorId ?? null;
  const onboardingToken = parsed.data.emailToken ?? parsed.data.phoneToken;
  const onboarding = !engineerId && onboardingToken ? await verifyToken(onboardingToken) : null;
  const signup = !engineerId && onboarding?.verified !== "1" && parsed.data.signupToken
    ? await prisma.plan.findUnique({ where: { signupToken: parsed.data.signupToken }, select: { status: true } })
    : null;
  if (!engineerId && onboarding?.verified !== "1" && signup?.status !== "PENDING") {
    return NextResponse.json({ error: "Sign in to look up addresses." }, { status: 401 });
  }

  const key = process.env.ADDRESS_LOOKUP_API_KEY;
  if (!key) {
    return NextResponse.json({ configured: false, addresses: [] as LookedUpAddress[] });
  }

  // Provider: GoAddress (goaddress.io, UK). Key stays server-side.
  const postcode = parsed.data.postcode.replace(/\s+/g, "").toUpperCase();
  const res = await fetch(`https://portal.goaddress.io/api/address/${encodeURIComponent(postcode)}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (res.status === 404) return NextResponse.json({ configured: true, addresses: [] });
  if (!res.ok) {
    // Never a dead end — callers fall back to manual entry (Part 17.3).
    console.error(`[address] lookup failed (${res.status})`);
    return NextResponse.json({ configured: false, addresses: [] as LookedUpAddress[] });
  }
  const data = (await res.json()) as { new_address_res?: GoAddressRow[] };
  const addresses: LookedUpAddress[] = (data.new_address_res ?? []).map((a) => {
    const streetLine = [a.house_no, a.street].filter(Boolean).join(" ");
    const name = a.building_name || a.organisation || null;
    // UK order: a named house with no number leads with its name
    // ("Harden Hill Farm, Greenfield Road"); numbered ones lead with the street.
    const [first, second] = !a.house_no && name ? [name, a.street] : [streetLine, name];
    const line1 = [a.flat, first].filter(Boolean).join(", ") || a.raw_address || "";
    const line2 = second || undefined;
    return {
      line1,
      ...(line2 ? { line2 } : {}),
      town: a.post_town || a.town || "",
      postcode: formatPostcode(a.postcode || postcode),
    };
  });
  return NextResponse.json({ configured: true, addresses });
}

type GoAddressRow = {
  raw_address?: string | null;
  flat?: string | null;
  house_no?: string | null;
  building_name?: string | null;
  organisation?: string | null;
  street?: string | null;
  post_town?: string | null;
  town?: string | null;
  postcode?: string | null;
};

// "HD93XF" → "HD9 3XF" — the inward code is always the last three characters.
function formatPostcode(pc: string): string {
  const c = pc.replace(/\s+/g, "").toUpperCase();
  return c.length > 3 ? `${c.slice(0, -3)} ${c.slice(-3)}` : c;
}
