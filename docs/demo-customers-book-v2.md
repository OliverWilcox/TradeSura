# Build Guide v2 Part 10 — the Customers book, finished

Source: `app/assets/TradeSura_Build_Guide_v2.html`, Part 10. Root + mobile
typecheck / lint green; 136/138 tests (2 pre-existing `gas-safe.test.ts`
failures need a live DB); `expo export --platform ios` bundles clean.
2026-09-16.

## The book (`customers.tsx`)

- **Offer button only on never-offered rows** — it used to also show a
  "Re-offer" ghost button on anyone already offered. Gone: the one-nudge law
  (48h SMS machinery) already covers them, so a second button was a second
  invitation the guide explicitly rules out.
- **Exact status-line patterns** — "Never offered" · "Offered N days ago" ·
  "{Plan} — joined this week" · "{Plan} — since {month}" (needed
  `activatedAt` added to `/api/customers`'s row shape).
- **Bulk button** renamed to the doctrine phrase: "Text the offer to N
  customers" (was "Text N no-plan customers an offer").
- **"Add a customer by hand"** link → route 3 (`/add-customer`) — "Import
  can't be the only way in."
- **The PECR checkbox gap is closed.** `/api/customers/import-contacts`
  already required `confirmOwn`; the **CSV path never did** — confirmed by
  reading the route, not assumed. Fixed both the API (`confirmOwn` now
  required) and the UI (the same confirm checkbox, gating the CSV button).

## Customer detail (`customer/[id].tsx`, rebuilt)

- **"Their plan — as signed"** card: the frozen `agreedTier` snapshot from
  Part 7.2 (name, price, benefit lines with white ticks) — not the live
  tier, so an edited plan never silently rewrites what a customer sees here
  either. No pronoun is ever captured anywhere in the data model, so this
  always reads "Their", the guide's own stated fallback — never guessed.
- **Service card**: Last service / Next due, a red `OVERDUE` chip when late
  (computed server-side from `nextServiceDate`, the same function the
  reminder engine uses), and "Mark service done" (renamed from "Record a
  service") resets both.
- **Contact card**: mobile, email, address — split out from the header,
  which used to cram all three into one truncating subtitle line.
- **Fixed a real bug found while rebuilding this**: the old `active` lookup
  only matched `status === "ACTIVE"`, so a **paused** customer showed as "no
  plan" on their own detail page — inconsistent with the list screen, which
  already treated paused as on-plan. Fixed to match.

## The cancel LAW (Part 10, and the biggest change here)

> "There is no engineer-side cancel button. Cancellation lives only behind
> the customer's manage link — so every cancellation is provably
> customer-made. The engineer's tool is 'Text the manage link'."

The detail screen had a red **"Pause plan"** button that called
`POST /api/customers/[id]/pause`, which unilaterally paused the customer's
live Stripe collections (`pause_collection`) — engineer-initiated, no
customer action at all. That's exactly the category of button this LAW
rules out, so it's gone from the UI. In its place: **"Text the manage
link"** (new `POST /api/customers/[id]/text-manage-link`), which only ever
re-sends the customer their own portal link — it never touches the plan.

**Judgment call, flagging for Matt rather than deciding alone**: the
`/pause` API route itself is left in place, unused, rather than deleted —
in case it's wanted later as a support-team tool distinct from an
in-app engineer button. If it should be deleted outright, say so.

## Walk it

1. Offer a customer a plan, don't complete it — their row shows "Offered N
   days ago" with no button, ever again, until they respond.
2. A customer joins this week → "{Plan} — joined this week"; check back a
   month later → "{Plan} — since {month}".
3. Try a CSV import without ticking the checkbox — blocked, same message as
   the contacts-import path.
4. Open an on-plan customer → the signed plan card, service card with an
   OVERDUE chip if their service date has passed, contact card, and "Text
   the manage link" at the bottom. There is no button anywhere on this
   screen that changes their plan.
5. Pause a plan's collections directly in Stripe (or via the still-live but
   now-unreferenced API route) → the detail page correctly still shows them
   as on-plan.
