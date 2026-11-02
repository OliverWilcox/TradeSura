"use client";

import { useEffect, useState } from "react";
import { Card, btnClass } from "@/components/ui";
import { FIRST_PAYMENT_LINE, addMonths, priceLine } from "@/lib/billing-interval";

const longDate = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "Europe/London" });

// 30 Oct update §7.9 — the confirmation: the engineer's photo, next steps
// with real dates, refer a neighbour, and the Home Passport and manage links.
export type ConfirmedExtras = {
  engineer: { brand: string; firstName: string | null; photoUrl: string | null };
  /** End of the 14-day cooling-off. */
  coolingOffEndsAt: string | null;
  /** When the first collection is due (later than cooling-off with a free month). */
  firstPaymentAt: string | null;
  yearly: boolean;
  /** Whether the plan includes the annual service (bookable after the 3rd payment). */
  annualService: boolean;
  /** The engineer's page with ?nref= — a neighbour's first month free. */
  referUrl: string | null;
  passportUrl: string | null;
};

export function SignupConfirmed(props: {
  token: string;
  tierName: string;
  priceMonthlyPence: number;
  vatRegistered?: boolean;
  billingInterval?: string;
  initialStatus: string;
  portalToken: string | null;
  extras?: ConfirmedExtras;
}) {
  const [status, setStatus] = useState(props.initialStatus);
  const [mandatePending, setMandatePending] = useState(false);
  const [portalToken, setPortalToken] = useState(props.portalToken);

  useEffect(() => {
    if (status === "ACTIVE") return;
    let stop = false;
    async function tick() {
      const res = await fetch(`/api/signup/${props.token}/status`);
      if (res.ok && !stop) {
        const data = await res.json();
        setStatus(data.status);
        setMandatePending(data.mandate === "pending");
        if (data.portalToken) setPortalToken(data.portalToken);
        if (data.status === "ACTIVE") return;
      }
      // Poll faster before the mandate exists, then back off — Bacs settlement
      // is measured in days, not seconds.
      if (!stop) setTimeout(tick, mandatePending ? 15000 : 2500);
    }
    tick();
    return () => {
      stop = true;
    };
  }, [props.token, status, mandatePending]);

  const extras = props.extras ? (
    <ConfirmedNextSteps extras={props.extras} portalToken={portalToken} active={status === "ACTIVE"} />
  ) : null;

  if (status !== "ACTIVE") {
    return (
      <>
      <Card className="text-center py-8">
        <div className="text-2xl">{mandatePending ? "✓" : "⏳"}</div>
        <p className="font-semibold mt-2">
          {mandatePending ? "You're in — Direct Debit is being set up" : "Setting up your Direct Debit…"}
        </p>
        <p className="text-xs text-muted mt-1">
          {mandatePending
            ? `This takes 2–3 working days. Your engineer has been told. ${FIRST_PAYMENT_LINE} You can close this page.`
            : "This usually takes a few seconds. Keep this page open."}
        </p>
      </Card>
      {mandatePending && extras}
      </>
    );
  }

  return (
    <>
      <Card className="bg-ok-tint border-ok-tint text-center py-6">
        <div className="text-3xl">✓</div>
        <p className="font-semibold mt-1">You&apos;re on the {props.tierName} plan</p>
        <p className="text-xs text-muted mt-1">
          {priceLine(props.priceMonthlyPence, props.billingInterval, props.vatRegistered)} by Direct Debit
        </p>
        <p className="text-xs text-muted mt-1">{FIRST_PAYMENT_LINE}</p>
      </Card>
      <Card>
        <p className="text-sm">
          Your plan document is on its way to your email. You have a <b>14-day cooling-off
          period</b> — cancel any time in two taps from your plan page, no phone calls, no hoops.
        </p>
      </Card>
      {portalToken && (
        <a href={`/portal/${portalToken}`} className={btnClass()}>
          View my plan
        </a>
      )}
      {extras}
    </>
  );
}

function ConfirmedNextSteps({
  extras,
  portalToken,
  active,
}: {
  extras: ConfirmedExtras;
  portalToken: string | null;
  active: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const first = extras.firstPaymentAt ? new Date(extras.firstPaymentAt) : null;
  const coolingOff = extras.coolingOffEndsAt ? new Date(extras.coolingOffEndsAt) : null;
  const firstName = extras.engineer.firstName?.trim();
  const who = firstName || extras.engineer.brand;
  const steps = [
    active ? "Your Direct Debit is set up." : "Your Direct Debit is being set up: 2–3 working days.",
    coolingOff ? `Your 14-day cooling-off ends around ${longDate(coolingOff)}. Cancel before then and you pay nothing.` : null,
    first ? `First payment around ${longDate(first)}, then ${extras.yearly ? "yearly" : "monthly"}.` : FIRST_PAYMENT_LINE,
    extras.annualService && first
      ? `Your yearly service can be booked from around ${longDate(addMonths(first, 2))}, after your third payment. ${who} will be in touch to book it in.`
      : `${who} will be in touch about your first visit.`,
  ].filter((s): s is string => Boolean(s));

  async function share() {
    if (!extras.referUrl) return;
    const text = `I've joined ${extras.engineer.brand}'s boiler care plan. Join with my link and we both get a month free: ${extras.referUrl}`;
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Share sheet closed: nothing to do.
    }
  }

  return (
    <>
      <Card>
        <div className="flex items-center gap-3 mb-3">
          {extras.engineer.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- engineer's own photo from Blob
            <img src={extras.engineer.photoUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
          ) : (
            <div className="h-12 w-12 rounded-full bg-flame-tint text-flame font-bold text-lg flex items-center justify-center">
              {who.charAt(0).toUpperCase()}
            </div>
          )}
          <p className="text-sm">
            <b>{firstName ? `${firstName} · ${extras.engineer.brand}` : extras.engineer.brand}</b>
            <span className="block text-xs text-muted">Your engineer</span>
          </p>
        </div>
        <p className="text-sm font-semibold mb-1.5">What happens next</p>
        <ol className="space-y-1.5 text-[13px] text-muted list-decimal list-inside">
          {steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </Card>
      {extras.referUrl && (
        <Card>
          <p className="text-sm font-semibold">Refer a neighbour</p>
          <p className="text-[13px] text-muted mt-1">
            When a neighbour joins {extras.engineer.brand}&apos;s plan with your link, you both get a month free.
          </p>
          <button type="button" onClick={share} className={`${btnClass()} mt-3`}>
            {copied ? "Link copied" : "Share my link"}
          </button>
        </Card>
      )}
      {(extras.passportUrl || portalToken) && (
        <Card className="text-sm">
          {extras.passportUrl && (
            <a href={extras.passportUrl} className="block py-1.5 text-flame underline">
              Your Home Passport
            </a>
          )}
          {portalToken && (
            <a href={`/portal/${portalToken}/manage`} className="block py-1.5 text-flame underline">
              Manage my plan
            </a>
          )}
        </Card>
      )}
    </>
  );
}
