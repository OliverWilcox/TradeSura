"use client";

import { useState } from "react";
import { NotIncluded } from "@/components/ui";
import { EmbeddedCheckout } from "@/components/embedded-checkout";
import { JOIN_BTN, PlanTierCard } from "@/components/plan-tier-card";
import { BillingChoice } from "@/components/billing-choice";
import { chargePence, priceLine, type BillingInterval } from "@/lib/billing-interval";
import type { PageMode } from "@/lib/public-page";

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
  mode = "live",
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
  /** Review 4 — only "live" ever creates a customer or plan. */
  mode?: PageMode;
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
  const [practiceDone, setPracticeDone] = useState(false);
  const selected = tiers.find((t) => t.id === selectedId);

  const ready =
    firstName.trim().length >= 2 &&
    lastName.trim().length >= 2 &&
    phone.trim().length >= 10 &&
    Boolean(selected);

  async function begin() {
    if (!selected || !ready) return;
    if (mode === "practice") {
      setPracticeDone(true);
      return;
    }
    if (mode !== "live") return;
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

  if (practiceDone && selected) {
    return (
      <div className="rounded-xl border border-warn bg-warn-tint p-4 text-sm text-ink">
        <p className="font-semibold">
          <span className="text-warn">DEMO</span> · This is where {firstName.trim() || "your customer"} sets up
          their Direct Debit
        </p>
        <p className="mt-1.5 text-muted">
          In a real sign-up they enter their bank details with Stripe, nothing is taken for 14 days, and their
          plan document arrives by email. Nothing was saved here and no payment was set up.
        </p>
        <button onClick={() => setPracticeDone(false)} className="mt-3 text-sm text-ink underline">
          Back to the plans
        </button>
      </div>
    );
  }

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

      {selected && mode === "closed" ? (
        <p className="rounded-xl border border-line bg-paper px-3.5 py-3 text-center text-sm text-muted">
          {`${engineerName} isn't taking sign-ups online just yet. Check back soon, or ask them directly.`}
        </p>
      ) : selected ? (
        <button onClick={begin} disabled={busy || !ready || mode === "preview"} className={JOIN_BTN}>
          {mode === "preview"
            ? "Join is switched off in preview"
            : busy
              ? "Setting up…"
              : `${mode === "practice" ? "DEMO · " : ""}Join ${selected.name} — ${priceLine(selected.priceMonthlyPence, billingInterval, vatRegistered)} by Direct Debit`}
        </button>
      ) : null}
    </>
  );
}
