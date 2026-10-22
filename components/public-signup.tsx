"use client";

import { useState } from "react";
import { NotIncluded } from "@/components/ui";
import { EmbeddedCheckout } from "@/components/embedded-checkout";
import { JOIN_BTN, PlanTierCard } from "@/components/plan-tier-card";
import { BillingChoice } from "@/components/billing-choice";
import { chargePence, priceLine, type BillingInterval } from "@/lib/billing-interval";

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
  landlord?: boolean;
  signupToken: string;
};

// C1 → embedded checkout. Collect the minimum (name, mobile, email), POST
// /api/p/[slug]/start (creates the customer + plan), then render the Stripe
// Payment Element inline — the customer never leaves this page.
export function PublicSignup({
  slug,
  tiers,
  engineerName,
  vatRegistered = false,
  channel = "web",
  soldById,
  initialTierId,
  rejoin,
  firstMonthFree,
}: {
  slug: string;
  tiers: Tier[];
  engineerName: string;
  /** R5 — prices shown including VAT. */
  vatRegistered?: boolean;
  channel?: string;
  soldById?: string;
  /** Pre-selects a plan, e.g. a Join tap on the engineer's website embed. */
  initialTierId?: string;
  /** Win-back rejoin link token, and whether it carries a free month. */
  rejoin?: string;
  firstMonthFree?: boolean;
}) {
  const [selectedId, setSelectedId] = useState(
    tiers.find((t) => t.id === initialTierId)?.id ??
      tiers.find((t) => t.isRecommended)?.id ??
      tiers[0]?.id,
  );
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState<Started | null>(null);
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("month");
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
        soldById,
        billingInterval,
        rejoin,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "That didn't go through. Please try again — if it keeps happening, contact your engineer.");
      return;
    }
    setStarted(data);
  }

  const input = "w-full rounded-[10px] border-[1.5px] border-line bg-paper px-3 py-2.5 text-sm";

  if (started && selected) {
    return (
      <>
      {firstMonthFree && (
        <p className="rounded-xl bg-flame-tint px-3 py-2 text-sm text-ink">
          Welcome back. Your first month is free: your first payment is a month after your 14-day
          cooling-off period.
        </p>
      )}
        <PlanTierCard
          name={selected.name}
          priceMonthlyPence={selected.priceMonthlyPence}
          lines={selected.lines}
          selected
          compact
          vatRegistered={vatRegistered}
        />
        <EmbeddedCheckout
          clientSecret={started.clientSecret}
          publishableKey={started.publishableKey}
          confirmedUrl={started.confirmedUrl}
          landlord={started.landlord}
          signupToken={started.signupToken}
          planName={selected.name}
          priceLabel={pounds(chargePence(selected.priceMonthlyPence, billingInterval))}
          billingInterval={billingInterval}
          engineerName={engineerName}
          vatRegistered={vatRegistered}
        />
      </>
    );
  }

  return (
    <>
      {firstMonthFree && (
        <p className="rounded-xl bg-flame-tint px-3 py-2 text-sm text-ink">
          Welcome back. Your first month is free: your first payment is a month after your 14-day
          cooling-off period.
        </p>
      )}
      {tiers.map((t) => (
        <button
          key={t.id}
          onClick={() => setSelectedId(t.id)}
          aria-pressed={t.id === selectedId}
          className="block w-full text-left"
        >
          <PlanTierCard
            name={t.name}
            priceMonthlyPence={t.priceMonthlyPence}
            lines={t.lines}
            selected={t.id === selectedId}
            recommended={t.isRecommended}
            vatRegistered={vatRegistered}
          />
        </button>
      ))}

      <NotIncluded />

      <div className="grid grid-cols-2 gap-2">
        <input className={input} placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        <input className={input} placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
      </div>
      <input className={input} placeholder="Mobile number" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <input className={input} placeholder="Email (for your plan document)" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />

      {selected && (
        <BillingChoice
          priceMonthlyPence={selected.priceMonthlyPence}
          value={billingInterval}
          onChange={setBillingInterval}
          vatRegistered={vatRegistered}
        />
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      {selected && (
        <button onClick={begin} disabled={busy || !ready} className={JOIN_BTN}>
          {busy
            ? "Setting up…"
            : `Join ${selected.name} — ${priceLine(selected.priceMonthlyPence, billingInterval, vatRegistered)} by Direct Debit`}
        </button>
      )}
    </>
  );
}
