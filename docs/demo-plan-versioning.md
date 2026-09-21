# Plan-tier versioning + plan-room doors

Build Guide Part 1.1 — "plan editor with versioning" and two of the five
doors into the plan room. Root + mobile typecheck / lint green; 116/118 tests
(the 2 failures are the pre-existing `gas-safe.test.ts` integration cases that
need a live DB). 2026-09-09.

## The bug this closes

`Plan` snapshotted **price** (and Stripe locks the billing amount), but the
tier **name and clauses were read live** — `lib/plan-doc.ts`,
`app/portal/[token]/page.tsx` and `lib/reminders.ts` all went through
`plan.tier`. Editing a tier therefore silently rewrote the plan document of
every customer already on it. That breaks **LAW: plan wording is locked**.

## What changed

- **Migration `0012_plan_agreed_tier`** — `Plan.agreedTier JSONB?` (nullable,
  no default; applies on `prisma migrate deploy`).
- **`lib/plan-tier.ts`** (new) — one place that owns the rule:
  - `snapshotTier(tier)` → `{ name, isRecommended, clauses[] }` from the
    approved clause relation. Engineer free-text lines are **not** carried.
  - `resolvePlanTier(plan)` → the agreed snapshot when present, else the live
    tier, plus `versioned: boolean`. Malformed snapshot → falls back to live.
- **Snapshot written at tier-selection** — both paths:
  `app/api/signup/[token]/choose` (doorstep) and `app/api/p/[slug]/start`
  (public plan page). Re-picking while still PENDING re-snapshots; once ACTIVE
  the routes 409 as before.
- **Reads switched to `resolvePlanTier`** — `lib/plan-doc.ts` (activation
  email), `app/portal/[token]/page.tsx` (the customer's "what's included"),
  `lib/reminders.ts` (`hasCp12` / `tierName`).
- **`GET`/`PUT /api/tiers/[tierId]`** now return `activePlanCount`
  (ACTIVE + PAUSED on that tier).
- **`mobile/app/tier/[tierId].tsx`** — when editing an existing tier with
  customers on it, an amber line: *"N customers on this plan. They stay on the
  version they agreed — your changes apply to new sign-ups only."*
- Plans created before the migration have `agreedTier = null` and keep
  reading the live tier — no behaviour change for them.

## Doors into the plan room

- **Dashboard** (`mobile/app/(tabs)/index.tsx`) — new "📋 My plans" quick
  action above the Show-a-customer / Invite row → `/(tabs)/plans`.
- **Offer → New customer** (`mobile/app/offer/index.tsx`) — "Manage my plans →"
  link under the new-customer form → `/(tabs)/plans`.
- Already wired before this slice: Getting Started step 2, the More hub row,
  the offer gate's "build your plan" link (shown when `tierCount === 0`).

## Also

- **`prisma/seed.ts`** — the 12-faker-customer block is now behind
  `SEED_FAKE_CUSTOMERS=1`. It attached fake customers to `engineer.findFirst()`,
  which on a shared dev DB is a real account — the likely source of the
  "phantom customer" in Build Guide 1.3. (The API layer is correctly scoped:
  every customer query filters `where: { engineerId }` and `getEngineerId()`
  is JWT-verified with no fallback — run the SQL in the handover notes against
  the environment where it was seen to confirm which account owns the row.)

## Walk it

1. Build a tier, offer it, complete signup on a phone → plan goes ACTIVE, plan
   document email lists the agreed clauses.
2. Edit that tier — remove a clause, rename it, change the price. The editor
   shows the "1 customer on this plan…" line.
3. Re-open the customer's portal link → still shows the **originally agreed**
   name + clauses. New sign-ups get the edited version.
4. `npm test` → `tests/plan-tier.test.ts` is the standing proof.
