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

type Started = {
  clientSecret: string;
  publishableKey: string;
  confirmedUrl: string;
  signupToken: string;
};

// C1 → embedded checkout. Collect the minimum (name, mobile, email), POST
// /api/p/[slug]/start (creates the customer + plan), then render the Stripe
// Payment Element inline — the customer never leaves this page.
export function PublicSignup({
  slug,
  tiers,
  engineerName,
  channel = "web",
}: {
  slug: string;
  tiers: Tier[];
  engineerName: string;
  channel?: string;
}) {
  const [selectedId, setSelectedId] = useState(
    tiers.find((t) => t.isRecommended)?.id ?? tiers[0]?.id,
  );
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState<Started | null>(null);
  const selected = tiers.find((t) => t.id === selectedId);

  const ready =
    firstName.trim().length >= 2 &&
    lastName.trim().length >= 2 &&
    phone.trim().length >= 10 &&
    Boolean(selected);

  async function begin() {
    if (!selected || !ready) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/p/${slug}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tierId: selected.id,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        channel,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong — try again.");
      return;
    }
    setStarted(data);
  }

  const input = "w-full rounded-[10px] border-[1.5px] border-line bg-paper px-3 py-2.5 text-sm";

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
          signupToken={started.signupToken}
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
              ? "border-flame shadow-[0_0_20px_rgba(95,163,240,0.25)]"
              : t.isRecommended
                ? "border-copper shadow-[0_0_20px_rgba(61,214,140,0.20)]"
                : "border-line"
          }`}
        >
          {t.isRecommended && (
            <span className="absolute -top-2 left-3 bg-copper text-[#052614] font-mono text-[9px] font-semibold px-2 py-0.5 rounded-full tracking-wide">
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

      <div className="grid grid-cols-2 gap-2">
        <input className={input} placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        <input className={input} placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
      </div>
      <input className={input} placeholder="Mobile number" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <input className={input} placeholder="Email (for your plan document)" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />

      {error && <p className="text-sm text-danger">{error}</p>}

      {selected && (
        <button onClick={begin} disabled={busy || !ready} className={btnClass()}>
          {busy
            ? "Setting up…"
            : `Join ${selected.name} — ${pounds(selected.priceMonthlyPence)}/month by Direct Debit`}
        </button>
      )}
    </>
  );
}
