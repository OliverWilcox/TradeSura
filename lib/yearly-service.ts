// 30 Oct update §7.6 — "Why a yearly service matters", and the safe warranty
// wording to use everywhere written (customer page, texts, emails, cancel
// screens). The service keeps a warranty valid, never the plan itself.

export type ServiceReasonKey = "warranty" | "safety" | "bills" | "surprises";

export const WHY_YEARLY_SERVICE: { key: ServiceReasonKey; title: string; line: string }[] = [
  { key: "warranty", title: "Keeps you covered", line: "most manufacturers require a yearly service to keep your warranty valid" },
  { key: "safety", title: "Keeps you safe", line: "checks your boiler is working safely, including for carbon monoxide" },
  { key: "bills", title: "Helps keep bills down", line: "a well-maintained boiler runs more efficiently" },
  { key: "surprises", title: "Fewer nasty surprises", line: "small problems caught early, before they become costly breakdowns" },
];

/** The short text version, for texts, emails and cancel screens. */
export const SERVICE_SHORT_LINE = "A yearly service keeps your boiler safe, efficient and your warranty valid.";

/**
 * The block's lines in the order a visit reason asks for (§7.6 "ordered by
 * visit reason"); unknown or missing keys keep the default order.
 */
export function orderedServiceReasons(order?: string[] | null) {
  if (!order?.length) return WHY_YEARLY_SERVICE;
  const rank = (k: string) => {
    const i = order.indexOf(k);
    return i === -1 ? order.length + WHY_YEARLY_SERVICE.findIndex((r) => r.key === k) : i;
  };
  return [...WHY_YEARLY_SERVICE].sort((a, b) => rank(a.key) - rank(b.key));
}

// Which reason leads for each visit (lib/visit-reasons.ts keys): after a new
// boiler it's the warranty; after a breakdown, catching problems early.
const ORDER_BY_VISIT: Record<string, ServiceReasonKey[]> = {
  new_boiler: ["warranty", "safety", "bills", "surprises"],
  breakdown: ["surprises", "safety", "bills", "warranty"],
  yearly_service: ["safety", "warranty", "bills", "surprises"],
  landlord: ["safety", "surprises", "warranty", "bills"],
};

export function serviceOrderForVisit(reason: string | null | undefined): ServiceReasonKey[] | null {
  return (reason && ORDER_BY_VISIT[reason]) || null;
}
