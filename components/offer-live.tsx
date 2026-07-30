"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, Micro, Money, btnClass } from "@/components/ui";

type Status = {
  status: "PENDING" | "ACTIVE" | "PAUSED" | "CANCELLED";
  opened: boolean;
  tierChosen: boolean;
  bankStarted: boolean;
  priceMonthlyPence: number | null;
  customerFirstName: string;
  customerLastName: string;
  incomeMonthlyPence: number;
  activePlans: number;
};

const STEPS = ["LINK SENT", "OPENED", "CHOOSING TIER", "BANK DETAILS", "ACTIVE"] as const;

function stepIndex(s: Status) {
  if (s.status === "ACTIVE") return 4;
  if (s.bankStarted) return 3;
  if (s.opened) return 2;
  return 0;
}

export function DoorstepLive({
  planId,
  link,
  qrDataUrl,
}: {
  planId: string;
  link: string;
  qrDataUrl: string;
}) {
  const [showQr, setShowQr] = useState(false);
  const [s, setS] = useState<Status | null>(null);

  // Live status theatre — 2s polling.
  // ponytail: polling, not websockets; same UX at this scale
  useEffect(() => {
    let stop = false;
    async function tick() {
      const res = await fetch(`/api/plans/${planId}/status`);
      if (res.ok && !stop) {
        const data = (await res.json()) as Status;
        setS(data);
        if (data.status === "ACTIVE") return; // stop polling on completion
      }
      if (!stop) setTimeout(tick, 2000);
    }
    tick();
    return () => {
      stop = true;
    };
  }, [planId]);

  if (s?.status === "ACTIVE") {
    return (
      <div className="fixed inset-0 z-50 bg-iron text-white flex flex-col items-center justify-center gap-4 px-8 text-center">
        <div className="text-6xl animate-bounce">🔥</div>
        <h1 className="font-disp text-4xl uppercase tracking-wide">Flame lit</h1>
        <p className="text-sm text-[#C7D0D9]">
          {s.customerFirstName} {s.customerLastName} is on a plan at{" "}
          <Money pence={s.priceMonthlyPence ?? 0} suffix="/mo" />.
        </p>
        <p className="font-mono text-2xl font-semibold text-[#F3B27E]">
          <Money pence={s.incomeMonthlyPence} suffix="/mo" />
        </p>
        <p className="text-xs text-[#8FA0B0]">
          locked in across {s.activePlans} active plan{s.activePlans === 1 ? "" : "s"}
        </p>
        <Link href="/" className={`${btnClass("copper")} mt-4 w-64`}>
          Back to the dashboard
        </Link>
      </div>
    );
  }

  const idx = s ? stepIndex(s) : 0;
  return (
    <>
      <Card>
        <h2 className="text-sm font-semibold mb-2">Link sent by text</h2>
        <p className="font-mono text-xs break-all text-muted">{link}</p>
        <button onClick={() => setShowQr(!showQr)} className={`${btnClass("ghost")} mt-3`}>
          {showQr ? "Hide QR" : "Show QR on my screen instead"}
        </button>
        {showQr && (
          <div className="flex justify-center py-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt="Signup QR code" width={280} height={280} />
          </div>
        )}
      </Card>

      <Card>
        <Micro className="mb-2">Live status</Micro>
        <div className="flex flex-wrap gap-x-2 gap-y-1 font-mono text-[10px] items-center">
          {STEPS.map((step, i) => (
            <span
              key={step}
              className={
                i < idx
                  ? "text-flame-deep font-semibold"
                  : i === idx
                    ? "text-flame font-semibold"
                    : "text-faint"
              }
            >
              {i < idx ? "●" : i === idx ? "◉" : "○"} {step}
              {i < STEPS.length - 1 && <span className="text-faint"> —</span>}
            </span>
          ))}
        </div>
        <div className="h-2 bg-line-soft rounded-full overflow-hidden mt-2.5">
          <div
            className="h-full bg-flame rounded-full transition-all duration-500"
            style={{ width: `${(idx / 4) * 100}%` }}
          />
        </div>
      </Card>

      {s && (
        <Card className="bg-copper-tint border-[#EBCDB8]">
          <p className="text-xs text-[#7A4A26]">
            {s.customerFirstName} signs at{" "}
            <b className="font-mono">{s.priceMonthlyPence ? `£${(s.priceMonthlyPence / 100).toFixed(0)}/mo` : "£15/mo"}</b>{" "}
            → your income becomes{" "}
            <b className="font-mono">
              £{(((s.incomeMonthlyPence + (s.priceMonthlyPence ?? 1500)) / 100) | 0)}/mo
            </b>
            . One doorstep. Forever-ish.
          </p>
        </Card>
      )}
      <Micro className="text-center">
        Didn&apos;t finish? Follow-up texts go out this evening and in 3 days automatically.
      </Micro>
    </>
  );
}
