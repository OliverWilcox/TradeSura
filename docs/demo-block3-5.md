# Blocks 3–5 demo — offer machine, retention & growth, finish

Verified: root + mobile typecheck / lint / build / `expo export`; 107/109
unit tests (2 `gas-safe` need a DB). Migrations `0008_suppression`,
`0009_referrals_dunning`. Not walked live against Stripe + a device.

## Block 3 — the offer machine

### E4 · Send Offer
- The compose screen (`/offer`) takes a `?customerId=` param (from the E7
  inline **Offer** button) and pre-selects that customer.
- A **"What to say"** script card sits above the send button, auto-collapsed
  once the engineer has sent 10+ offers (`offersSent` from `/api/offer`).
- The live screen (`/offer/[planId]`) adds **"Also share on WhatsApp"** —
  opens `whatsapp://send` (falls back to `wa.me`) with the link pre-filled.
- `offer_sent` fires with `channel: sms` on every send.

### E5 · Demo mode
- Dashboard → **Show a customer** → `/demo` → opens the engineer's own
  `/p/{slug}?demo=1` in an in-app browser (PAGE_SHEET). The customer signs up
  on his phone without exposing his account.
- The page passes `channel: "demo"` through `PublicSignup` → `/api/p/{slug}/start`,
  so `tier_selected` / `checkout_started` carry `channel: demo` and
  `page_visit` logs `source: demo`.

### E8 · Book import & blast (un-stubbed — was "Campaigns")
See `docs/demo-block2.md` §E8. Reachable from Customers → Not on plan, and
More → **Offer campaign**.

### S3 · Messaging
- New **`Suppression`** table (`channel`, `value`, `source`) — one
  cross-channel opt-out store. `sendSms` checks it for every MARKETING send
  (on top of `Customer.smsOptOut`); `sms-inbound` writes to it on STOP and
  clears it on START.
- `OutboundSms.consentBasis` records `plan-member-transactional` /
  `engineer-initiated` / `marketing` per row.
- (Follow-up: the full `MessageTemplate` registry table — template strings
  are still inline in code. Noted in the plan doc.)

## Block 4 — retention + growth

### E9 · Reminders
- Member plans: 30/14/3-day reminders still **auto-send** (`queueServiceReminders`,
  transactional).
- Non-member due rows on the Jobs screen now show a **"Book + offer"** button
  → `POST /api/jobs/remind` sends one engineer-voiced message that books the
  service *and* offers the plan (`/p/{slug}?src=reminder`). Never auto-sent;
  `reminder_sent` fires with `kind: non_member_offer`.

### E10 · Referrals
- **`/api/referral`** — the engineer's invite link (`/r/{slug}`), the flat
  **£50** bounty terms, and each invitee's progress bar toward 5 live plans.
- **`mobile/app/referral.tsx`** — green money card, per-invitee stage
  (`n/5 PLANS` → `£50 PAID ✓`), **Invite on WhatsApp** (opens `whatsapp://send`
  with the link; falls back to the share sheet).
- **`/r/{slug}`** — web landing page, deep-links `tradesura://sign-up?ref={slug}`
  + App Store / Play links. `referral_link_opened` logs.
- **`/api/referral/card`** — `next/og` share image, name-stamped with the
  engineer's business + locked-in annual income (no new dependency).
- Sign-up wizard reads `?ref=` → pre-sets `heardVia: engineer` + referral
  code. `/api/auth/request` links `Engineer.referrerId` by slug (self-referral
  ignored); `referral_signup` fires for both sides.
- **Bounty payout:** `activatePlan` → `checkReferralBounty` — when a referred
  engineer hits 5 ACTIVE plans, a platform-funded Stripe **transfer** of £50
  goes to the referrer's connected account (`payReferralBounty`), idempotent
  via `Engineer.referralBountyPaidAt`, `referral_activated` logged, referrer
  texted.

### S2 · Dunning
- `invoice.payment_failed` → `Plan.paymentFailedAt` set, customer gets one
  plain SMS with the portal link, engineer gets a heads-up text. `payment_failed`
  logged. (Stripe **Smart Retries** is a dashboard setting — enable 3 retries
  / 2 weeks.)
- `invoice.paid` after a failure → `paymentFailedAt` cleared, `payment_recovered`
  logged.
- `customer.subscription.paused` (retries exhausted) → plan `PAUSED`,
  `plan_paused` with `reason: dunning_exhausted`.

## Block 5 — finish + harden

### E12 · Settings
- More hub gains a nav card: **Refer an engineer · £50**, **Offer campaign**,
  Trades. Plus a support card: **How to sell more plans**, **WhatsApp support**,
  **Terms & privacy**. Stripe status card (Block 1) shows ACTIVE / payouts
  pending / restricted.

### C4 · Manage & cancel
- The cancel confirm step now shows **reason chips** (Moving house / Cost /
  Not using it / Other, optional). The reason is posted to
  `/api/portal/{token}/cancel`, stored on the `plan_cancelled` event
  (`reasonChip`), and the engineer is texted the cancellation + reason.

### C3 · Welcome polish
- `activatePlan` now sends a proper **welcome SMS** to the customer (plan
  name, price, "we'll message you when your service is due", manage link) in
  addition to the plan-document email and the engineer's dopamine ping.

## Not done (needs a human)

- **Block 6 dress rehearsal** — Matt live end-to-end on his own boiler with
  real money; Stripe live-mode switch.
- Solicitor sign-off on clause + message wording (8 Sept per the spec).
- Real Twilio / email keys; on-device testing on a cracked Android.
- `MessageTemplate` registry table (S3 follow-up).
- Per-tier cached Stripe Price id (C2 now creates a Price per checkout — works,
  but clutters the Stripe dashboard).

(The interactive-prototype gaps — embedded Payment Element, price stepper,
Send-Offer WhatsApp, payouts breakdown, dashboard Today list, Reminders
rename — are **closed**; see `docs/demo-gap-close.md`.)
