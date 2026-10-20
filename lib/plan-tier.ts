// LAW (plan wording is locked). A PlanTier can be edited after customers have
// joined it, so the contract each customer agreed to is snapshotted onto their
// Plan (`agreedTier`) at tier-selection. Every read of the *agreed* plan — the
// plan document, the portal "what's included" list, CP12 reminder logic —
// resolves through here and prefers that snapshot over the live tier. Plans
// created before the column exists fall back to the live tier unchanged.
//
// The engineer's own free-text plan lines are deliberately NOT carried into
// the snapshot: they are display-only marketing, never contract text (see
// tests/plan-doc.test.ts), so nothing on the agreed-plan path should see them.

type ClauseFields = {
  code: string;
  title: string;
  bodyText: string;
  sortOrder: number;
  note?: string | null;
};

export type AgreedTierSnapshot = {
  name: string;
  isRecommended: boolean;
  clauses: ClauseFields[];
};

type LiveTier = {
  name: string;
  isRecommended: boolean;
  clauses: { clause: ClauseFields }[];
};

export type ResolvedTier = AgreedTierSnapshot & { versioned: boolean };

const bySortOrder = (a: ClauseFields, b: ClauseFields) => a.sortOrder - b.sortOrder;

export function snapshotTier(tier: LiveTier): AgreedTierSnapshot {
  return {
    name: tier.name,
    isRecommended: tier.isRecommended,
    clauses: tier.clauses
      .map((tc) => ({
        code: tc.clause.code,
        title: tc.clause.title,
        bodyText: tc.clause.bodyText,
        sortOrder: tc.clause.sortOrder,
        note: tc.clause.note ?? null,
      }))
      .sort(bySortOrder),
  };
}

function isSnapshot(v: unknown): v is AgreedTierSnapshot {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as AgreedTierSnapshot).name === "string" &&
    Array.isArray((v as AgreedTierSnapshot).clauses)
  );
}

export function resolvePlanTier(plan: {
  agreedTier?: unknown;
  tier?: LiveTier | null;
}): ResolvedTier | null {
  if (isSnapshot(plan.agreedTier)) {
    return {
      name: plan.agreedTier.name,
      isRecommended: Boolean(plan.agreedTier.isRecommended),
      clauses: [...plan.agreedTier.clauses].sort(bySortOrder),
      versioned: true,
    };
  }
  if (plan.tier) {
    return {
      name: plan.tier.name,
      isRecommended: plan.tier.isRecommended,
      clauses: plan.tier.clauses.map((tc) => tc.clause).sort(bySortOrder),
      versioned: false,
    };
  }
  return null;
}
