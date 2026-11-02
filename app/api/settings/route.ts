import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { moveSlug, uniqueSlug } from "@/lib/slug";
import { standingCopy, gasSafeStatus, paymentsStatus } from "@/lib/verification-state";

import { smsAvailable } from "@/lib/contact-verification";
import { whatsappConfigured } from "@/lib/whatsapp";
import { formatAddress, sameAddress, tradingAddressOf } from "@/lib/addresses";
import { companyProfile } from "@/lib/admin/companies";

const Body = z.object({
  // Blank is allowed for a company with a Companies House name on file —
  // it then trades under that name (Build Review 3, section 2).
  tradingName: z.string().trim().max(80),
  // Optional so older clients that only send the trading name keep working.
  // Accounts from older signup builds have no name at all — this is how the
  // engineer fills it in (greeting, avatar initials).
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  logoUrl: z.string().url().max(400).optional().or(z.literal("")),
  // "TradeSura can text me to help me finish setting up". Left out, it stays as it is.
  setupTextConsent: z.boolean().optional(),
});

// Mobile counterpart to the settings form's initial values in app/more/page.tsx.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const [engineer, tradingRow] = await Promise.all([
    prisma.engineer.findUnique({ where: { id: engineerId } }),
    prisma.engineerTradingAddress.findUnique({ where: { engineerId } }),
  ]);
  if (!engineer) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const trading = tradingAddressOf(tradingRow, engineer.packAddress);
  const registeredOffice =
    engineer.businessType === "ltd" && engineer.companyNumber
      ? ((await companyProfile(engineer.companyNumber))?.registeredOffice ?? null)
      : null;

  // Review 4 — a company that left its trading name blank trades under its
  // Companies House name, which is stored as the trading name. Show the box
  // blank (that name is its placeholder) rather than "filled in".
  const tradesUnderLegalName =
    engineer.businessType !== "sole_trader" &&
    Boolean(engineer.legalName) &&
    engineer.tradingName?.trim() === engineer.legalName?.trim();

  return NextResponse.json({
    tradingName: tradesUnderLegalName ? "" : (engineer.tradingName ?? ""),
    logoUrl: engineer.logoUrl ?? "",
    slug: engineer.slug,
    firstName: engineer.firstName,
    lastName: engineer.lastName,
    phone: engineer.phone,
    smsSignInEnabled: engineer.smsSignInEnabled,
    slugChosen: Boolean(engineer.slugChosenAt),
    smsAvailable: smsAvailable(),
    // Installer messages on WhatsApp — the switch only shows once the
    // automated number is set up.
    whatsappAvailable: whatsappConfigured() && Boolean(engineer.phone),
    whatsappUpdates: Boolean(engineer.whatsappOptInAt),
    phoneVerifiedAt: engineer.phoneVerifiedAt,
    businessType: engineer.businessType,
    companyNumber: engineer.companyNumber,
    legalName: engineer.legalName,
    vatRegistered: engineer.vatRegistered,
    postcode: engineer.postcode,
    // 30 Oct 3.6 — the registered office, for limited companies only, comes
    // from Companies House each time (never stored, lib/addresses.ts).
    registeredOffice,
    // Review 4 — where the member pack goes, with Change on Account.
    packAddress: engineer.packAddress,
    packShipped: Boolean(engineer.packShippedAt),
    setupTextConsent: Boolean(engineer.setupTextConsentAt),
    gasSafeCardExpiresOn: engineer.gasSafeCardExpiresOn?.toISOString().slice(0, 10) ?? null,
    // Trading sets the town and town page; correspondence is where the pack
    // and all post go (lib/addresses.ts). Changed with PUT /api/settings/addresses.
    addresses: {
      trading: trading && { lines: trading.lines, town: trading.town, postcode: trading.postcode },
      correspondence: engineer.packAddress,
      correspondenceSameAsTrading: !engineer.packAddress || (trading ? sameAddress(engineer.packAddress, formatAddress(trading)) : false),
    },
    // Part 6.4/17.3 — the same truth source the dashboard strip and Payouts'
    // banner read. `standing` is the collapsed single-line ladder (used only
    // when banned/paused outranks everything else); `gasSafe`/`payments` are
    // Part 13's two independent status lines.
    standing: standingCopy(engineer),
    gasSafe: gasSafeStatus(engineer),
    gasSafePhotoNeeded: !engineer.gasSafeVerifiedAt && !engineer.gasSafeCardUrl,
    payments: paymentsStatus(engineer),
  });
}

export async function PATCH(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    const messages: Record<string, string> = {
      firstName: "Enter your first name.",
      lastName: "Enter your last name.",
      tradingName: "Enter your trading name — at least 2 characters.",
    };
    return NextResponse.json({ error: messages[field] ?? "Check the form and try again." }, { status: 400 });
  }

  let tradingName = parsed.data.tradingName;
  if (tradingName.length < 2) {
    const current = await prisma.engineer.findUnique({
      where: { id: engineerId },
      select: { legalName: true, businessType: true },
    });
    const legal = current?.businessType !== "sole_trader" ? current?.legalName?.trim() : null;
    if (!legal) {
      return NextResponse.json({ error: "Enter your trading name — at least 2 characters." }, { status: 400 });
    }
    tradingName = legal;
  }
  // Review 4 — once the engineer has chosen their address, renaming the
  // business never moves it; before that it follows the name and the old
  // address keeps redirecting.
  const current = await prisma.engineer.findUniqueOrThrow({
    where: { id: engineerId },
    select: { slug: true, previousSlugs: true, slugChosenAt: true },
  });
  const address = current.slugChosenAt
    ? { slug: current.slug }
    : moveSlug(current, await uniqueSlug(tradingName, engineerId));
  await prisma.engineer.update({
    where: { id: engineerId },
    data: {
      tradingName,
      ...(parsed.data.firstName ? { firstName: parsed.data.firstName } : {}),
      ...(parsed.data.lastName ? { lastName: parsed.data.lastName } : {}),
      logoUrl: parsed.data.logoUrl || null,
      ...address,
      ...(parsed.data.setupTextConsent === undefined ? {} : { setupTextConsentAt: parsed.data.setupTextConsent ? new Date() : null }),
    },
  });
  return NextResponse.json({ ok: true, slug: address.slug, tradingName });
}
