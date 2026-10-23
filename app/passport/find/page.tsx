import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import { addressKey, isUkPostcode, loadPassportView } from "@/lib/passport";
import { CustomerShell } from "@/components/shells";
import { Card, btnClass } from "@/components/ui";
import { requestPassportAccess } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Find a Home Passport | TradeSura",
  description: "Find your home's boiler service history by postcode.",
};

const monthYear = (d: Date) => d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "Europe/London" });
const input = "w-full border border-line rounded-[10px] px-3 py-2.5 text-sm bg-paper";

// Section 4 backup — find a passport without the sticker. The visitor has to
// know the address already (postcode + first line, matched exactly), and
// even then sees only non-personal facts: who looks after the boiler and
// when it was last serviced. Access to the records goes through the engineer.
export default async function FindPassportPage({
  searchParams,
}: {
  searchParams: Promise<{ postcode?: string; line1?: string; sent?: string; err?: string }>;
}) {
  const q = await searchParams;
  const postcode = q.postcode?.trim() ?? "";
  const line1 = q.line1?.trim() ?? "";
  const searched = Boolean(postcode && line1);
  const passport =
    searched && isUkPostcode(postcode)
      ? await prisma.homePassport.findUnique({ where: { addressKey: addressKey({ addressLine1: line1, postcode }) }, select: { id: true } })
      : null;
  const view = passport ? await loadPassportView({ id: passport.id }) : null;
  const engineer = view?.lookedAfterBy[0] ?? view?.lead ?? null;
  const brand = engineer ? brandName(engineer) : null;
  const lastServiced = view?.lastService?.doneAt ?? view?.boiler?.lastServicedAt ?? null;

  return (
    <CustomerShell tradingName="TradeSura" sub="Find a Home Passport">
      <Card>
        <h1 className="text-lg font-semibold">Find your home&apos;s passport</h1>
        <p className="text-xs text-muted mt-1">
          Every home looked after on TradeSura keeps its boiler&apos;s service history. Enter the address
          to see if yours has one.
        </p>
        <form method="get" className="space-y-2.5 mt-3">
          <input name="line1" defaultValue={line1} placeholder="First line, e.g. 12 Oak Road" className={input} required />
          <input name="postcode" defaultValue={postcode} placeholder="Postcode" className={input} required />
          <button type="submit" className={btnClass()}>
            Search
          </button>
        </form>
      </Card>

      {searched && !view && (
        <Card>
          <p className="font-semibold">No Home Passport found</p>
          <p className="text-xs text-muted mt-1">
            Check the first line is written the way your engineer has it (house number and street). If the
            boiler has a TradeSura sticker, scanning it is the quickest way in.
          </p>
        </Card>
      )}

      {view && (
        <Card>
          <p className="font-semibold">This home has a Home Passport</p>
          <p className="text-sm mt-1">
            {brand ? `The boiler is ${view.state === "LIVE" ? "looked after" : "was looked after"} by ${brand}.` : ""}{" "}
            {lastServiced ? `Last serviced ${monthYear(lastServiced)}.` : ""}
          </p>
          {q.sent ? (
            <p className="text-sm mt-3 text-flame font-semibold">
              Request sent. {brand ?? "The engineer"} will check with the homeowner and get back to you.
            </p>
          ) : (
            <form action={requestPassportAccess} className="space-y-2.5 mt-3">
              <p className="text-xs text-muted">
                The records belong to the home. To see them, ask {brand ?? "the engineer"} — they&apos;ll
                check with the homeowner first.
              </p>
              <input type="hidden" name="postcode" value={postcode} />
              <input type="hidden" name="line1" value={line1} />
              <input name="name" placeholder="Your name" className={input} required minLength={2} />
              <input name="contact" placeholder="Your mobile or email" className={input} required minLength={5} />
              {q.err === "2" ? (
                <p className="text-xs text-danger">Too many requests just now. Please try again in an hour.</p>
              ) : (
                q.err && <p className="text-xs text-danger">Add your name and a mobile or email.</p>
              )}
              <button type="submit" className={btnClass("ghost")}>
                Request access
              </button>
            </form>
          )}
          {engineer && (
            <Link href={`/p/${engineer.slug}`} className="block text-center text-xs underline mt-3">
              See {brand}&apos;s care plans
            </Link>
          )}
        </Card>
      )}
    </CustomerShell>
  );
}
