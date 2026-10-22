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

export function SignupTiers({
  token,
  tiers: rawTiers,
  engineerName,
  vatRegistered = false,
  pinnedTierId,
  pinnedGreeting,
}: {
  token: string;
  tiers: Tier[];
  engineerName: string;
  /** R5 — prices shown including VAT. */
  vatRegistered?: boolean;
  /** Build Guide v2 Part 15.1 — the personal-link greeting: "{Engineer
   * first name} suggested {plan name}" pins that plan first. */
  pinnedTierId?: string | null;
  pinnedGreeting?: string | null;
}) {
  const tiers = pinnedTierId
    ? [...rawTiers].sort((a, b) => (a.id === pinnedTierId ? -1 : b.id === pinnedTierId ? 1 : 0))
    : rawTiers;
  const [selectedId, setSelectedId] = useState(
    pinnedTierId ?? tiers.find((t) => t.isRecommended)?.id ?? tiers[0]?.id,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState<Started | null>(null);
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("month");
  const selected = tiers.find((t) => t.id === selectedId);

  async function choose() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/signup/${token}/choose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tierId: selected.id, billingInterval }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "That didn't go through. Please try again — if it keeps happening, contact your engineer.");
      return;
    }
    setStarted(data);
  }

  if (started && selected) {
    return (
      <>
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
      {pinnedGreeting && (
        <p className="text-sm font-semibold text-flame-deep">{pinnedGreeting}</p>
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

      {error && <p className="text-sm text-danger">{error}</p>}

      {selected && (
        <BillingChoice
          priceMonthlyPence={selected.priceMonthlyPence}
          value={billingInterval}
          onChange={setBillingInterval}
          vatRegistered={vatRegistered}
        />
      )}

      {/* Price before mandate: the full price (monthly or yearly) is restated
          on the button itself, the last thing seen before the Payment Element. */}
      {selected && (
        <button onClick={choose} disabled={busy} className={JOIN_BTN}>
          {busy
            ? "Opening secure Direct Debit setup…"
            : `Choose ${selected.name} — ${priceLine(selected.priceMonthlyPence, billingInterval, vatRegistered)} by Direct Debit`}
        </button>
      )}
    </>
  );
}
