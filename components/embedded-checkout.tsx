"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { loadStripe } from "@stripe/stripe-js";
import { EmbeddedCheckoutProvider, EmbeddedCheckout as StripeEmbeddedCheckout } from "@stripe/react-stripe-js";
import { AddressLookup, type AddressValue } from "@/components/address-lookup";
import { Card, btnClass } from "@/components/ui";
import { perMonth } from "@/lib/engineer";
import { FIRST_PAYMENT_LINE, type BillingInterval } from "@/lib/billing-interval";

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
}) {
  const stripePromise = useMemo(() => loadStripe(publishableKey), [publishableKey]);
  const [bankStep, setBankStep] = useState(false);
  const [address, setAddress] = useState<AddressValue>({ line1: "", town: "", postcode: "" });
  const [agreed, setAgreed] = useState(false);
  const [propertyLet, setPropertyLet] = useState(false);
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
      body: JSON.stringify({ propertyLet: landlord ? propertyLet : undefined }),
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
            {planName} · {priceFor(priceLabel, billingInterval, vatRegistered)} · with {engineerName}. {FIRST_PAYMENT_LINE}
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
        Your Direct Debit takes 2–3 days to set up. {FIRST_PAYMENT_LINE}
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
      <button type="submit" disabled={busy || !agreed || (landlord && !propertyLet)} className={btnClass()}>
        {busy ? "One moment…" : "Continue to Direct Debit"}
      </button>
      <p className="text-center text-[11px] text-faint">Cancel anytime.</p>
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
  billingInterval?: BillingInterval;
}) {
  return <CheckoutForm {...props} />;
}
