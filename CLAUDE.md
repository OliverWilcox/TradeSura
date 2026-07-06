# Planlock — project instructions

Care-plan platform for UK gas engineers. Engineers build tiered maintenance plans,
sell them on the doorstep via a link/QR, customers pay by GoCardless Direct Debit,
Planlock takes a 20% app fee. Full product spec: @docs/design-spec.html
(13 annotated screens — treat its "Purpose / Key logic" cells as requirements).

## Scope fence — read this first
- Build **P0 screens only**: 01 (onboarding + Gas Safe verify), 02 (dashboard),
  03 (plan builder), 04 (doorstep flow), 05 (customer book, CSV import only),
  09 (customer signup web), 10 (customer portal + plan document email),
  plus the gas-emergency interlock component.
- Do NOT build P1/P2 features (campaigns, tickets UI, payouts detail,
  cancel/save flow, referrals) even though the spec describes them. Stub routes
  with a "coming soon" page where navigation requires it.
  [DECISION 2026-07-06, human] Scope extended post-P0: Screen 07 (service
  calendar + reminder engine, lite: no self-book slots) and a working "More"
  hub (settings, GC status, payouts summary, sign out) are now in scope.
- When the spec and this file conflict, this file wins. When unsure between two
  approaches, present both briefly and ask — do not decide architecture alone.

## Stack  [DECISION — swap only if the assigned dev prefers otherwise, then update this file]
- Next.js (App Router) + TypeScript (strict). One repo, one app.
- Postgres + Prisma. Tailwind for styling — implement the spec's design tokens
  (Flue Iron #232A33, Burner Blue #0E7FD0, Copper #C2622E; Barlow / Barlow
  Condensed / IBM Plex Mono) as Tailwind theme values.
- Engineer surface = **mobile-first responsive web app (installable PWA)**, not
  native, for v1. Customer surface = plain web pages from tokenised links, no
  accounts, no app. [DECISION] Mobile packaging: engineer surface ships as an
  installable PWA now and gets a Capacitor wrap after this build is proven;
  customer surface stays plain web, no accounts, no app.
- SMS and email behind thin provider interfaces (`lib/sms.ts`, `lib/email.ts`)
  with a console/dev driver; real provider keys are a human task, not yours.

## GoCardless — sandbox only
- Environment: sandbox. Never switch to live; go-live is a human sign-off.
- Model: engineer is the merchant. Engineer connects via GoCardless OAuth;
  store their org tokens. Create mandates via the hosted Billing Request flow;
  create monthly subscriptions with Planlock's 20% **app fee** attached.
- Consult the current GoCardless API docs for exact endpoints/fields rather
  than assuming; verify the app-fee behaviour on subscriptions in sandbox.
- Handle webhooks (mandate status, payment paid/failed) with signature
  verification; webhook secret from env.
- Planlock never holds funds. Never implement any flow that routes customer
  money through a Planlock account.

## Compliance — non-negotiable, build these as code not comments
1. **Plan wording is locked.** Tier documents assemble ONLY from the clause
   templates table. Free-text service descriptions must pass a blocklist:
   never output "breakdown", "repair(s) included/free", "we will fix",
   "guaranteed response/fix", "insurance", "cover(ed) for breakdowns".
   Blocked input → inline explanation ("that wording makes this an insurance
   product") + suggestion of the nearest approved clause.
2. **Price before mandate.** The customer signup page shows the full monthly
   price for the selected tier on every step before the GoCardless flow starts.
   No fee may appear for the first time at or after the mandate step.
3. **Cooling-off + cancellation.** 14-day cooling-off stated at signup and in
   the plan email. Cancellation path exists in v1 as: portal → "Manage plan" →
   confirm (2 taps) → email confirmation + subscription cancelled via API.
   (The save-flow screens are P1; the raw cancel path is P0 and must work.)
4. **Gas-emergency interlock.** Every free-text customer input (report a
   problem, messages when built) runs a keyword check (gas smell/leak, carbon
   monoxide, CO alarm, fumes, dizzy + boiler). Match → full-screen stop page:
   advise not to use switches/naked flames, open windows, and call the
   National Gas Emergency line **0800 111 999** — with a required "I have
   called / this is not an emergency" acknowledgement before the form can
   continue. Log every trigger to the events table.
5. **SMS rules.** Sender = engineer trading name; every marketing-class SMS
   ends "Reply STOP to opt out"; opt-outs honoured platform-wide; no sends
   20:00–08:00 (queue instead).
6. **Data.** No real personal data in dev — seed with faker. Secrets only via
   `.env` (git-ignored); never print tokens in logs. UK spelling and £ / DD
   terminology throughout customer-facing copy.

## Data model (guide — refine in your Day 1 plan)
Engineer(gasSafeNo, tradingName, logo, gcOrgTokens…) · Customer · Property/
Appliance · PlanTier(clauses[], priceMonthly) · Plan(customer↔tier, gcMandateId,
gcSubscriptionId, status: pending/active/paused/cancelled) · ClauseTemplate ·
Event(name, actor, meta, ts). Wire analytics events from day one:
engineer_signed_up, gas_safe_verified, tier_created, doorstep_link_sent,
signup_opened, tier_selected, mandate_active, plan_cancelled,
emergency_interlock_triggered.

## Gas Safe verification
A CSV of the register will be provided at `data/gas_safe.csv` (columns: reg no,
name, company, categories). Import to a lookup table; verify = exact reg-no
match returning name/company for confirmation. Refresh is a cron concern later.

## Working conventions
- Plan before code: for each day-slice, produce a short written plan and task
  list, get approval, then build.
- Minimal diffs. Never refactor unrelated code. One commit per logical change.
- After every change: typecheck + lint + tests green before moving on.
- Each slice ends with a runnable demo script (`docs/demo-dayN.md`) proving the
  slice's "done means" line from the spec's build-week table.
- Update this file only when a [DECISION] is changed by a human.
