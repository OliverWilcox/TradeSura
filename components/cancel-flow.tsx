"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, btnClass } from "@/components/ui";

// Two taps, honestly counted: tap 1 = "Cancel my plan", tap 2 = "Yes, cancel".
// Save-flow offers (pause/downgrade) are P1 and deliberately not built.
export function CancelFlow(props: {
  token: string;
  status: string;
  tierName: string;
  priceLabel: string;
  coolingOffEndsAt: string | null;
}) {
  const [step, setStep] = useState<"start" | "confirm" | "done">(
    props.status === "CANCELLED" ? "done" : "start",
  );
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const inCoolingOff =
    props.coolingOffEndsAt !== null && new Date(props.coolingOffEndsAt) > new Date();

  const REASONS = ["Moving house", "Cost", "Not using it", "Other"];

  async function cancel() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/portal/${props.token}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Could not cancel — try again.");
      return;
    }
    setStep("done");
  }

  if (step === "done") {
    return (
      <>
        <Card className="text-center py-6">
          <p className="font-semibold">Your plan is cancelled</p>
          <p className="text-xs text-muted mt-1.5">
            No more payments will be collected. A confirmation email is on its way.
          </p>
        </Card>
        <Link href={`/portal/${props.token}`} className={btnClass("ghost")}>
          Back to my plan
        </Link>
      </>
    );
  }

  return (
    <>
      <Card>
        <p className="text-sm">
          You&apos;re on the <b>{props.tierName}</b> plan at{" "}
          <b className="font-mono">{props.priceLabel}/mo</b>.
        </p>
        {inCoolingOff && (
          <p className="text-xs text-muted mt-2">
            You&apos;re inside your 14-day cooling-off period — cancelling now means a full refund
            of any payment already taken.
          </p>
        )}
      </Card>

      {step === "start" ? (
        <button onClick={() => setStep("confirm")} className={btnClass("dangerghost")}>
          Cancel my plan
        </button>
      ) : (
        <Card className="border-danger-tint">
          <p className="text-sm mb-2">
            Cancel your {props.tierName} plan? Your Direct Debit stops immediately.
          </p>
          <p className="text-xs text-muted mb-1.5">Mind telling us why? (optional)</p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {REASONS.map((r) => (
              <button
                key={r}
                onClick={() => setReason(reason === r ? null : r)}
                className={`text-xs rounded-full border px-2.5 py-1 ${
                  reason === r ? "border-flame bg-flame-tint text-flame-deep" : "border-line text-muted"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          {error && <p className="text-sm text-danger mb-2">{error}</p>}
          <button onClick={cancel} disabled={busy} className={btnClass("dangerghost")}>
            {busy ? "Cancelling…" : "Yes, cancel my plan"}
          </button>
          <button onClick={() => setStep("start")} className={`${btnClass("ghost")} mt-2`}>
            Keep my plan
          </button>
        </Card>
      )}
      <p className="font-mono text-[10px] text-faint text-center">
        Cancelling takes two taps and confirms by email. No phone calls, no hoops.
      </p>
    </>
  );
}
