# TradeSura Build Spec v1 — six-block build plan

Reconciles **Build Spec v1** (Matt Wood, 24 Aug 2026) and the two companion
screen docs against the code that already exists in this repo. Nothing in
here is built yet — this is the "plan before code" step. Approve or trim it
block by block.

## Decisions taken (2026-08-28, human)

| # | Question | Decision | Consequence |
|---|----------|----------|-------------|
| 1 | Payments: Stripe (spec) vs GoCardless (current) | **Switch to Stripe** | Tear out GoCardless; provision Stripe via Vercel Marketplace; rebuild mandate/subscription/payout/app-fee. Update `CLAUDE.md`. |
| 2 | Engineer surface: PWA (spec) vs Expo native (current) | **Keep Expo native `mobile/`** | Spec's "PWA / native is phase 2" framing is overridden. E1–E12 stay React Native screens in `mobile/`; C1–C5 stay Next.js web. |
| 3 | New scope: E8 blast, E10 referrals, C5 claim, letter attribution | **All in scope** | Un-stub campaigns/blast and referrals. Update `CLAUDE.md` scope fence. |
| 4 | What now | **Full 6-block breakdown first** | This document. |

### `CLAUDE.md` edits required (human sign-off — I will draft, you commit)

- `## GoCardless — sandbox only` → replace with a `## Stripe — sandbox/test only`
  section (engineer = connected Express account; destination charges with
  `application_fee_amount`; go-live is a human sign-off; never route customer
  money through a TradeSura-held balance).
- Scope fence: move **campaigns/blast** and **referrals** from "still stubbed"
  to in-scope; add **claim page + letter split-test attribution**.
- `[DECISION 2026-08-03]` block stays (Expo native confirmed by decision 2).
- Gas Safe section: keep CSV lookup (see "Known deviations" below).

## What already exists (reuse inventory)

**Backend / shared (`/lib`, `/app/api`)**
- Prisma schema: `Engineer`, `Customer`, `Property`, `Appliance`,
  `ClauseTemplate`, `PlanTier`, `TierClause`, `Plan`, `GasSafeRecord`,
  `Event`, `OutboundSms`, `GcWebhookEvent`. 4 migrations.
- Compliance: `lib/compliance/blocklist.ts` (insurance-wording block, keep as
  is), `lib/compliance/interlock.ts` (gas-emergency, keep and keep enforcing —
  the spec never mentions it, `CLAUDE.md` makes it non-negotiable).
- `lib/clauses.ts` — 8 solicitor-track clause templates (SAFE ship / CARE
  hidden), `appFeePence()` (20%).
- `lib/sms.ts` — quiet-hours queue, alphanumeric engineer sender, dev console
  driver; `app/api/webhooks/sms-inbound` — STOP handling (writes
  `Customer.smsOptOut`).
- `lib/email.ts`, `lib/plan-doc.ts` (clause-assembled plan document email),
  `lib/reminders.ts` (30/14/3-day service reminders), `lib/import-customers.ts`
  + `app/api/customers/import` + `/import-contacts`, `lib/track.ts` + `Event`,
  `lib/auth.ts` (bearer for mobile + cookie for web, one `getEngineerId()`),
  `lib/gas-safe.ts` + `scripts/import-gas-safe.ts`.
- API routes for: dashboard, customers, tiers, offer, jobs, messages, payouts
  (lite), settings, onboarding phone OTP, signup (customer), portal, verify,
  trades.
- Tests: 53 green across blocklist, interlock, clause library, gas-safe,
  gocardless, plan-doc, reminders, sms.

**Engineer app (`mobile/`, Expo SDK 57, NativeWind 4)**
- Built: sign-in, sign-up wizard (3 steps, SMS OTP, Gas Safe verify, trade
  interest), onboarding (DD connect — currently GC), tabs (home/dashboard,
  customers, plans, jobs, more), tier editor `tier/[tierId]`, offer
  `offer/[planId]`, customers/import-contacts, payouts, messages, trades,
  coming-soon.

**Customer web (`app/p`, `app/portal`)**
- `p/[slug]/signup/[token]` + `/confirmed` — tokenised doorstep signup, 3-tier
  anchor, price-before-mandate, GC hosted-flow redirect.
- `portal/[token]` + `/manage` + `/report` — portal, 2-tap cancel
  (`cancel-flow.tsx`), report-a-problem behind the emergency interlock
  (`emergency-stop.tsx`).

**To be torn out (decision 1)**
- `lib/gocardless.ts`, `tests/gocardless.test.ts`, `app/api/gc/**`,
  `GcWebhookEvent` model, `Engineer.gcOrganisationId/gcAccessToken`,
  `Customer.gcCustomerId`, `Plan.gc*` fields, `lib/clauses.appFeePence`
  callers, `docs/demo-full-build.md` §2/4/5/7 GC steps, `mobile/lib/gc.ts` +
  onboarding GC wiring. This is working, tested code and a working sandbox
  demo — the teardown is real, do it in one commit at the top of Block 1.

## Cross-cutting workstream: GoCardless → Stripe (S1)

> **Status 2026-08-28: the plumbing swap is DONE** (commit pending). GoCardless
> code/tests/routes/schema removed; `lib/stripe.ts`, `app/api/stripe/{connect-link,
> webhook}`, migration `0005_stripe`, `tests/stripe.test.ts` added; engineer
> onboarding, customer checkout (hosted Stripe Checkout, Bacs), cancel, and
> status-poll repointed. Flat `application_fee_percent: 20`. Root + mobile
> typecheck/lint/build green. **Not yet run against live Stripe test mode** —
> needs `vercel integration add stripe` (terms acceptance) + the dashboard
> steps in `docs/demo-full-build.md` §0. The embedded Payment Element (C2),
> weekly-payout UI (E11), dunning (S2), and the 20%+32p refinement remain as
> the later blocks describe.

Original scope of this workstream, for reference — do it **first**, before any
Block 1 UI, and prove it with real test-mode objects (spec Section 6, step 3).

1. **Provision** — `Skill(vercel:marketplace)` → discover → install Stripe;
   pull keys via `vercel env`. Test mode only; a hard `assertTestMode()` guard
   mirroring the old `assertSandbox()`.
2. **`lib/stripe.ts`** replacing `lib/gocardless.ts`:
   - `createConnectedAccount()` (Express, `capabilities: bacs_debit_payments`,
     `card_payments` off), `accountOnboardingLink()` (return/refresh URLs deep
     link to `tradesura://onboarding`).
   - Customer signup: `Customer` + Bacs `PaymentMethod` (via Payment Element,
     client-side) + `Subscription` (monthly `Price` = plan price) as a
     **destination charge** with `application_fee_percent` (or
     `application_fee_amount` per collection) = 20% + processing, `on_behalf_of`
     + `transfer_data.destination` = engineer account. Confirm the app-fee
     lands in test mode before building any screen.
   - `payout` schedule: weekly, anchor Friday, on the connected account.
   - `cancelSubscription()`, `pauseSubscription()` (dunning), `getBalance()` /
     `listPayouts()` / `listBalanceTransactions()` for E11.
3. **Webhooks** — `app/api/stripe/webhook` replacing `app/api/gc/webhook`.
   `Stripe-Signature` verify with the endpoint secret; idempotency table
   `StripeWebhookEvent` (rename of `GcWebhookEvent`). Map:
   - `checkout.session.completed` / `setup_intent.succeeded` /
     `mandate.updated` → mandate pending vs active.
   - `invoice.paid` → `activatePlan()` (already idempotent — repoint it off
     GC ids onto `stripeSubscriptionId`), `payment_confirmed` event.
   - `invoice.payment_failed` → S2 dunning (PAYMENT ISSUE, customer SMS).
   - `customer.subscription.deleted` / `.paused` → plan CANCELLED / PAUSED.
   - `account.updated` → engineer payouts-ready / restricted state for E11/E12.
4. **Schema migration `0005_stripe`**:
   - `Engineer`: drop `gc*`; add `stripeAccountId`, `stripeAccountStatus`
     (`pending|active|restricted`), `payoutsEnabledAt`.
   - `Customer`: `gcCustomerId` → `stripeCustomerId`.
   - `Plan`: `gcBillingRequestId/FlowId/MandateId/SubscriptionId` →
     `stripeCheckoutSessionId`, `stripeSubscriptionId`, `stripeMandateStatus`.
   - New `StripeWebhookEvent`.
5. **`activate.ts`, `app/api/signup/[token]/choose`** — repoint onto Stripe;
   `choose` returns a client secret for the embedded Payment Element instead
   of a redirect `authorisationUrl`.
6. **Docs** — rewrite `docs/demo-full-build.md` payments steps; new
   `docs/demo-stripe-loop.md`.

**Human prerequisites**: Stripe account + test-mode platform/Connect
enabled; complete platform profile for Bacs; Matt's own £1 live plan is a
Block 2 gate, not ours.

## Block 1 — the money loop  (spec week 1)

> **Status 2026-08-28: DONE** (commit pending). Migrations `0006_block1`
> (`Engineer.attribution/packAddress/packRequestedAt`, `Customer.source`);
> E1 "how did you hear" + referral capture; E2 4-step resume-anywhere wizard
> (`/api/onboarding/pack`, `/api/me` step flags); E6 preset rename (Boiler
> Care / Boiler + Controls / Landlord Care) + £8–25 clamp + earnings copy +
> `plan_published`; C1 public page `app/p/[slug]` + `components/public-signup`
> + `app/api/p/[slug]/start` (creates Customer+Plan cold, `source: web`,
> abandon nudges, live Gas Safe badge, `page_visit`); C2 kept as hosted
> Stripe Checkout (embedded Payment Element deferred — see note); C3 honest
> Bacs-pending copy + `notifyEngineer` ping on activation + `plan_live`.
> Root + mobile typecheck/lint/build/export green. Demo: `docs/demo-block1.md`.
>
> **Update 2026-08-28: C2 is now the embedded Stripe Payment Element**
> (`components/embedded-checkout.tsx` + `@stripe/react-stripe-js`) — the
> customer stays on the white-label page, no redirect. `createEmbeddedSubscription`
> in `lib/stripe.ts` creates the platform Customer + an incomplete
> destination-charge subscription and returns the confirmation secret. All
> six prototype gaps closed — see `docs/demo-gap-close.md`.

**Goal:** sandbox end-to-end — engineer signs up → publishes a live plan →
a customer completes a Bacs Direct Debit → subscription created with the
20% app fee.

| Screen | State now | Work |
|---|---|---|
| **S1 Stripe** | GoCardless | Full cross-cutting workstream above. |
| **E1 Signup** | 3-step wizard built | Add "How did you hear about us?" chips (Letter / Another engineer / Online / Other) → `Engineer.attribution` JSON; referral-code field when "Another engineer"; pre-fill + hide when arriving from claim/referral link; keep SMS OTP + Gas Safe verify; duplicate-Gas-Safe-number guard; register-down → "verification pending". |
| **E2 Onboarding wizard** | `onboarding.tsx` = DD connect only | Rebuild as the 4-step wizard: **1 Get paid** (Stripe Express onboarding, moved to first), **2 Your first plan** (deep-link into E6 with Boiler Care £12 pre-filled), **3 Your customers** (E8 import, skip = quiet link), **4 Your pack** (postal address for founding-member cards). Resume at any abandoned step. |
| **E6 Plan builder** | `tier/[tierId]` + `app/api/tiers` built | Rename presets **Boiler Care £12 / Boiler + Controls £15 / Landlord Care £15** (remap `lib/clauses.ts` template groupings; keep clause wording + SAFE/CARE gate + blocklist on custom labels via `/api/tiers/check-wording`). Price stepper £8–£25 / 50p. Earnings preview: "you keep 80% less ~32p processing" with honest expander. Publish → live `/p/{slug}` + copy-link + QR download. Max 3 tiers; price edits affect new signups only. |
| **C1 Plan page** | only the tokenised `/p/[slug]/signup/[token]` exists | New **public** `app/p/[slug]/page.tsx` (no token) for blast / QR / referral / demo traffic: engineer header, **live** Gas Safe badge (re-check `GasSafeRecord` at request time), ticked locked-wording inclusions, "Cancel anytime", How-it-works, fixed FAQ set, legal footer (DD Guarantee + not-insurance line). Keep the tokenised variant for doorstep pre-fill. |
| **C2 Checkout** | GC hosted-flow redirect | Rebuild with the **Stripe Bacs Payment Element** embedded (name, sort code, account number), DD Guarantee inline, honest first-collection date, versioned terms checkbox → confirm. States: mandate pending (Bacs not instant), invalid details inline, duplicate (same mobile + engineer). |
| **C3 Confirmation** | `/confirmed` built | Copy pass for honest Bacs 2–3 working-day pending; "service month: {month}"; engineer ping (see S3). |

**Done means:** on test data, `signup → publish plan → /p/{slug} → checkout →
Stripe Subscription + mandate + 20% application fee`, verified in the Stripe
test dashboard. `npm run test && typecheck && lint` green in both packages.
Demo on a real phone.

## Block 2 — visibility + claim  (spec week 2, C5 hard deadline)

> **Status 2026-08-28: DONE.** Migration `0007_claim_codes`. E3 next-payout +
> ≥5 guard; E7 segments + inline offer + `/customer/[id]` detail + record
> service / pause / remove; E11 real Stripe payout summary + restricted
> banner; C5 `/claim` + `ClaimCode` + `/api/claim/resolve` + deep-link into
> the wizard + lossless server-side redeem; S4 event taxonomy. E8 blast
> pulled forward here. Demo: `docs/demo-block2.md`.

**Goal:** the engineer can see his money reconcile to Stripe; letter
recipients can claim.

| Screen | State now | Work |
|---|---|---|
| **E3 Dashboard** | `(tabs)/index` + `/api/dashboard` built | Money card = live MRR from Stripe subscriptions; "N plans live"; next payout amount + date from Stripe; **missed-money counter** (reuse `prizeYearlyPence`; hide < 5 non-plan contacts); 3-line Today list (services due → E9, payment retrying → E7, referral progress → E10); Send Offer FAB persistent across tabs; day-one empty state. Reconcile-to-the-penny test. |
| **E7 Customers** | `(tabs)/customers` + `/api/customers` built | Segment tabs All / On plan / **Not on plan** (default) / Attention; inline `[Offer]` on non-plan rows; sort never-offered → stale (>7d) → newest. Detail: header, plan block (Stripe DD status, next collection, service status), **timeline** (offers, plan start, services, payments — from `Event`), actions Record-a-service / Offer / Pause / Remove. New **`Offer`** model (`customerId, channel, sentAt, visitedAt`). |
| **E11 Payouts** | lite summary in More + `/api/payouts` | Full screen + new nav tab: next payout card with breakdown expander (collections → 80% → processing pence → referral bonuses → total), history list, CSV export (keep `payouts/export`), restricted-account red banner + Stripe Express dashboard deep link, first-payout celebration moment. |
| **C5 Claim page** | none | New web `app/claim/page.tsx` + `app/api/claim`. Single field, `TSH-XXXXX` (case/dash forgiving), QR deep-links pre-fill. Valid → "Welcome, {first} — reserved for {business}" → hand to app (see open question Q1). Invalid → no dead end, generic signup tagged `letter, code-failed`. Suppression-aware. New **`ClaimCode`** model (`code, firstName, businessName, letterBatch, variantCell, suppressedAt, redeemedByEngineerId`). Attribution must be lossless — it is the split-test measurement. **Load + tested by spec's 12 Sept date.** |
| **S4 Telemetry** | `Event` + `track()` built | Add the spec's event taxonomy + attribution payloads on every Block-1/2 flow: `signup_started/completed`, `stripe_onboarded`, `plan_published`, `book_imported`, `blast_sent`, `offer_sent`, `page_visit`, `checkout_started`, `plan_live`, `service_recorded`, `reminder_sent`, `payment_failed/recovered`, `cancellation`, `referral_*`. |

**Done means:** dashboard MRR == Stripe; claim code → personalised signup →
account carries `letterBatch + variantCell` end to end; C5 load-tested.

## Block 3 — the offer machine  (spec week 3)

> **Status 2026-08-28: DONE.** Migration `0008_suppression`. E4 script card +
> `customerId` preselect + WhatsApp share; E5 demo mode (`/demo`, WebView,
> `channel=demo`); E8 blast (`/api/customers/blast` + `/customers/blast` +
> 72h results); S3 `Suppression` store + `consentBasis`. Follow-up: full
> `MessageTemplate` registry table. Demo: `docs/demo-block3-5.md`.

**Goal:** import a book, blast it, watch a signup close in demo mode — all
attributed.

| Screen | State now | Work |
|---|---|---|
| **E4 Send Offer** | `offer/` built | Add the script card (shown until 10 offers sent, then collapsible); WhatsApp share-sheet option beside SMS; "we'll nudge you in 3 days" = stored engineer reminder (never an auto customer message); flip contact to OFFERED + fire `offer_sent` on both channels. |
| **E5 Demo mode** | none | Dashboard → open `/p/{slug}?demo=1` full-screen via `expo-web-browser` with a hand-over ribbon; customer completes C2 on the engineer's phone without exposing his account; resulting subscription tagged `channel=demo`. |
| **E8 Book import & blast** | import built; blast stubbed (campaigns) | Un-stub. Composer: pick plan → fixed templated message (E4 family, name + link + STOP) → **required own-customers checkbox** (recorded consent basis) → staggered send ~10 min over the `OutboundSms` queue → live progress → **72h results card** (`sent / page visits / plans live / £/yr`) reconciled to telemetry. Replies land on the engineer's number (existing `sms-inbound`). |
| **S3 Messaging** | queue + STOP + sender built | Add a **`MessageTemplate`** registry table (id, audience, trigger, body, variables) — move the currently-inline template strings into it; nothing sends that isn't registered. Add `consentBasis` per send (`plan-member-transactional` / `engineer-initiated` / `marketing`). Promote `Customer.smsOptOut` into a real cross-channel **`Suppression`** store (mobile/email, source, ts); every send path checks it, including mid-blast. |

**Done means:** real phone — import 100-row CSV → blast → page visit →
demo-mode signup, every step attributed; STOP suppresses before the next
queued send. (Solicitor wording drop lands in `MessageTemplate` + clause
config with no code change — spec's 8 Sept.)

## Block 4 — retention + growth  (spec week 4)

> **Status 2026-08-28: DONE.** Migration `0009_referrals_dunning`. E9
> member-auto / non-member tap-to-send ("Book + offer" on Jobs,
> `/api/jobs/remind`); E10 `Engineer.referrerId` + `/api/referral` +
> `mobile/app/referral.tsx` + `/r/[slug]` + `next/og` share card +
> auto £50 Stripe transfer on 5 live plans (`lib/referral.ts` from
> `activatePlan`); S2 dunning in the Stripe webhook (payment_failed SMS +
> `paymentFailedAt` + paused/recovered). Demo: `docs/demo-block3-5.md`.

| Screen | State now | Work |
|---|---|---|
| **E9 Reminders** | `lib/reminders.ts` + `(tabs)/jobs` built | Split member vs non-member: **member** = auto-send at lead time (default 3 wks) + engineer to-do ("plan visibly does something"); **non-member** = engineer-tapped one-message combo (book service **and** offer plan) — never auto. Settings: lead time, quiet days, member auto on/off. Recording a service reschedules next year. |
| **E10 Referrals** | none | New `app/api/referral` + `mobile/app/referral.tsx` + web `/r/{slug}`. Money card "£50 per engineer", WhatsApp share with a **server-rendered branded image** ("{name} recommends TradeSura" + personal QR), pre-filled invite text. Status list: Invited → Signed up → Building (n/5) → £50 PAID, with one-shot stage pings. Bounty = platform-funded Stripe transfer to the referrer's connected account on their 5th live plan, shown in the E11 breakdown. Anti-gaming admin flag. New **`Referral`** model (`referrerId, inviteeId, stage, paidAt`); `Engineer.referrerId`. Flat bounty, no overrides. |
| **S2 Dunning** | none (GC path had partial) | Stripe Smart Retries (3 / 2 wks). `invoice.payment_failed` → `Plan`/customer PAYMENT ISSUE + customer SMS (C4 link); retries exhausted → `Subscription.pause` + both parties told + 60-day one-tap resume. Engineer income never silently drops — every drop shows a reason in Attention. `service_overdue_days` computed per member as a dashboard flag only (auto-pause automation stays phase 2). |

**Done means:** reminder fires on schedule; £50 lands in a test payout;
failed-payment path messages correctly.

## Block 5 — finish + harden  (spec week 5)

> **Status 2026-08-28: DONE (code).** E12 More-hub nav + support links; C4
> cancel reason chips → `plan_cancelled.reasonChip` + engineer notified;
> C3 welcome SMS added to `activatePlan`. Remaining is genuinely human:
> on-device testing, load testing, final wording, empty/error-state sweep.
> Demo: `docs/demo-block3-5.md`.

| Screen | State now | Work |
|---|---|---|
| **E12 Settings** | `(tabs)/more` built | Logo upload (customer-page branding), Stripe status card + manage link, notification toggles (plan signup default on, payment issues, referral, service to-dos), "How to sell more plans" FAQ, WhatsApp support link, legal/export/delete. |
| **C4 Manage & cancel** | `portal/[token]` + `/manage` + `cancel-flow` built | Move to magic-link auth (SMS/email) alongside the existing `portalToken`; "Update payment" = re-run the Bacs Payment Element (also the S2 dunning landing); cancel = 2 taps + reason chips + one factual interstitial → immediate confirmed cancel at period end + engineer notified with reason; customer → NOT ON PLAN, re-offer suppressed 6 months. |
| polish | — | Welcome SMS/email content review; every screen's empty + error state; load + cracked-Android/4G device testing; `MessageTemplate` + clause wording finalised. |

**Done means:** full walkthrough on a real phone, zero blockers, every
"accept when" list in the spec green.

## Block 6 — dress rehearsal  (spec week 6)

Matt live end-to-end as engineer **and** customer on his own boiler with real
money (Stripe live-mode switch, human sign-off); fix list; pilot onboarding
materials; support WhatsApp ready. **Done means:** one real plan collecting
real money with a real payout received.

## Known deviations from Build Spec v1 (flagged, not silently applied)

1. **Platform** — spec says PWA; decision 2 keeps Expo native. E1–E12 are RN.
2. **Gas Safe "live register lookup"** — there is no public Gas Safe Register
   API. Keep the provided-CSV `GasSafeRecord` exact-match lookup (already
   built, `CLAUDE.md` §Gas Safe). "Live" = re-queried per request, not cached
   in the badge. Refresh of the CSV stays a cron concern.
3. **Gas-emergency interlock** — absent from the spec; retained and enforced on
   every customer free-text input (C2 optional notes, C4, report-a-problem,
   any future message field). `CLAUDE.md` §Compliance 4 wins.
4. **Naming** — repo/folder/db stay `planlock`; plan refs stay `TSH-`; deep
   link stays `tradesura://`; customer URLs are `tradesura.com/p|r|claim`.
   Schema enum/comment references to "GoCardless" get renamed in `0005`.
5. **`GcWebhookEvent` / `appFeePence` / gocardless.test.ts** removed, not kept
   "just in case" — dead payment code is a hazard.

## Open questions (need answers before the block they touch)

- **Q1 (Block 2):** Claim page is web but the engineer app is native. After a
  valid code, do we (a) complete E1 signup on the web then send an app link,
  or (b) redirect straight to an app-store/deep link carrying the code? (a) is
  more robust for attribution; (b) is fewer steps. Recommend (a).
- **Q2 (Block 1):** App-fee mechanics — `application_fee_percent` on the
  subscription vs `application_fee_amount` per invoice. Percent is simpler;
  amount lets us fold in the exact 32p processing. Recommend amount, computed
  per collection, rounding in the engineer's favour (spec S1).
- **Q3 (Block 3):** WhatsApp "send" from a native app = share-sheet handoff
  only (we can't confirm delivery). Confirm that's acceptable for the
  `offer_sent` event (mark channel `whatsapp`, `delivered=unknown`).
- **Q4 (Block 4):** Referral share image — render server-side with
  `@vercel/og` / Satori (adds a dep) or pre-compose a template + overlay QR?
  Recommend Satori route.
- **Q5 (general):** `mobile/` is Expo SDK 57 with a no-workspace sibling
  layout. Adding Stripe React Native (`@stripe/stripe-react-native`) for the
  Payment Element in demo mode (E5) — or keep demo mode as a WebView to the
  web C2 and avoid the native SDK entirely? Recommend WebView (no native
  Stripe dep, one checkout implementation).

## Suggested first PR (Block 1, part 1)

1. `CLAUDE.md` edits (decisions 1 & 3) — separate commit, human commits it.
2. Rip out GoCardless (one commit).
3. `Skill(vercel:marketplace)` → install Stripe; `lib/stripe.ts` +
   `0005_stripe` migration + `app/api/stripe/webhook`.
4. Prove the 20% app fee on a test subscription (no UI) — demo to Matt.

Then E6/C1/C2/C3 in the following PRs.
