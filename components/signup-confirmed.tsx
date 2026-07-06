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
  const [portalToken, setPortalToken] = useState(props.portalToken);

  useEffect(() => {
    if (status === "ACTIVE") return;
    let stop = false;
    async function tick() {
      const res = await fetch(`/api/signup/${props.token}/status`);
      if (res.ok && !stop) {
        const data = await res.json();
        setStatus(data.status);
        if (data.portalToken) setPortalToken(data.portalToken);
        if (data.status === "ACTIVE") return;
      }
      if (!stop) setTimeout(tick, 2000);
    }
    tick();
    return () => {
      stop = true;
    };
  }, [props.token, status]);

  if (status !== "ACTIVE") {
    return (
      <Card className="text-center py-8">
        <div className="text-2xl animate-pulse">⏳</div>
        <p className="font-semibold mt-2">Setting up your Direct Debit…</p>
        <p className="text-xs text-muted mt-1">
          This usually takes a few seconds. Keep this page open.
        </p>
      </Card>
    );
  }

  const price = (props.priceMonthlyPence / 100).toFixed(2);
  return (
    <>
      <Card className="bg-ok-tint border-[#BCE6CF] text-center py-6">
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
