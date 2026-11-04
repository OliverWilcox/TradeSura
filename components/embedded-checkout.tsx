"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { loadStripe } from "@stripe/stripe-js";
import { EmbeddedCheckoutProvider, EmbeddedCheckout as StripeEmbeddedCheckout } from "@stripe/react-stripe-js";
import { AddressLookup, type AddressValue } from "@/components/address-lookup";
import { Card, btnClass } from "@/components/ui";
import { perMonth } from "@/lib/engineer";
import { FIRST_PAYMENT_LINE, type BillingInterval } from "@/lib/billing-interval";
import { TextMeLink } from "@/components/signup-extras";

// 30 Oct update §7.8 — start-date wording, not a trial: "First payment £X
// around [date], after your 14-day cooling-off". The date is the earliest it
// can be: the cooling-off restarts when the Direct Debit is confirmed (2–3
// working days), so it can move a few days later, never earlier.
function firstPaymentLine(priceLabel: string, firstPaymentAt?: string) {
  const d = firstPaymentAt ? new Date(firstPaymentAt) : null;
  if (!d || Number.isNaN(d.getTime())) return FIRST_PAYMENT_LINE;
  const when = d.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "Europe/London" });
  return `First payment ${priceLabel} around ${when}, after your 14-day cooling-off.`;
}
import { CP12_COPY, cp12Date } from "@/lib/cp12";

// "£12 a month" / "£132 a year" — priceLabel is already the full amount of
// one collection for the chosen interval.
function priceFor(priceLabel: string, interval: BillingInterval | undefined, vat?: boolean, monthlyPlain?: string) {
  if (interval === "year") return `${priceLabel} a year${vat ? " including VAT" : ""}`;
  return perMonth(priceLabel, vat, monthlyPlain);
}

// C2 — the Bacs Direct Debit step, on the engineer's white-label page. Our
// part first (address, the plan summary with the full price, the terms and
// landlord ticks), then Stripe's embedded Checkout collects the bank details
// and the mandate in place. Retention spec §1: the subscription starts with
// a 14-day cooling-off trial, so nothing is taken today. Checkout sends the
// customer to the confirmed page when they finish.
function CheckoutForm({
  clientSecret,
  publishableKey,
  billingInterval,
  signupToken,
  planName,
  priceLabel,
  engineerName,
  vatRegistered,
  landlord,
  cp12AvailableFrom,
  firstPaymentAt,
  initialAddress,
}: {
  clientSecret: string;
  publishableKey: string;
  billingInterval?: BillingInterval;
  signupToken: string;
  planName: string;
  priceLabel: string;
  engineerName: string;
  vatRegistered?: boolean;
  landlord?: boolean;
  cp12AvailableFrom?: string | null;
  firstPaymentAt?: string;
  initialAddress?: AddressValue | null;
}) {
  const stripePromise = useMemo(() => loadStripe(publishableKey), [publishableKey]);
  const [bankStep, setBankStep] = useState(false);
  const [address, setAddress] = useState<AddressValue>(initialAddress ?? { line1: "", town: "", postcode: "" });
  const [agreed, setAgreed] = useState(false);
  const [propertyLet, setPropertyLet] = useState(false);
  // Review 4 — CP12 plans: when the current gas safety record is due, and a
  // one-off CP12 if that's before the plan's own record is available.
  const [recordDue, setRecordDue] = useState("");
  const [oneOffCp12, setOneOffCp12] = useState(false);
  const coverFrom = cp12AvailableFrom ? new Date(cp12AvailableFrom) : null;
  const dueDate = recordDue ? new Date(`${recordDue}T12:00:00Z`) : null;
  const dueBeforeCover = Boolean(coverFrom && dueDate && !Number.isNaN(dueDate.getTime()) && dueDate < coverFrom);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/signup/${signupToken}/address`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(address),
      });
      if (!response.ok) {
        const data = await response.json();
        setError(data.error ?? "Couldn't save your address — please try again.");
        setBusy(false);
        return;
      }
    } catch {
      setError("Couldn't save your address — check your connection and try again.");
      setBusy(false);
      return;
    }

    // Review #18 — record which terms version they actually agreed to. The
    // checkbox already gates this button; this is what makes that agreement
    // a real record instead of just a UI gesture.
    const agreeRes = await fetch(`/api/signup/${signupToken}/agree-terms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyLet: landlord ? propertyLet : undefined,
        gasSafetyRecordDue: coverFrom ? recordDue : undefined,
        oneOffCp12: dueBeforeCover ? oneOffCp12 : undefined,
      }),
    });
    if (!agreeRes.ok) {
      const data = await agreeRes.json().catch(() => ({}));
      setBusy(false);
      setError(data.error ?? "Couldn't record your agreement — try again.");
      return;
    }

    setBusy(false);
    setBankStep(true);
  }

  if (bankStep) {
    return (
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="font-sans font-semibold text-lg">Your Direct Debit details</h2>
          <p className="text-sm text-muted">
            {planName} · {priceFor(priceLabel, billingInterval, vatRegistered)} · with {engineerName}. {firstPaymentLine(priceLabel, firstPaymentAt)}
          </p>
        </div>
        {/* Stripe's form, in place (sort code, account number, mandate). */}
        <div className="overflow-hidden rounded-2xl">
          <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret }}>
            <StripeEmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
        <button type="button" onClick={() => setBankStep(false)} className="text-sm text-muted underline">
          Back
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {/* Build Guide v2 Part 15.2 — title + sub-line. The sub-line carries the
          full monthly price before the mandate (CLAUDE.md compliance 2). */}
      <div>
        <h2 className="font-sans font-semibold text-lg">Set up your plan</h2>
        <p className="text-sm text-muted">
          {planName} · {priceFor(priceLabel, billingInterval, vatRegistered)} · with {engineerName}
        </p>
      </div>
      <AddressLookup signupToken={signupToken} value={address} onChange={setAddress} />

      <Card className="bg-flame-tint border-flame-tint text-[12.5px]">
        <b>Protected by the Direct Debit Guarantee.</b>{" "}
        {/* Part 18 pending line, verbatim. */}
        Your Direct Debit takes 2–3 days to set up. {firstPaymentLine(priceLabel, firstPaymentAt)}
      </Card>

      <Card className="text-[12.5px]">
        <div className="flex justify-between mb-1">
          <span className="text-muted">Plan</span>
          <b>
            {planName} — {engineerName}
          </b>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">You pay</span>
          <b className="font-mono">{priceFor(priceLabel, billingInterval, vatRegistered, " monthly")}</b>
        </div>
      </Card>

      {/* R9 — Landlord plans are for let properties. */}
      {landlord && (
        <label className="flex gap-2 text-xs text-muted items-start">
          <input
            type="checkbox"
            checked={propertyLet}
            onChange={(e) => setPropertyLet(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[#5FA3F0]"
          />
          This is a Landlord plan. I confirm the property is let to tenants.
        </label>
      )}

      {coverFrom && (
        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold" htmlFor="record-due">
            {CP12_COPY.question}
          </label>
          <input
            id="record-due"
            type="date"
            value={recordDue}
            onChange={(e) => setRecordDue(e.target.value)}
            className="min-h-[48px] rounded-[10px] border border-line bg-paper px-3.5 text-[16px] text-ink"
          />
          <p className="text-[11px] text-faint">{CP12_COPY.hint}</p>
          {dueBeforeCover && dueDate && (
            <Card className="border-warn bg-warn-tint text-[12.5px]">
              <p className="text-warn">{CP12_COPY.warning(cp12Date(dueDate), cp12Date(coverFrom))}</p>
              <label className="mt-2 flex gap-2 items-start text-ink">
                <input
                  type="checkbox"
                  checked={oneOffCp12}
                  onChange={(e) => setOneOffCp12(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#5FA3F0]"
                />
                {CP12_COPY.offer(engineerName, cp12Date(dueDate))}
              </label>
            </Card>
          )}
        </div>
      )}

      <label className="flex gap-2 text-xs text-muted items-start">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[#5FA3F0]"
        />
        I agree to the plan terms and the Direct Debit mandate.
      </label>

      {error && <p className="text-sm text-danger">{error}</p>}

      {/* Part 15.2 — one white button; green on this page is prices only. */}
      <button type="submit" disabled={busy || !agreed || (landlord && !propertyLet) || Boolean(coverFrom && !recordDue)} className={btnClass()}>
        {busy ? "One moment…" : `Join ${planName}`}
      </button>
      <TextMeLink token={signupToken} />
      <p className="text-center text-[11px] text-faint">Cancel any time. No contract.</p>
      {/* Build Review 3 §3 — the official "Powered by Stripe" badge, never
          typed text. White artwork: this page sits on dark navy (v2). */}
      <Image
        src="/brand/stripe/Powered_by_Stripe_white.svg"
        alt="Powered by Stripe"
        width={120}
        height={27}
        unoptimized
        className="mx-auto opacity-80"
      />
    </form>
  );
}

export function EmbeddedCheckout(props: {
  clientSecret: string;
  publishableKey: string;
  /** Checkout's return_url (set server-side) already points here. */
  confirmedUrl: string;
  planName: string;
  priceLabel: string;
  engineerName: string;
  signupToken: string;
  vatRegistered?: boolean;
  landlord?: boolean;
  cp12AvailableFrom?: string | null;
  billingInterval?: BillingInterval;
  firstPaymentAt?: string;
  /** The address the engineer typed when sending the offer, so the customer only checks it. */
  initialAddress?: AddressValue | null;
}) {
  return <CheckoutForm {...props} />;
}
