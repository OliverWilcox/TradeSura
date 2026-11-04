"use client";

import { useState } from "react";
import { NotIncluded } from "@/components/ui";
import { EmbeddedCheckout } from "@/components/embedded-checkout";
import { JOIN_BTN, PlanTierCard } from "@/components/plan-tier-card";
import { BillingChoice } from "@/components/billing-choice";
import { chargePence, priceLine, type BillingInterval } from "@/lib/billing-interval";
import { defaultTierId, hasLandlordChoice, tiersFor } from "@/lib/signup-choice";
import { valueSum, type NormalPrices } from "@/lib/value-sum";
import { HomePassportBlock, LandlordToggle, ValueSumLine, WhyYearlyService } from "@/components/signup-extras";

type Tier = {
  id: string;
  name: string;
  priceMonthlyPence: number;
  isRecommended: boolean;
  lines: string[];
  codes: string[];
  landlord: boolean;
};

function pounds(pence: number) {
  return pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`;
}

type Started = {
  clientSecret: string;
  publishableKey: string;
  confirmedUrl: string;
  landlord?: boolean;
  cp12AvailableFrom?: string | null;
  signupToken: string;
  firstPaymentAt?: string;
};

export function SignupTiers({
  token,
  tiers: rawTiers,
  engineerName,
  initialAddress,
  vatRegistered = false,
  pinnedTierId,
  pinnedGreeting,
  normalPrices,
  serviceOrder,
}: {
  token: string;
  tiers: Tier[];
  engineerName: string;
  /** The service address the engineer typed with the offer, if any. */
  initialAddress?: { line1: string; town: string; postcode: string } | null;
  /** R5 — prices shown including VAT. */
  vatRegistered?: boolean;
  /** Build Guide v2 Part 15.1 — the personal-link greeting: "{Engineer
   * first name} suggested {plan name}" pins that plan first. */
  pinnedTierId?: string | null;
  pinnedGreeting?: string | null;
  /** 30 Oct §7.3 — the installer's own prices, for "Worth over £X a year". */
  normalPrices?: NormalPrices;
  /** §7.6 — "Why a yearly service matters", in the visit reason's order. */
  serviceOrder?: string[] | null;
}) {
  const tiers = pinnedTierId
    ? [...rawTiers].sort((a, b) => (a.id === pinnedTierId ? -1 : b.id === pinnedTierId ? 1 : 0))
    : rawTiers;
  // §7.4 — "Are you a landlord?" when there are both kinds of plan; the
  // offered plan decides where it starts.
  const landlordChoice = hasLandlordChoice(tiers);
  const startsLandlord = Boolean(tiers.find((t) => t.id === pinnedTierId)?.landlord);
  const [landlord, setLandlord] = useState(startsLandlord);
  const shown = tiersFor(tiers, landlord);
  const [selectedId, setSelectedId] = useState(defaultTierId(tiersFor(tiers, startsLandlord), { initialTierId: pinnedTierId }));
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
          cp12AvailableFrom={started.cp12AvailableFrom}
          signupToken={started.signupToken}
          firstPaymentAt={started.firstPaymentAt}
          planName={selected.name}
          priceLabel={pounds(chargePence(selected.priceMonthlyPence, billingInterval))}
          billingInterval={billingInterval}
          engineerName={engineerName}
          vatRegistered={vatRegistered}
          initialAddress={initialAddress}
        />
      </>
    );
  }

  return (
    <>
      {pinnedGreeting && (
        <p className="text-sm font-semibold text-flame-deep">{pinnedGreeting}</p>
      )}
      {landlordChoice && (
        <LandlordToggle
          value={landlord}
          onChange={(v) => {
            setLandlord(v);
            const list = tiersFor(tiers, v);
            if (!list.some((t) => t.id === selectedId)) setSelectedId(defaultTierId(list));
          }}
        />
      )}

      {shown.map((t) => (
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

      {selected && normalPrices && (
        <ValueSumLine sum={valueSum(selected.codes, normalPrices, selected.priceMonthlyPence, billingInterval)} />
      )}

      <WhyYearlyService order={serviceOrder} />

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
            : `Join now · ${selected.name}, ${priceLine(selected.priceMonthlyPence, billingInterval, vatRegistered)}`}
        </button>
      )}

      <HomePassportBlock brand={engineerName} />
    </>
  );
}
