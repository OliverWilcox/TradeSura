"use client";

import {
  FIRST_PAYMENT_LINE,
  poundsLabel,
  yearlyPricePence,
  type BillingInterval,
} from "@/lib/billing-interval";

// Retention spec §1 — pay monthly, or yearly at 12 months for the price of
// 11. Both full prices are on screen before the mandate (CLAUDE.md
// compliance 2).
export function BillingChoice({
  priceMonthlyPence,
  value,
  onChange,
  vatRegistered = false,
}: {
  priceMonthlyPence: number;
  value: BillingInterval;
  onChange: (v: BillingInterval) => void;
  vatRegistered?: boolean;
}) {
  const vat = vatRegistered ? " including VAT" : "";
  const saving = poundsLabel(priceMonthlyPence);
  const options: { v: BillingInterval; title: string; sub: string }[] = [
    {
      v: "month",
      title: "Pay monthly",
      sub: `${poundsLabel(priceMonthlyPence)} a month${vat}`,
    },
    {
      v: "year",
      title: "Pay yearly",
      sub: `${poundsLabel(yearlyPricePence(priceMonthlyPence))} a year${vat} · 12 months for the price of 11, save ${saving}`,
    },
  ];
  return (
    <div>
      <div
        role="radiogroup"
        aria-label="How would you like to pay?"
        className="grid grid-cols-2 gap-2"
      >
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={value === o.v}
            onClick={() => onChange(o.v)}
            className={`text-left rounded-[10px] border-[1.5px] px-3 py-2.5 ${
              value === o.v
                ? "border-[#1F5FC4] bg-paper"
                : "border-line bg-paper opacity-80"
            }`}
          >
            <span className="block text-sm font-semibold">{o.title}</span>
            <span className="block text-[11.5px] text-muted mt-0.5">
              {o.sub}
            </span>
          </button>
        ))}
      </div>
      <p className="text-[11.5px] text-muted mt-1.5 text-center">
        {FIRST_PAYMENT_LINE}
      </p>
    </div>
  );
}
