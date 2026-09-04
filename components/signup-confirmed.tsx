"use client";

import { useEffect, useState } from "react";
import { Card, btnClass } from "@/components/ui";

export function SignupConfirmed(props: {
  token: string;
  tierName: string;
  priceMonthlyPence: number;
  initialStatus: string;
  portalToken: string | null;
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

  if (status !== "ACTIVE") {
    return (
      <Card className="text-center py-8">
        <div className="text-2xl">{mandatePending ? "✓" : "⏳"}</div>
        <p className="font-semibold mt-2">
          {mandatePending ? "You're in — Direct Debit is being set up" : "Setting up your Direct Debit…"}
        </p>
        <p className="text-xs text-muted mt-1">
          {mandatePending
            ? "This takes 2–3 working days. Your engineer has been told, and we'll text you when your first payment clears. You can close this page."
            : "This usually takes a few seconds. Keep this page open."}
        </p>
      </Card>
    );
  }

  const price = (props.priceMonthlyPence / 100).toFixed(2);
  return (
    <>
      <Card className="bg-ok-tint border-ok-tint text-center py-6">
        <div className="text-3xl">✓</div>
        <p className="font-semibold mt-1">You&apos;re covered on the {props.tierName} plan</p>
        <p className="text-xs text-muted mt-1">£{price}/mo by Direct Debit</p>
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
    </>
  );
}
