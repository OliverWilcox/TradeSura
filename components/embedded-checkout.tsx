"use client";

import { useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Card, btnClass } from "@/components/ui";

// C2 — the embedded Bacs Direct Debit form. Stays on the engineer's
// white-label page; the Payment Element collects name / sort code / account
// number and the mandate, then the first collection processes async.
function CheckoutForm({
  signupToken,
  confirmedUrl,
  planName,
  priceLabel,
  engineerName,
}: {
  signupToken: string;
  confirmedUrl: string;
  planName: string;
  priceLabel: string;
  engineerName: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);

    const { error: submitError } = await elements.submit();
    if (submitError) {
      setBusy(false);
      setError(submitError.message ?? "Check your details and try again.");
      return;
    }

    // Review #18 — record which terms version they actually agreed to. The
    // checkbox already gates this button; this is what makes that agreement
    // a real record instead of just a UI gesture.
    const agreeRes = await fetch(`/api/signup/${signupToken}/agree-terms`, { method: "POST" });
    if (!agreeRes.ok) {
      setBusy(false);
      setError("Couldn't record your agreement — try again.");
      return;
    }

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: confirmedUrl },
      redirect: "if_required",
    });

    if (confirmError) {
      setBusy(false);
      setError(confirmError.message ?? "Something went wrong — try again.");
      return;
    }
    // Bacs confirms inline (no redirect) — send them to the confirmation page.
    window.location.assign(confirmedUrl);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-sm font-semibold">Direct Debit details</p>
      <PaymentElement options={{ layout: "tabs" }} />

      <Card className="bg-flame-tint border-flame-tint text-[12.5px]">
        <b>Protected by the Direct Debit Guarantee.</b>{" "}
        Your first collection is a few working
        days after you join, then monthly. You&apos;ll get 3 days&apos; notice of any change, and
        you can cancel anytime.
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
          <b className="font-mono">{priceLabel} monthly</b>
        </div>
      </Card>

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

      <button type="submit" disabled={busy || !agreed || !stripe} className={btnClass("green")}>
        {busy ? "Setting up your Direct Debit…" : `Confirm and join — ${priceLabel}/month`}
      </button>
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
      />
    </Elements>
  );
}
