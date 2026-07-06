// Solicitor-approved clause library. Wording is locked: plan documents
// assemble ONLY from these templates (CLAUDE.md §Compliance 1).
// Solicitor review before first real customer is a human task.

export const CLAUSE_TEMPLATES = [
  {
    code: "ANNUAL_SERVICE",
    title: "Annual boiler service",
    kind: "CORE",
    sortOrder: 1,
    bodyText:
      "We will carry out one scheduled service of your boiler in each 12-month plan period, including the safety checks and maintenance recommended by the manufacturer.",
  },
  {
    code: "PRIORITY_48H",
    title: "Priority booking within 48 hours",
    kind: "CORE",
    sortOrder: 2,
    bodyText:
      "As a plan member you receive priority when booking appointments. We aim to attend within 48 hours of your request during normal working hours.",
  },
  {
    code: "NO_CALLOUT_FEE",
    title: "No call-out fees",
    kind: "ADD",
    sortOrder: 3,
    bodyText:
      "No call-out charge applies to visits requested under this plan. Any work carried out during a visit is chargeable at our standard rates unless otherwise agreed.",
  },
  {
    code: "LABOUR_DISCOUNT_15",
    title: "15% off labour",
    kind: "ADD",
    sortOrder: 4,
    bodyText:
      "A 15% discount applies to our standard labour rates for work arising from visits made under this plan.",
  },
  {
    code: "HEALTH_CHECK",
    title: "Annual system health check",
    kind: "ADD",
    sortOrder: 5,
    bodyText:
      "A visual inspection of your central heating system carried out alongside your annual service, with a written summary of findings.",
  },
  {
    code: "CP12",
    title: "Landlord gas safety record (CP12)",
    kind: "ADD",
    sortOrder: 6,
    bodyText:
      "One landlord gas safety record (CP12) per property in each 12-month plan period.",
  },
  {
    code: "PARTS_DISCOUNT",
    title: "10% off parts",
    kind: "ADD",
    sortOrder: 7,
    bodyText:
      "A 10% discount applies to parts supplied by us for work carried out under this plan.",
  },
  {
    code: "SAMEDAY_PRIORITY",
    title: "Same-day priority",
    kind: "ADD",
    sortOrder: 8,
    bodyText:
      "Requests received before 10am are prioritised for same-day attendance where availability allows.",
  },
] as const;

// Two-tap tier presets (spec Screen 03: Essential ~£9 / Plus ~£15 / Complete ~£22).
export const TIER_PRESETS = [
  {
    name: "Essential",
    priceMonthlyPence: 900,
    isRecommended: false,
    clauseCodes: ["ANNUAL_SERVICE", "PRIORITY_48H", "NO_CALLOUT_FEE"],
    suggested: "£8–11",
  },
  {
    name: "Plus",
    priceMonthlyPence: 1500,
    isRecommended: true,
    clauseCodes: [
      "ANNUAL_SERVICE",
      "PRIORITY_48H",
      "NO_CALLOUT_FEE",
      "LABOUR_DISCOUNT_15",
      "HEALTH_CHECK",
    ],
    suggested: "£14–17",
  },
  {
    name: "Complete",
    priceMonthlyPence: 2200,
    isRecommended: false,
    clauseCodes: [
      "ANNUAL_SERVICE",
      "PRIORITY_48H",
      "NO_CALLOUT_FEE",
      "LABOUR_DISCOUNT_15",
      "HEALTH_CHECK",
      "PARTS_DISCOUNT",
      "SAMEDAY_PRIORITY",
    ],
    suggested: "£20–25",
  },
] as const;

export const PLANLOCK_FEE_RATE = 0.2;

export function appFeePence(priceMonthlyPence: number): number {
  return Math.round(priceMonthlyPence * PLANLOCK_FEE_RATE);
}
