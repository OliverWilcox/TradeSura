# Block 2 demo — visibility + claim

Build Spec v1 Block 2: the engineer can see money reconcile to Stripe, work
the book by opportunity, and letter recipients can claim an account.

Verified: root + mobile typecheck / lint / build / export; 101/103 tests
(2 `gas-safe` need a DB). Migrations `0007_claim_codes`. Not walked live.

## E3 — dashboard

- Money card now shows a **Next payout** line: real Stripe figure once payouts
  are enabled, otherwise 80% of active-plan collections with a date when known.
- The "leaving money on the van" card only shows at **≥5** no-plan customers.

## E7 — customers

- `/api/customers` returns segment counts and per-row opportunity data.
- Tabs: **All / On plan / Not on plan (default) / ⚠ Attention**. Not-on-plan
  sorts never-offered → stale offer (>7d, unopened) → newest.
- Non-plan rows have an inline **Offer / Re-offer** button; tapping a name
  opens the detail screen.
- **Customer detail** (`/customer/[id]`): header with source, plan block
  (DD status, since-date, last service), plain-English **timeline** (joined /
  offer sent / serviced / collected / cancelled), and actions:
  - **Record a service** → `POST /api/customers/[id]/service` stamps the
    appliance (creating one if needed), fires `service_recorded`, reschedules
    next year's reminder.
  - **Pause plan** (active only) → `POST …/pause` → Stripe
    `pause_collection` + status PAUSED + `plan_paused`.
  - **Remove customer** (no active plan) → `DELETE …` cascades.

## E8 — book import & blast (un-stubbed)

- Customers → Not on plan → **Text N no-plan customers an offer** → the blast
  composer (`/customers/blast`): audience count, the fixed message preview,
  the **own-customers checkbox** (recorded consent basis), and the last
  campaign's results.
- **Send** → `POST /api/customers/blast` queues a MARKETING SMS to every
  no-plan, non-opted-out customer, staggered over ~10 min, pointing at
  `/p/{slug}?src=blast`. Fires `blast_sent` with the count.
- 72h later the composer shows **sent · page visits · plans live** (computed
  from `page_visit` + `plan_live` events since the blast).

## E11 — payouts

- `/api/payouts` layers in **real Stripe data** when the account has payouts
  enabled: next payout (amount + arrival date), available vs. clearing
  balance, and a **payout history** list. Falls back to plan maths otherwise,
  and shows an amber note if Stripe is unreachable.
- A **red banner** appears when the Stripe account is restricted
  (`charges_enabled` false), pointing to More → Payments.

## C5 — claim page  ·  `/claim`

1. `tradesura.com/claim` — type the code (forgiving of case / spaces /
   dashes: `ts 48217` → `TS-48217`). QR deep-links (`/claim?code=`) resolve
   server-side.
2. Valid + personalised (seeded `TS-48217` = "Dave · Dave Smith Heating"):
   green welcome → **Claim my free account** deep-links
   `tradesura://sign-up?code=TS-48217` (+ App Store / Play links).
3. Valid + suppressed (seeded `TS-51999`): recognised, no personalisation.
4. Unknown code: no dead end — "check the letter, or just create your free
   account" → `tradesura://sign-up`.
5. In the app, the sign-up wizard reads `?code=`, calls `/api/claim/resolve`,
   pre-fills first name + trading name, hides "How did you hear", and carries
   `heardVia: letter` + `letterBatch` + `variantCell` in `attribution`.
   `/api/auth/request` re-resolves the code server-side (lossless) and marks
   the `ClaimCode` redeemed. Events: `claim_code_resolved` / `_failed`.

## S4 — telemetry

Added this block: `page_visit`, `checkout_started`, `tier_selected` (+channel),
`plan_published`, `plan_live`, `service_recorded`, `plan_paused`,
`customer_removed`, `blast_sent`, `claim_code_resolved` / `_failed`,
`founding_pack_requested`, `stripe_account_created` / `stripe_onboarded`.
