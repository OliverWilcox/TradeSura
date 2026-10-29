// Plan service library (handover §3). Wording is locked: plan documents
// assemble ONLY from these templates (CLAUDE.md §Compliance 1).
//
// SAFE  = shipped in the service picker now.
// CARE  = hidden until solicitor sign-off (drifts toward insurance).
// BLOCKED phrases are never offered here — they live in the wording blocklist.
//
// Suggested uplifts are launch defaults; every engineer can edit the price.
// Solicitor review of all clause text is a human task before first real customer.

export type ClauseSeed = {
  code: string;
  title: string;
  bodyText: string;
  kind: "CORE" | "ADD";
  status: "SAFE" | "CARE";
  category: string;
  /** Suggested monthly uplift in pence. null = core, free, or engineer-set. */
  upliftPence: number | null;
  /** Shown instead of a price when there is no fixed uplift. */
  pricingLabel?: string;
  /** Retention anchors — surfaced first in the picker. */
  highlight?: boolean;
  /** Small print under the title on the customer's plan card. */
  note?: string;
  /** The same caveat in the engineer's words, under the title in the builder. */
  engineerNote?: string;
};

export const CAT_CORE = "Core gas servicing";
export const CAT_WARRANTY = "Warranty & admin";
export const CAT_PRIORITY = "Priority & access";
export const CAT_DISCOUNTS = "Discounts";
export const CAT_LANDLORD = "Landlord pack";
export const CAT_CARE = "Awaiting legal sign-off";

export const CATEGORY_ORDER = [
  CAT_CORE,
  CAT_WARRANTY,
  CAT_PRIORITY,
  CAT_DISCOUNTS,
  CAT_LANDLORD,
] as const;

export const CLAUSE_TEMPLATES: ClauseSeed[] = [
  // ---------- Core gas servicing ----------
  {
    code: "ANNUAL_SERVICE",
    title: "Annual boiler service",
    // Build Review 2, ruling 2 — ticked by default but optional, so an
    // engineer who didn't fit the boiler can sell a priority-only plan.
    kind: "ADD",
    status: "SAFE",
    category: CAT_CORE,
    upliftPence: null,
    pricingLabel: "ticked by default",
    // 2026 Build Guide target: "Optional · available after the customer's
    // 3rd payment" — so nobody joins, takes the service and cancels.
    note: "available after your third payment",
    engineerNote: "available after the customer's 3rd payment",
    bodyText:
      "We will carry out one scheduled service of your boiler in each 12-month plan period, including the safety checks and maintenance recommended by the manufacturer. Your first service is available once your third monthly payment has been collected.",
  },
  {
    code: "GAS_FIRE_SERVICE",
    title: "Gas fire service",
    kind: "ADD",
    status: "SAFE",
    category: CAT_CORE,
    upliftPence: 250,
    bodyText:
      "One scheduled service of your gas fire in each 12-month plan period, including the manufacturer's recommended safety checks.",
  },
  {
    code: "COOKER_HOB_CHECK",
    title: "Cooker / hob safety check",
    kind: "ADD",
    status: "SAFE",
    category: CAT_CORE,
    upliftPence: 150,
    bodyText:
      "One safety check of your gas cooker or hob in each 12-month plan period, carried out alongside your annual service where practical.",
  },
  {
    code: "UNVENTED_CYLINDER",
    title: "Unvented cylinder annual service",
    kind: "ADD",
    status: "SAFE",
    category: CAT_CORE,
    upliftPence: 300,
    bodyText:
      "One scheduled service of your unvented hot water cylinder in each 12-month plan period, including the discharge and safety device checks required by the manufacturer.",
  },
  {
    code: "HEALTH_CHECK",
    title: "Central heating health check (pressures, temps, TRVs)",
    kind: "ADD",
    status: "SAFE",
    category: CAT_CORE,
    upliftPence: 150,
    bodyText:
      "A check of your central heating system alongside your annual service: system pressure, flow and return temperatures, and thermostatic radiator valve operation.",
  },
  {
    code: "RADIATOR_BALANCE",
    title: "Radiator balancing & bleed",
    kind: "ADD",
    status: "SAFE",
    category: CAT_CORE,
    upliftPence: 100,
    bodyText:
      "Radiators bled and the system balanced once in each 12-month plan period, carried out alongside your annual service.",
  },
  {
    code: "MAGNETIC_FILTER",
    title: "Magnetic filter clean",
    kind: "ADD",
    status: "SAFE",
    category: CAT_CORE,
    upliftPence: 100,
    bodyText:
      "Where a magnetic system filter is fitted, it will be cleaned once in each 12-month plan period during your annual service.",
  },
  {
    code: "INHIBITOR_TOPUP",
    title: "Inhibitor top-up",
    kind: "ADD",
    status: "SAFE",
    category: CAT_CORE,
    upliftPence: 100,
    bodyText:
      "System inhibitor levels tested and topped up once in each 12-month plan period during your annual service.",
  },
  {
    code: "CONDENSATE_CHECK",
    title: "Condensate pipe check & insulation advice",
    kind: "ADD",
    status: "SAFE",
    category: CAT_CORE,
    upliftPence: 50,
    bodyText:
      "Your condensate pipe run is inspected during the annual service and you receive written advice on insulating it against freezing.",
  },
  {
    code: "CO_ALARM_TEST",
    title: "CO alarm test + battery replacement",
    kind: "ADD",
    status: "SAFE",
    category: CAT_CORE,
    upliftPence: 50,
    bodyText:
      "Your carbon monoxide alarm is tested during the annual service and its batteries replaced where required.",
  },
  {
    code: "SMART_THERMOSTAT",
    title: "Smart thermostat check & optimisation",
    kind: "ADD",
    status: "SAFE",
    category: CAT_CORE,
    upliftPence: 100,
    bodyText:
      "Where a smart thermostat is fitted, its operation and schedule are checked and optimised during your annual service.",
  },
  {
    code: "BOILER_TUNE",
    title: "Boiler settings / efficiency tune",
    kind: "ADD",
    status: "SAFE",
    category: CAT_CORE,
    upliftPence: 100,
    bodyText:
      "Boiler flow temperature and control settings reviewed and adjusted for efficiency during your annual service.",
  },
  {
    code: "HEALTH_REPORT",
    title: "Written annual health report",
    kind: "ADD",
    status: "SAFE",
    category: CAT_CORE,
    upliftPence: 100,
    bodyText:
      "A written summary of your system's condition and any recommendations, issued after each annual service.",
  },

  // ---------- Warranty & admin ----------
  {
    code: "WARRANTY_VALID",
    // Build Review 2 — the old title read like a guarantee TradeSura can't
    // give. Wording pending James's confirmation.
    title: "Annual service on schedule and logged for your manufacturer warranty",
    kind: "ADD",
    status: "SAFE",
    category: CAT_WARRANTY,
    upliftPence: 100,
    highlight: true,
    bodyText:
      "We schedule and record your annual service so that the servicing conditions of your manufacturer's warranty are met, and keep a dated record you can produce on request.",
  },
  {
    code: "WARRANTY_ADMIN",
    title: "Warranty claim admin — we book the manufacturer engineer for you",
    kind: "ADD",
    // Review 3 R7 — hidden until James vets the wording.
    status: "CARE",
    category: CAT_WARRANTY,
    upliftPence: 150,
    bodyText:
      "Where your appliance is within its manufacturer's warranty, we will handle the paperwork and arrange the manufacturer's engineer visit on your behalf.",
  },
  {
    code: "SERVICE_HISTORY",
    title: "Service history stored digitally",
    kind: "ADD",
    status: "SAFE",
    category: CAT_WARRANTY,
    upliftPence: 0,
    pricingLabel: "no charge — on by default",
    bodyText:
      "Your service records and certificates are stored digitally and remain available to you for the life of the plan.",
  },
  {
    code: "ANNUAL_REMINDER",
    title: "Annual reminder handled for you",
    kind: "ADD",
    status: "SAFE",
    category: CAT_WARRANTY,
    upliftPence: 0,
    pricingLabel: "no charge — on by default",
    bodyText:
      "We contact you when your annual service is due so the schedule is never left to memory.",
  },

  // ---------- Priority & access ----------
  {
    code: "PRIORITY_48H",
    // Review 3 R1/R7 — in every plan, locked on, no attendance time. The
    // code keeps its old name so existing tiers and plans still resolve.
    title: "Priority booking",
    kind: "CORE",
    status: "SAFE",
    category: CAT_PRIORITY,
    upliftPence: null,
    pricingLabel: "core — in every tier",
    bodyText:
      "You go to the front of the queue when you need us. Subject to availability, no set attendance time.",
  },
  {
    code: "SAMEDAY_PRIORITY",
    title: "Same-day priority",
    kind: "ADD",
    // Review 3 R7 — hidden until James vets the wording.
    status: "CARE",
    category: CAT_PRIORITY,
    upliftPence: 400,
    bodyText:
      "Requests received before 10am are placed at the front of the day's queue for same-day attendance where availability allows.",
  },
  {
    code: "EVENING_WEEKEND",
    title: "Evening / weekend slot access",
    kind: "ADD",
    status: "SAFE",
    category: CAT_PRIORITY,
    upliftPence: 200,
    bodyText:
      "Plan members may book evening and weekend appointment slots that are not offered to non-members, subject to availability.",
  },
  {
    code: "COLD_SNAP_PRIORITY",
    title: "Cold-snap queue priority",
    kind: "ADD",
    status: "SAFE",
    category: CAT_PRIORITY,
    upliftPence: 150,
    bodyText:
      "During periods of exceptional demand, plan members are prioritised in the appointment queue ahead of non-members.",
  },
  {
    code: "DIRECT_LINE",
    title: "Direct line / WhatsApp to your engineer",
    kind: "ADD",
    status: "SAFE",
    category: CAT_PRIORITY,
    upliftPence: 100,
    bodyText:
      "A direct contact number for your engineer during working hours, rather than a general enquiry line.",
  },
  {
    code: "NO_CALLOUT_FEE",
    title: "No call-out / attendance fees",
    kind: "ADD",
    status: "SAFE",
    category: CAT_PRIORITY,
    upliftPence: 200,
    bodyText:
      "When we attend a visit you request under this plan, our usual attendance charge is waived. This is not a promise to attend at any particular time. Labour and parts for any work carried out remain chargeable at the rates shown in your plan.",
    note: "your attendance charge is waived when we attend",
    engineerNote: "your attendance charge is waived when you attend",
  },

  // ---------- Discounts ----------
  {
    code: "LABOUR_DISCOUNT_15",
    title: "15% off labour",
    kind: "ADD",
    status: "SAFE",
    category: CAT_DISCOUNTS,
    upliftPence: 200,
    bodyText:
      "A 15% discount applies to our standard labour rates for work arising from visits made under this plan.",
  },
  {
    code: "PARTS_DISCOUNT",
    title: "10% off parts",
    kind: "ADD",
    status: "SAFE",
    category: CAT_DISCOUNTS,
    upliftPence: 150,
    bodyText:
      "A 10% discount applies to parts supplied by us for work carried out under this plan.",
  },
  {
    code: "DIAGNOSTIC_WAIVED",
    title: "Waived diagnostic fee",
    kind: "ADD",
    status: "SAFE",
    category: CAT_DISCOUNTS,
    upliftPence: 150,
    bodyText:
      "Our standard diagnostic charge is not applied to plan members. Any remedial work identified remains chargeable at your plan rates.",
  },
  {
    code: "POWERFLUSH_DISCOUNT",
    title: "Discount off a powerflush",
    kind: "ADD",
    status: "SAFE",
    category: CAT_DISCOUNTS,
    upliftPence: 100,
    bodyText:
      "A member discount applies to our standard powerflush price, quoted before any work begins.",
  },
  {
    code: "NEW_BOILER_DISCOUNT",
    title: "Discount off a new boiler installation",
    kind: "ADD",
    status: "SAFE",
    category: CAT_DISCOUNTS,
    upliftPence: 100,
    bodyText:
      "A member discount applies to our standard price for a new boiler installation, quoted before any work begins.",
  },
  {
    code: "LOYALTY_CREDIT",
    title: "Loyalty credit — £50 per membership year off your next boiler",
    kind: "ADD",
    status: "SAFE",
    category: CAT_DISCOUNTS,
    upliftPence: 200,
    highlight: true,
    bodyText:
      "For each complete year of membership you accrue £50 of credit towards a future boiler installation carried out by us, up to the limit stated in your plan.",
  },
  {
    code: "MULTI_APPLIANCE",
    title: "Multi-appliance discount",
    kind: "ADD",
    status: "SAFE",
    category: CAT_DISCOUNTS,
    upliftPence: null,
    pricingLabel: "you set the rate",
    bodyText:
      "Where more than one appliance is included on your plan, a member discount applies to the additional appliances at the rate shown in your plan.",
  },
  {
    code: "SECOND_PROPERTY",
    title: "Second property / family discount",
    kind: "ADD",
    status: "SAFE",
    category: CAT_DISCOUNTS,
    upliftPence: null,
    pricingLabel: "you set the rate",
    bodyText:
      "A member discount applies to plans taken on additional properties in the same household at the rate shown in your plan.",
  },

  // ---------- Landlord pack ----------
  {
    code: "CP12",
    title: "Annual CP12 landlord gas safety record",
    kind: "ADD",
    status: "SAFE",
    category: CAT_LANDLORD,
    upliftPence: 300,
    bodyText:
      "One landlord gas safety record (CP12) per property in each 12-month plan period.",
  },
  {
    code: "SMOKE_CO_CHECKS",
    title: "Smoke & CO alarm checks",
    kind: "ADD",
    status: "SAFE",
    category: CAT_LANDLORD,
    upliftPence: 100,
    bodyText:
      "Smoke and carbon monoxide alarms tested at each annual visit, with a dated record for your compliance file.",
  },
  {
    code: "TENANT_LIAISON",
    title: "Tenant liaison — access arranged directly with tenants",
    kind: "ADD",
    status: "SAFE",
    category: CAT_LANDLORD,
    upliftPence: 200,
    bodyText:
      "We contact your tenants directly to arrange access for scheduled visits and keep you informed of the outcome.",
  },
  {
    code: "CERT_STORAGE",
    title: "Digital certificate storage & auto-renewal reminders",
    kind: "ADD",
    status: "SAFE",
    category: CAT_LANDLORD,
    upliftPence: 100,
    bodyText:
      "Certificates are stored digitally against each property, with reminders issued before each expiry date.",
  },
  {
    code: "PORTFOLIO_BILLING",
    title: "Portfolio billing across properties",
    kind: "ADD",
    status: "SAFE",
    category: CAT_LANDLORD,
    upliftPence: 0,
    pricingLabel: "no charge at 3+ properties",
    bodyText:
      "Plans across multiple properties are billed together on a single monthly Direct Debit, itemised per property.",
  },
  {
    code: "VOID_CHECKS",
    title: "Void property safety checks",
    kind: "ADD",
    status: "SAFE",
    category: CAT_LANDLORD,
    upliftPence: 100,
    bodyText:
      "Safety checks carried out on unoccupied properties between tenancies at your request, within the visit allowance of your plan.",
  },
  {
    code: "LEGIONELLA",
    title: "Legionella risk assessment",
    kind: "ADD",
    status: "SAFE",
    category: CAT_LANDLORD,
    upliftPence: 200,
    bodyText:
      "A legionella risk assessment of the hot and cold water system, with a written record for your compliance file.",
  },

  // ---------- CARE: hidden until solicitor sign-off ----------
  {
    // Retention spec §1 — loyalty perk option. Wording from James pending.
    code: "LOYALTY_REPAIRS_DISCOUNT",
    title: "10% off repairs, rising to 15% after 12 months",
    kind: "ADD",
    status: "CARE",
    category: CAT_CARE,
    upliftPence: null,
    pricingLabel: "awaiting legal sign-off",
    bodyText:
      "A 10% discount applies to our standard labour rates for repair work, rising to 15% once you have been a plan member for 12 months. Parts and labour remain chargeable at the discounted rates.",
  },
  {
    code: "CARE_FIRST_HOUR_LABOUR",
    title: "First hour of labour at no charge",
    kind: "ADD",
    status: "CARE",
    category: CAT_CARE,
    upliftPence: null,
    pricingLabel: "awaiting legal sign-off",
    bodyText:
      "The first hour of labour on any chargeable work arising from a plan visit is not charged. Parts and subsequent labour remain chargeable at your plan rates.",
  },
  {
    code: "CARE_FIXED_PRICE_MENU",
    title: "Fixed-price repair menu",
    kind: "ADD",
    status: "CARE",
    category: CAT_CARE,
    upliftPence: null,
    pricingLabel: "awaiting legal sign-off",
    bodyText:
      "Common remedial jobs are charged at the fixed prices published in your plan rather than at an hourly rate. This is a pricing arrangement and is not a commitment to carry out any particular work.",
  },
];

// Build Guide v2 Part 7.1 LAW — "required options render pre-ticked and
// unremovable in the wizard." CORE is that required flag. Used both by the
// wizard's checklist (can't untick) and server-side (union these in
// regardless of what a request claims — see app/api/tiers/**).
export const REQUIRED_CLAUSE_CODES = CLAUSE_TEMPLATES.filter((c) => c.kind === "CORE").map(
  (c) => c.code,
);

// A clause as one line on a customer's plan card, with its small print.
// R6 — a "you set the rate" option carries the engineer's rate.
export function clauseLine(
  c: { code?: string; title: string; note?: string | null },
  rates?: unknown,
): string {
  const title = c.code ? withRate(c.title, cleanRates(rates)[c.code]) : c.title;
  return c.note ? `${title} — ${c.note}` : title;
}

export function withRequiredClauses(codes: string[]): string[] {
  return [...new Set([...codes, ...REQUIRED_CLAUSE_CODES])];
}

// Pre-ticked in a new plan but removable (Build Review 2, ruling 2).
export const DEFAULT_ON_CLAUSE_CODES = ["ANNUAL_SERVICE"];

// Review 3 R2/R3 — every plan includes real maintenance: the annual service,
// or (if that's unticked) at least one other Core gas servicing item. With
// the locked-on priority line that makes the hard minimum of two.
export const CORE_SERVICING_CODES = CLAUSE_TEMPLATES.filter(
  (c) => c.category === CAT_CORE && c.status === "SAFE",
).map((c) => c.code);

export function serviceRuleError(codes: string[]): string | null {
  if (codes.includes("ANNUAL_SERVICE")) return null;
  return codes.some((c) => CORE_SERVICING_CODES.includes(c))
    ? null
    : "Without the annual service, switch on at least one other Core gas servicing item so the plan includes real maintenance.";
}

// R3 — 3 to 6 options recommended; a gentle nudge outside that range.
export const RECOMMENDED_MIN_OPTIONS = 3;
export const RECOMMENDED_MAX_OPTIONS = 6;

// R6 — "you set the rate" options can't go live until the engineer enters
// their rate; it shows on the customer's plan page.
export const RATE_REQUIRED_CODES = CLAUSE_TEMPLATES.filter(
  (c) => c.pricingLabel === "you set the rate",
).map((c) => c.code);

export function cleanRates(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [code, v] of Object.entries(raw as Record<string, unknown>)) {
    if (RATE_REQUIRED_CODES.includes(code) && typeof v === "string" && v.trim()) {
      out[code] = v.trim().slice(0, 40);
    }
  }
  return out;
}

export function missingRateError(codes: string[], rates: Record<string, string>): string | null {
  const missing = CLAUSE_TEMPLATES.filter(
    (c) => RATE_REQUIRED_CODES.includes(c.code) && codes.includes(c.code) && !rates[c.code],
  );
  return missing.length
    ? `Enter your rate for ${missing.map((c) => `"${c.title}"`).join(" and ")} before this plan goes live.`
    : null;
}

// A customer-facing line with the engineer's rate, e.g. "Multi-appliance
// discount: 10% off".
export function withRate(title: string, rate?: string | null): string {
  return rate ? `${title}: ${rate}` : title;
}

// Review 3 — the name box starts empty; "New plan" is never a real name.
export function isPlaceholderName(name: string): boolean {
  return /^\s*new\s+plan\s*$/i.test(name);
}

// R9 — any Landlord pack item makes it a Landlord plan; checkout asks the
// customer to confirm the property is let.
export function isLandlordPlan(codes: string[]): boolean {
  return CLAUSE_TEMPLATES.some((c) => c.category === CAT_LANDLORD && codes.includes(c.code));
}

// R12 — options that need a qualification the engineer confirms they hold.
export const QUALIFICATION_PROMPTS: Record<string, string> = {
  GAS_FIRE_SERVICE: "I'm Gas Safe registered for gas fires.",
  COOKER_HOB_CHECK: "I'm Gas Safe registered for cookers and hobs.",
  UNVENTED_CYLINDER: "I hold a G3 unvented hot water certificate.",
  LEGIONELLA: "I'm trained to carry out legionella risk assessments.",
};

// Base for the self-assembling price suggestion: service + priority plus the
// engineer's own margin. Uplifts stack on top of this.
export const SUGGESTED_BASE_PENCE = 700;

export function suggestedPricePence(upliftsPence: (number | null)[]): number {
  return SUGGESTED_BASE_PENCE + upliftsPence.reduce<number>((a, b) => a + (b ?? 0), 0);
}

// Starter chips on the builder's Step 1 (2026 Build Guide target screens:
// Boiler Care / Service + Priority / Landlord). Each is a starting point the
// engineer re-prices and re-scopes; wording still assembles only from the
// clause templates.
export const TIER_PRESETS = [
  {
    name: "Boiler Care",
    priceMonthlyPence: 1200,
    isRecommended: false,
    clauseCodes: [
      "ANNUAL_SERVICE",
      "HEALTH_CHECK",
      "CO_ALARM_TEST",
      "PRIORITY_48H",
      "NO_CALLOUT_FEE",
      "LABOUR_DISCOUNT_15",
    ],
  },
  {
    name: "Service + Priority",
    priceMonthlyPence: 1000,
    isRecommended: false,
    clauseCodes: ["ANNUAL_SERVICE", "PRIORITY_48H", "ANNUAL_REMINDER", "SERVICE_HISTORY"],
  },
  {
    name: "Landlord Care",
    priceMonthlyPence: 1500,
    isRecommended: false,
    clauseCodes: [
      "ANNUAL_SERVICE",
      "PRIORITY_48H",
      "NO_CALLOUT_FEE",
      "SERVICE_HISTORY",
      "ANNUAL_REMINDER",
      "CP12",
      "SMOKE_CO_CHECKS",
      "CERT_STORAGE",
    ],
  },
] as const;

// Build Review 2, ruling 1 — the engineer sets their own price: £10 minimum,
// no business maximum. The max is only a typo guard (£1,000/month).
export const TIER_PRICE_MIN_PENCE = 1000;
export const TIER_PRICE_MAX_PENCE = 100000;

// Expectation management (handover 1.4). One source of truth — shown on the
// signup page, the customer portal and in the plan document email.
// Goes to the solicitor with the clause templates.
export const NOT_INCLUDED_COPY =
  "Not included: breakdown repairs. If something breaks, your engineer prioritises you and repair work is chargeable at your plan discount. This plan is a maintenance & priority agreement, not an insurance policy.";

export const TRADESURA_FEE_RATE = 0.2;

// Review 3 — our 20% is rounded DOWN to the penny, in the engineer's favour:
// £15.99 → fee £3.19, engineer keeps £12.80. Stripe's processing cost comes
// out of TradeSura's share, never the engineer's 80%.
export function appFeePence(priceMonthlyPence: number): number {
  return Math.floor(priceMonthlyPence * TRADESURA_FEE_RATE);
}
