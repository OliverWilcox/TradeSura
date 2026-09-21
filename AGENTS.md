# Planlock — project instructions

[DECISION 2026-07-07, human] Product renamed **TradeSura** (logo at
`public/logo.svg`). All user-facing branding uses TradeSura; repo/folder/db
names stay `planlock`. Plan refs are now `TSH-`.

Care-plan platform for UK gas engineers. Engineers build tiered maintenance plans,
sell them on the doorstep via a link/QR, customers pay by Direct Debit (Stripe
Bacs), Planlock takes a 20% app fee. Full product spec: @docs/design-spec.html
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
  [DECISION 2026-08-03, human] During the Expo rewrite, Messages & tickets,
  Trades & TradePacks, and the full Payouts & Collections screen (all three
  had already been built beyond original P0 scope in earlier handovers) were
  briefly stubbed as "coming soon" and then explicitly restored to mobile
  scope — Messages carries the engineer's only visibility into the
  gas-emergency interlock firing, which makes it more than a nicety. Campaigns,
  cancel/save flow, and referrals remain out of scope, still stubbed.
- When the spec and this file conflict, this file wins. When unsure between two
  approaches, present both briefly and ask — do not decide architecture alone.

## Stack  [DECISION — swap only if the assigned dev prefers otherwise, then update this file]
- Next.js (App Router) + TypeScript (strict), at the repo root.
- Postgres + Prisma. Tailwind for styling.
  [DECISION 2026-09-04, human] Design system is **TradeSura Screen Designs v2
  · Full Dark** (`app/assets/TradeSura_Screen_Designs_v2_Dark.html` +
  `TradeSura_Welcome_Screen_W0.html`), superseding the 2026-08-28 light system
  below. Navy depth (bg #0B1A2E, surfaces #122540/#193150/#213C60), **brand
  blue #5FA3F0** (was TS Blue #1966CC — that hex is kept as `flame-deep`),
  **money-green #3DD68C** (pounds only, was #0E9F5B), amber #F2B84B, red
  #FF6B6B, white-alpha lines (10%/18%), **system font** (unchanged). Primary
  buttons are now **white bg / navy text**, not filled brand-colour — green is
  reserved for the customer's "Join" and the engineer's WhatsApp share only.
  Cards have three variants: flat (default), `raised` (surface gradient +
  shadow), `hero` (deep navy gradient — money cards, celebration moments).
  This is a one-way palette swap, no light-mode variant. Semantic Tailwind
  keys are kept so screens didn't churn: `flame`=brand blue, `copper`/`ok`=
  money green, `iron`=dark chrome, `warn`=amber, `panel`=surface-2. Tokens
  live in `app/globals.css` `@theme` and `mobile/tailwind.config.js` — keep the
  two in sync. Font weight comes from `font-{medium,semibold,bold}` utilities
  (the old `font-sans-bold` / `font-disp` family classes were converted).
  [SUPERSEDED 2026-08-28, human] Previously: TradeSura Build Spec v1 §1's
  light system — TS Blue #1966CC primary, money-green #0E9F5B, wash #F5F8FB,
  light chrome. Kept here for history; do not build against it.
- [DECISION 2026-08-03, human] Engineer surface is a native app built with
  Expo/React Native, in a sibling `mobile/` folder (own `package.json`, no
  workspace tooling) — supersedes the earlier PWA-now/Capacitor-later plan.
  Next.js is now the JSON API backend for that app, plus the customer web
  surface — the repo root's `app/` holds only `app/p/**`, `app/portal/**`,
  and `app/api/**`. See `mobile/AGENTS.md` for the mobile app's own
  conventions and setup gotchas.
- Customer surface = plain web pages from tokenised links, no accounts, no
  app — unchanged by the above.
- SMS and email behind thin provider interfaces (`lib/sms.ts`, `lib/email.ts`)
  with a console/dev driver; real provider keys are a human task, not yours.

## Stripe — test mode only  [DECISION 2026-08-28, human: swapped from GoCardless per TradeSura Build Spec v1; see docs/build-spec-v1-plan.md]
- Environment: test mode. `lib/stripe.ts` hard-refuses any key that isn't
  `sk_test_…`. Never switch to live; go-live is a human sign-off.
- Provisioned through the Vercel Marketplace (`vercel integration add stripe`),
  not a hand-wired SDK config.
- Model: engineer = Connect **Express** account (the settlement merchant, via
  `on_behalf_of`). Customer plans are monthly Bacs Direct Debit **subscriptions**
  created on the platform as **destination charges** — TradeSura's 20% taken as
  `application_fee_percent`, the balance transferred to the engineer's connected
  account, weekly payouts. Funds only ever pass through to the engineer;
  TradeSura never holds a customer balance and no flow may route customer money
  into a TradeSura-held account.
- Consult the current Stripe docs for exact params rather than assuming; the
  20%-fee-on-subscription behaviour is verified in `tests/stripe.test.ts` and
  against test-mode objects before any UI.
- Bacs settles on a delay: a plan goes ACTIVE only on `invoice.paid`, not at
  checkout. Handle webhooks (`account.updated`, `checkout.session.completed`,
  `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`)
  with signature verification via the Stripe SDK; `STRIPE_WEBHOOK_SECRET` from
  env, endpoint registered with "Listen to events on Connected accounts".
- Refining the flat 20% into "20% + ~32p processing borne by the engineer"
  (Build Spec S1 / Q2) is a follow-up — do it via an `invoice.created` webhook
  setting `application_fee_amount`, not by changing the fee rate.

## Compliance — non-negotiable, build these as code not comments
1. **Plan wording is locked.** Tier documents assemble ONLY from the clause
   templates table. Free-text service descriptions must pass a blocklist:
   never output "breakdown", "repair(s) included/free", "we will fix",
   "guaranteed response/fix", "insurance", "cover(ed) for breakdowns".
   Blocked input → inline explanation ("that wording makes this an insurance
   product") + suggestion of the nearest approved clause.
2. **Price before mandate.** The customer signup page shows the full monthly
   price for the selected tier on every step before the Stripe checkout starts.
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
Engineer(gasSafeNo, tradingName, logo, stripeAccountId, stripeChargesEnabled…) ·
Customer(…, stripeCustomerId) · Property/Appliance · PlanTier(clauses[],
priceMonthly) · Plan(customer↔tier, stripeSubscriptionId, mandateStatus,
status: pending/active/paused/cancelled) · ClauseTemplate ·
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
