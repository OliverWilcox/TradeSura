# Block 1 demo — the money loop

Build Spec v1 Block 1: an engineer signs up (with attribution), gets paid
(Stripe), publishes a plan, and a cold customer joins it from a public link
with a Bacs Direct Debit carrying TradeSura's 20% fee.

**Verified in this pass:** typecheck + lint + `next build` (root), typecheck +
lint + `expo export` (mobile), 101 unit tests (the 2 `gas-safe` failures need a
live DB — pre-existing). **Not** walked live against Postgres + Stripe test
mode + a device — no local DB here. Treat as the script to run.

## 0. Prerequisites

`docs/demo-full-build.md` §0 (Stripe test-mode integration + webhook, tunnel or
Stripe CLI, Gas Safe CSV) and §1 (empty DB → running app). Then apply the new
migrations: `npx prisma migrate deploy` (adds `0005_stripe`, `0006_block1`).

## 1. E1 — signup with attribution

1. Mobile: sign-up wizard step 1 now has **"How did you hear about us?"**
   (Letter / Another engineer / Online / Other) — required to continue.
   Picking **Another engineer** reveals an optional **referral code** field.
2. Finish the wizard as before (OTP, Gas Safe `584 123`, business details).
3. Check the `engineer_signed_up` event `meta` carries `heardVia` (+
   `referralCode` if given), and `Engineer.attribution` JSON is populated.

## 2. E2 — onboarding wizard (4 steps)

`/onboarding` now shows four sequenced steps, each resuming from wherever you
left off (state derived from `/api/me`, nothing stored):

1. **Get paid** — Stripe Express onboarding (the only hard gate).
2. **Your first plan** → jumps to the Plans tab.
3. **Your customers** → jumps to contact import.
4. **Your founding pack** — enter a postal address → `POST /api/onboarding/pack`
   sets `packRequestedAt` and fires `founding_pack_requested`.

Leave and come back (More → finish setup): the wizard shows only the steps
still outstanding.

## 3. E6 — plan builder

- Plans tab → **Start with the recommended tiers**: presets are now
  **Boiler Care £12 / Boiler + Controls £15 / Landlord Care £15** (assembled
  from locked clauses; Landlord Care bundles CP12).
- Tier editor: the earnings card reads **"£X per customer per month · 50
  customers = £Y/year · you keep 80%, ~32p processing comes out of your
  share"**. Price outside £8–£25 is rejected client- and server-side.
- Saving a tier fires `plan_published`.

## 4. C1 — public plan page  ·  `/p/{slug}`

1. Open `tradesura.com/p/<engineer-slug>` (no token) — the white-label page:
   engineer header, **live** Gas Safe badge (re-queried per request, not the
   value cached at signup), tier cards with the middle one marked **MOST
   CHOSEN**, "How it works", 5 fixed FAQs, the not-insurance + emergency-line
   footer. A `page_visit` event logs with `source` (`?src=` / `?demo=1` /
   `direct`).
2. Pick a tier, enter name + mobile + email, **Join …** — the button restates
   the full monthly price. `POST /api/p/{slug}/start` creates the Customer
   (`source: "web"`) + Plan, fires `tier_selected` + `checkout_started`,
   queues the evening + day-3 abandon nudges, and returns the Stripe
   checkout URL.
3. Complete Stripe Checkout with the delayed Bacs test account
   (`10-88-00 / 90012345`).

## 5. C2 / C3 — embedded checkout + confirmation

- **C2 (updated):** the tier picker now reveals the **embedded Stripe Payment
  Element** inline (name / sort code / account number + mandate) — no redirect
  off the white-label page. See `docs/demo-gap-close.md` §1.
- The confirmed page (`…/signup/{token}/confirmed`) shows an **honest Bacs
  message** once the mandate exists: "You're in — Direct Debit is being set
  up. This takes 2–3 working days… you can close this page." It polls every
  15 s (not 2 s) in that state.
- ~3 min later `invoice.paid` fires → `activatePlan`:
  - plan → ACTIVE, `mandate_active` + `plan_live` events, cooling-off set,
  - customer gets the clause-assembled plan-document email,
  - **the engineer gets a text**: "🎉 {name} just joined {tier} — £{n}/yr
    added. {count} plans live, £{mrr}/mo." (dev: printed to the server
    console via the SMS dev driver).
  - queued abandon nudges cancelled.

## 6. Regression

- Doorstep flow (`/api/offer` → `/p/{slug}/signup/{token}`) unchanged and
  still works — it shares the same Stripe checkout + activation path.
- `npm run test && npm run typecheck && npm run lint` (root) and the same in
  `mobile/`.
