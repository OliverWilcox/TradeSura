"use client";

import { useCallback, useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
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
  const [started, setStarted] = useState<{ clientSecret: string; sessionId: string; publishableKey: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const finished = useCallback(() => setDone(true), []);

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
        <RescueElements {...props} {...started} onDone={finished} />
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

// Stripe's embedded Checkout (setup mode) collects the new bank details and
// mandate in place; on completion we finish the rescue straight away rather
// than wait for the webhook (which does the same, idempotently).
function RescueElements(props: Props & { clientSecret: string; sessionId: string; publishableKey: string; onDone: () => void }) {
  const stripePromise = useMemo(() => loadStripe(props.publishableKey), [props.publishableKey]);
  const { code, sessionId, onDone } = props;
  const options = useMemo(
    () => ({
      clientSecret: props.clientSecret,
      onComplete: () => {
        fetch(`/api/u/${code}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        })
          .catch(() => {})
          .finally(onDone);
      },
    }),
    [props.clientSecret, code, sessionId, onDone],
  );
  return (
    <div className="overflow-hidden rounded-2xl">
      <EmbeddedCheckoutProvider stripe={stripePromise} options={options}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
