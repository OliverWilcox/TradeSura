import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { brandName, tradingNameOf } from "@/lib/engineer";
import { RECORD_KIND_LABEL, loadPassportView } from "@/lib/passport";
import { CustomerShell } from "@/components/shells";
import { Card, Micro, Pill, btnClass } from "@/components/ui";
import { setContactConsent } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Home Passport", robots: { index: false } };

const monthYear = (d: Date) => d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const dayMonthYear = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// Section 4 — the homeowner's view: the whole history of the home, from
// every engineer, behind the private link only the homeowner holds.
export default async function PassportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await loadPassportView({ viewToken: token });
  if (!view) notFound();
  const { passport, state, lookedAfterBy, lead, boiler, nextDueAt } = view;
  const brand = lead ? brandName(lead) : "Your home";
  const boilerName = [boiler?.make, boiler?.model].filter(Boolean).join(" ");
  const carers = lookedAfterBy.map((e) => brandName(e)).join(" and ");

  return (
    <CustomerShell
      tradingName={brand}
      legalLine={lead ? tradingNameOf(lead) : null}
      sub={[passport.addressLine1, passport.town].filter(Boolean).join(", ")}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-lg leading-tight">
            {[passport.addressLine1, passport.town].filter(Boolean).join(", ")}
          </p>
          <p className="text-sm text-muted">Home Passport</p>
        </div>
        {state === "LIVE" ? <Pill tone="info">LIVE</Pill> : <Pill tone="off">FROZEN</Pill>}
      </div>

      {state === "FROZEN" && (
        <Card>
          <p className="text-sm">
            There&apos;s no active plan on this home, so nothing new is being added. Every past record
            is kept and you can still view and download it.
          </p>
        </Card>
      )}

      <Card>
        <Micro>Boiler</Micro>
        <p className="font-semibold mt-1">{boilerName || boiler?.type || "Boiler"}</p>
        <p className="text-xs text-muted mt-0.5">
          {boiler?.installedAt ? `Fitted ${monthYear(boiler.installedAt)}` : "Fitted date not recorded"}
          {carers ? ` · looked after by ${carers}` : ""}
        </p>
        {boiler && boiler.photoUrls.length > 0 && (
          <div className="flex gap-2 mt-2.5">
            {boiler.photoUrls.map((u) => (
              <a key={u} href={u} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="Boiler" className="w-16 h-16 object-cover rounded-lg border border-line" />
              </a>
            ))}
          </div>
        )}
        {nextDueAt && (
          <p className="text-sm mt-3">
            Next service due: <b>{monthYear(nextDueAt)}</b>
          </p>
        )}

        <div className="mt-3">
          {passport.records.length === 0 ? (
            <p className="text-xs text-muted">No records yet — your first service will appear here.</p>
          ) : (
            passport.records.map((r) => (
              <details key={r.id} className="border-b border-line-soft last:border-b-0 py-2">
                <summary className="text-sm cursor-pointer list-none">
                  <span className="text-ink font-bold mr-1.5">✓</span>
                  {RECORD_KIND_LABEL[r.kind] ?? r.kind} · {dayMonthYear(r.doneAt)} ·{" "}
                  <span className="text-muted">{r.photoUrls.length ? "record + photos" : "record"}</span>
                </summary>
                <div className="pl-5 pt-1.5 text-xs text-muted space-y-1.5">
                  <p>By {brandName(r.engineer)}</p>
                  {r.notes && <p className="text-ink whitespace-pre-line">{r.notes}</p>}
                  {r.nextDueAt && <p>Next due {monthYear(r.nextDueAt)}</p>}
                  {r.photoUrls.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {r.photoUrls.map((u) => (
                        <a key={u} href={u} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={u} alt="Service photo" className="w-16 h-16 object-cover rounded-lg border border-line" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            ))
          )}
        </div>
      </Card>

      <Card>
        <Micro>Electrics</Micro>
        <p className="font-semibold mt-1">No plan yet</p>
        <p className="text-xs text-muted mt-0.5">TradeSura electricians are coming soon.</p>
      </Card>

      <Link href={`/passport/${token}/records`} className={btnClass()}>
        Download my records
      </Link>
      <p className="text-sm text-center">Your home&apos;s history stays with it when you sell.</p>

      <Card>
        <form action={setContactConsent} className="space-y-2.5">
          <input type="hidden" name="token" value={token} />
          <label className="flex gap-2.5 items-start text-sm">
            <input type="checkbox" name="consent" defaultChecked={Boolean(passport.contactConsentAt)} className="mt-1" />
            <span>
              {carers || brand} can contact me about my home — for example when the boiler is getting old
              or a part needs attention.
            </span>
          </label>
          <button type="submit" className={btnClass("ghost")}>
            Save my choice
          </button>
          <p className="text-[11px] text-muted">
            You can change this any time. See our{" "}
            <Link href="/privacy" className="underline">
              privacy notice
            </Link>
            .
          </p>
        </form>
      </Card>
    </CustomerShell>
  );
}
