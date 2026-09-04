"use client";

import { useState } from "react";
import { NotIncluded, btnClass } from "@/components/ui";
import { EmbeddedCheckout } from "@/components/embedded-checkout";

type Tier = {
  id: string;
  name: string;
  priceMonthlyPence: number;
  isRecommended: boolean;
  lines: string[];
};

function pounds(pence: number) {
  return pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`;
}

type Started = { clientSecret: string; publishableKey: string; confirmedUrl: string };

export function SignupTiers({
  token,
  tiers,
  engineerName,
}: {
  token: string;
  tiers: Tier[];
  engineerName: string;
}) {
  const [selectedId, setSelectedId] = useState(
    tiers.find((t) => t.isRecommended)?.id ?? tiers[0]?.id,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState<Started | null>(null);
  const selected = tiers.find((t) => t.id === selectedId);

  async function choose() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/signup/${token}/choose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tierId: selected.id }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong — try again.");
      return;
    }
    setStarted(data);
  }

  if (started && selected) {
    return (
      <>
        <div className="rounded-xl bg-paper border-[1.5px] border-flame p-3.5">
          <div className="flex justify-between items-baseline">
            <span className="font-disp text-[17px] uppercase tracking-wide">{selected.name}</span>
            <span className="font-mono text-xl font-semibold">
              {pounds(selected.priceMonthlyPence)}
              <small className="text-[11px] text-muted font-normal">/mo</small>
            </span>
          </div>
        </div>
        <EmbeddedCheckout
          clientSecret={started.clientSecret}
          publishableKey={started.publishableKey}
          confirmedUrl={started.confirmedUrl}
          planName={selected.name}
          priceLabel={pounds(selected.priceMonthlyPence)}
          engineerName={engineerName}
        />
      </>
    );
  }

  return (
    <>
      {tiers.map((t) => (
        <button
          key={t.id}
          onClick={() => setSelectedId(t.id)}
          className={`relative text-left bg-paper rounded-xl p-3.5 border-[1.5px] ${
            t.id === selectedId
              ? "border-flame shadow-[0_4px_14px_rgba(14,127,208,0.14)]"
              : t.isRecommended
                ? "border-copper shadow-[0_4px_14px_rgba(194,98,46,0.14)]"
                : "border-line"
          }`}
        >
          {t.isRecommended && (
            <span className="absolute -top-2 left-3 bg-copper text-white font-mono text-[9px] font-semibold px-2 py-0.5 rounded-full tracking-wide">
              MOST CHOSEN
            </span>
          )}
          <div className="flex justify-between items-baseline">
            <span className="font-disp text-[17px] uppercase tracking-wide">{t.name}</span>
            <span className="font-mono text-xl font-semibold">
              {pounds(t.priceMonthlyPence)}
              <small className="text-[11px] text-muted font-normal">/mo</small>
            </span>
          </div>
          <p className="text-xs text-muted mt-1">{t.lines.join(" · ")}</p>
        </button>
      ))}

      <NotIncluded />

      {error && <p className="text-sm text-danger">{error}</p>}

      {/* Price before mandate: the full monthly price is restated on the
          button itself, the last thing seen before the Payment Element. */}
      {selected && (
        <button onClick={choose} disabled={busy} className={btnClass()}>
          {busy
            ? "Opening secure Direct Debit setup…"
            : `Choose ${selected.name} — ${pounds(selected.priceMonthlyPence)}/month by Direct Debit`}
        </button>
      )}
    </>
  );
}
