import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { brandName, tradingNameOf } from "@/lib/engineer";
import { isValidStickerCode, normaliseStickerCode } from "@/lib/stickers";
import { loadPassportView } from "@/lib/passport";
import { CustomerShell } from "@/components/shells";
import { Card, btnClass } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Boiler service history", robots: { index: false } };

const monthYear = (d: Date) => d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

// Section 4 — what a scan of the boiler sticker shows (usually the next
// owner). Deliberately no address and no personal data: just who looks
// after the boiler, when it was last serviced, and a way to join.
export default async function StickerPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = normaliseStickerCode(decodeURIComponent(raw));
  const sticker = isValidStickerCode(code)
    ? await prisma.sticker.findUnique({
        where: { code },
        include: { engineer: { select: { id: true, slug: true, tradingName: true, legalName: true } } },
      })
    : null;

  if (!sticker) {
    return (
      <CustomerShell tradingName="TradeSura" sub={`Sticker ${code}`}>
        <Card>
          <p className="font-semibold">We don&apos;t recognise this sticker</p>
          <p className="text-sm text-muted mt-1">
            Check the code printed under the QR. If you own the home, you can also{" "}
            <Link href="/passport/find" className="underline">
              find its Home Passport by postcode
            </Link>
            .
          </p>
        </Card>
      </CustomerShell>
    );
  }

  await prisma.sticker.update({ where: { code }, data: { scans: { increment: 1 } } }).catch(() => {});

  const view = sticker.passportId ? await loadPassportView({ id: sticker.passportId }) : null;
  const engineer = view?.lookedAfterBy[0] ?? view?.lead ?? sticker.engineer;
  const brand = engineer ? brandName(engineer) : "TradeSura";

  if (!view) {
    return (
      <CustomerShell tradingName={brand} legalLine={engineer ? tradingNameOf(engineer) : null} sub={`Sticker ${code}`}>
        <Card>
          <p className="font-semibold">This sticker isn&apos;t linked to a boiler yet</p>
          <p className="text-sm text-muted mt-1">
            {engineer
              ? `It's from ${brand}'s pack. Once they link it at a service, scanning it shows the boiler's service history.`
              : "Once an engineer links it at a service, scanning it shows the boiler's service history."}
          </p>
        </Card>
        {engineer && (
          <Link href={`/p/${engineer.slug}`} className={btnClass()}>
            See {brand}&apos;s care plans
          </Link>
        )}
      </CustomerShell>
    );
  }

  const live = view.state === "LIVE" && view.lookedAfterBy.length > 0;
  const lastServiced = view.lastService?.doneAt ?? view.boiler?.lastServicedAt ?? null;

  return (
    <CustomerShell tradingName={brand} legalLine={engineer ? tradingNameOf(engineer) : null} sub={`Boiler sticker ${code}`}>
      <Card className="text-center py-5">
        <p className="text-lg font-semibold">
          {live ? `This boiler is looked after by ${brand}.` : `This boiler was looked after by ${brand}.`}
        </p>
        <p className="text-sm text-muted mt-1.5">
          {lastServiced ? `Last serviced ${monthYear(lastServiced)}.` : "No service logged yet."}
        </p>
      </Card>
      {engineer && (
        <Link href={`/p/${engineer.slug}`} className={btnClass()}>
          Join {brand}&apos;s care plan
        </Link>
      )}
      <p className="text-xs text-muted text-center">
        Just moved in? The boiler&apos;s full service history stays with the home. Ask {brand} for access,
        or{" "}
        <Link href="/passport/find" className="underline">
          find it by postcode
        </Link>
        .
      </p>
    </CustomerShell>
  );
}
