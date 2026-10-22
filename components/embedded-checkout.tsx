"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { AddressLookup, type AddressValue } from "@/components/address-lookup";
import { Card, btnClass } from "@/components/ui";
import { perMonth } from "@/lib/engineer";

// C2 — the embedded Bacs Direct Debit form. Stays on the engineer's
// white-label page; the Payment Element collects name / sort code / account
// number and the mandate, then the first collection processes async.
function CheckoutForm({
  signupToken,
  confirmedUrl,
  planName,
  priceLabel,
  engineerName,
  vatRegistered,
  landlord,
}: {
  signupToken: string;
  confirmedUrl: string;
  planName: string;
  priceLabel: string;
  engineerName: string;
  vatRegistered?: boolean;
  landlord?: boolean;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [address, setAddress] = useState<AddressValue>({ line1: "", town: "", postcode: "" });
  const [agreed, setAgreed] = useState(false);
  const [propertyLet, setPropertyLet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
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

    const { error: submitError } = await elements.submit();
    if (submitError) {
      setBusy(false);
      setError(submitError.message ?? "Check your details and try again.");
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

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: confirmedUrl },
      redirect: "if_required",
    });

    if (confirmError) {
      setBusy(false);
      setError(confirmError.message ?? "That didn't go through. Please try again — if it keeps happening, contact your engineer.");
      return;
    }
    // Bacs confirms inline (no redirect) — send them to the confirmation page.
    window.location.assign(confirmedUrl);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {/* Build Guide v2 Part 15.2 — title + sub-line. The sub-line carries the
          full monthly price before the mandate (CLAUDE.md compliance 2). */}
      <div>
        <h2 className="font-sans font-semibold text-lg">Set up your plan</h2>
        <p className="text-sm text-muted">
          {planName} · {perMonth(priceLabel, vatRegistered)} · with {engineerName}
        </p>
      </div>
      <AddressLookup signupToken={signupToken} value={address} onChange={setAddress} />
      <p className="text-sm font-semibold">Direct Debit details</p>
      <PaymentElement options={{ layout: "tabs" }} />

      <Card className="bg-flame-tint border-flame-tint text-[12.5px]">
        <b>Protected by the Direct Debit Guarantee.</b>{" "}
        {/* Part 18 pending line, verbatim. */}
        Your Direct Debit takes 2–3 days to set up. First payment as soon as your Direct Debit is
        live — we&apos;ll text you before it&apos;s taken.
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
          <b className="font-mono">{perMonth(priceLabel, vatRegistered, " monthly")}</b>
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
      <button type="submit" disabled={busy || !agreed || (landlord && !propertyLet) || !stripe} className={btnClass()}>
        {busy ? "Setting up your Direct Debit…" : "Set up my plan"}
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
  confirmedUrl: string;
  planName: string;
  priceLabel: string;
  engineerName: string;
  signupToken: string;
  vatRegistered?: boolean;
  landlord?: boolean;
}) {
  const stripePromise = useMemo(
    () => loadStripe(props.publishableKey),
    [props.publishableKey],
  );

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret: props.clientSecret,
        // The page around this is dark navy (v2) — Stripe's light "stripe"
        // theme would float as a bright white box, so start from "night" and
        // match our exact tokens rather than its defaults.
        appearance: {
          theme: "night",
          variables: {
            colorPrimary: "#5FA3F0",
            colorBackground: "#193150",
            colorText: "#F3F7FB",
            colorTextSecondary: "#9FB6D0",
            colorDanger: "#FF6B6B",
            borderRadius: "12px",
          },
        },
      }}
    >
      <CheckoutForm
        signupToken={props.signupToken}
        confirmedUrl={props.confirmedUrl}
        planName={props.planName}
        priceLabel={props.priceLabel}
        engineerName={props.engineerName}
        landlord={props.landlord}
        vatRegistered={props.vatRegistered}
      />
    </Elements>
  );
}
