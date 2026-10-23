"use client";

import { useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Card, btnClass } from "@/components/ui";

type Props = {
  code: string;
  firstName: string;
  brand: string;
  amountLabel: string;
  planName: string | null;
  engineerPhone: string | null;
  portalToken: string;
};

// Retention spec §3 — one step: the customer's new bank details become a new
// Bacs Direct Debit, and the missed payment is collected again from it.
export function RescueForm(props: Props) {
  const [started, setStarted] = useState<{ clientSecret: string; publishableKey: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/u/${props.code}/setup`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "That didn't work. Try again in a minute.");
      return;
    }
    setStarted(data);
  }

  if (done) {
    return (
      <Card className="text-center py-6">
        <div className="text-2xl">✓</div>
        <p className="font-semibold mt-1">Thanks, {props.firstName}. Your new Direct Debit is set up</p>
        <p className="text-xs text-muted mt-1">
          We&apos;ll collect the {props.amountLabel} in the next few working days and your plan with {props.brand}{" "}
          carries on as normal. You can close this page.
        </p>
        <a href={`/portal/${props.portalToken}`} className="underline text-sm mt-3 inline-block">
          View my plan
        </a>
      </Card>
    );
  }

  return (
    <>
      <div>
        <h1 className="font-semibold text-lg">Hi {props.firstName}, let&apos;s get your plan back on track</h1>
        <p className="text-sm text-muted mt-1">
          Your {props.amountLabel} payment to {props.brand}{" "}didn&apos;t go through. Add your bank details below and
          your {props.planName ? `${props.planName} plan` : "plan"} carries on as normal.
        </p>
      </div>
      {started ? (
        <RescueElements {...props} {...started} onDone={() => setDone(true)} />
      ) : (
        <>
          {error && <p className="text-sm text-danger">{error}</p>}
          <button onClick={start} disabled={busy} className={btnClass()}>
            {busy ? "Opening secure Direct Debit setup…" : "Update my bank details"}
          </button>
        </>
      )}
      {props.engineerPhone && (
        <p className="text-center text-xs text-muted">
          Any questions? Call {props.brand} on{" "}
          <a href={`tel:${props.engineerPhone.replace(/\s/g, "")}`} className="underline">
            {props.engineerPhone}
          </a>
        </p>
      )}
    </>
  );
}

function RescueElements(props: Props & { clientSecret: string; publishableKey: string; onDone: () => void }) {
  const stripePromise = useMemo(() => loadStripe(props.publishableKey), [props.publishableKey]);
  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret: props.clientSecret,
        // Same treatment as the sign-up checkout (components/embedded-checkout.tsx).
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
      <RescueConfirm {...props} />
    </Elements>
  );
}

function RescueConfirm(props: Props & { onDone: () => void }) {
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
    const { error: confirmError, setupIntent } = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: "if_required",
    });
    if (confirmError) {
      setBusy(false);
      setError(confirmError.message ?? "That didn't go through. Please try again.");
      return;
    }
    if (setupIntent) {
      await fetch(`/api/u/${props.code}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupIntentId: setupIntent.id }),
      }).catch(() => {});
    }
    props.onDone();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-sm font-semibold">Direct Debit details</p>
      <PaymentElement options={{ layout: "tabs" }} />
      <label className="flex gap-2 text-xs text-muted items-start">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[#5FA3F0]"
        />
        I agree to the Direct Debit mandate.
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={busy || !agreed || !stripe} className={btnClass()}>
        {busy ? "Setting up your Direct Debit…" : `Set up Direct Debit and pay ${props.amountLabel}`}
      </button>
    </form>
  );
}
