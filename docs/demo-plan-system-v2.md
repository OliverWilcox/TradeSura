# Build Guide v2 Part 7 + 8 — the plan system, rebuilt

Source: `app/assets/TradeSura_Build_Guide_v2.html`, Parts 7 (My plans: the
plan system) and 8 (the plan wizard), plus the "View customers" deep link
from 7.4 and the required-CORE proof for 7.1. Root + mobile typecheck / lint
green; 123/125 tests (the 2 failures are the pre-existing `gas-safe.test.ts`
integration cases that need a live DB); `expo export --platform ios` bundles
clean. 2026-09-16.

## The model change

`PlanTier.archived: Boolean` → `PlanTier.status: DRAFT | LIVE | STOPPED`
(migration `0013_plan_tier_status`). A plan is a listing now, not a fixed
"tier": nothing is offerable until an explicit "Make this plan live", stopping
is reversible and never touches existing customers, and a draft that's never
had a customer can be deleted — one that has can only be stopped (Part 7.2 LAW).
The 3-tier cap is gone; an engineer can run as many plans as they want.

Every place that used to filter `archived: false` (the public page, the
signup tier picker, the offer/dashboard/blast counts, `/api/me`'s `hasPlan`)
now filters `status: "LIVE"` — a draft or a stopped plan never reaches a
customer.

## API

- `GET/POST /api/tiers` — GET lists every plan, any status, for the hub;
  POST always creates a **DRAFT** (`publishNow: true` skips straight to LIVE
  — Step 4 on a brand-new plan uses this in one call).
- `GET/PUT/DELETE /api/tiers/[tierId]` — PUT is content-only, never touches
  status; DELETE only succeeds on a DRAFT with zero plans ever (409
  otherwise, with the Part 7.2 wording).
- `POST /api/tiers/[tierId]/publish` — DRAFT → LIVE. Idempotent if already
  LIVE; 409 if STOPPED ("use Start offering again instead").
- `POST /api/tiers/[tierId]/status` `{action: "stop"|"start"}` — the one
  reversible toggle (Part 7.2 LAW).
- `GET /api/tiers/templates` — the option library alone, for the wizard
  before a plan has an id.
- `lib/clauses.ts`'s `withRequiredClauses()` — the single source of truth
  for "required (CORE) options are pre-ticked and unremovable" (Part 7.1
  LAW), unioned in server-side on every create/edit regardless of what the
  client sends. Proven in `tests/clause-library.test.ts`.
- `/api/customers` now returns each customer's `tierId`, and the Customers
  screen accepts a `tierId`/`planName` filter — the hub's "View customers"
  button (Part 7.4: "a deep link with the filter set, no new screen").

## Mobile

- **`(home)/plans.tsx`** — the hub. LAW: zero plans of any status silently
  redirects to the wizard (no empty hub screen exists). Otherwise: sub-line,
  "Create a new plan" at the top, then cards — title, £X/month in
  money-green, the keep-line, benefit lines with white ticks, a status chip
  (Live·N / Stopped·N still on this plan / Draft), and two outlined buttons:
  Edit plan · View customers. All five doors from Part 1 (setup, dashboard,
  Account, the offer gate, and now the plan-picker sheet) point at this one
  room — the zero-plan redirect means none of them need their own check.
- **`(home)/plan-wizard.tsx`** (new) — "One builder, every door," in two
  modes:
  - **Create**: four steps in sequence (What's included → Price → Name →
    Check your plan), nothing committed until Step 4's "Make this plan
    live" or an early exit offers "keep as draft". Step 1's required options
    are shown locked and unticking is a no-op; Step 2 is a £1 stepper
    (£8–£25) with a live keep-line; Step 3 blocklists the name live and
    offers suggestion chips; Step 4 renders the exact customer-facing card
    via the new shared `components/plan-card.tsx`.
  - **Single-step edit**: `(home)/tier/[tierId].tsx` is now the "Edit plan"
    menu (status chip, three rows — What's included / Price / Name — Stop/
    Start offering, and Delete for an untouched draft); each row opens the
    wizard at just that step with its own "Save changes".
- Quick starts (Boiler Care / + Controls / Landlord Care) are still there,
  behind a `SHOW_QUICK_STARTS` constant in `plans.tsx` (Part 19 CONFIG #2 —
  the switch Matt asked for).

## Known gaps in this slice

- The "Back to setup" bar when the wizard opens from the Getting Started hub
  (Part 5) isn't built — it lands in the same wizard, just without that chrome.
- `isRecommended` ("most chosen") is untouched but no longer editable from
  the wizard — v2's spec text doesn't mention it, so it's dormant, not removed.
- The Step 3 suggestion chips are a simple keyword heuristic, not a Step-1-
  aware algorithm — the name still passes the live blocklist regardless.

## Walk it

1. Sign in with zero plans → any of the five doors lands straight in the
   wizard, no hub flash.
2. Build a plan through all 4 steps → "Make this plan live" → land on the
   hub with the card present. Kill the app, reopen: the plan is still there.
3. Edit that plan's price — the "N customers keep what they signed up for"
   line only shows once a real customer has joined.
4. Stop it — the card flips to "Stopped · N still on this plan"; the public
   page and the offer flow no longer show it. Start it again — instant.
5. "Create a new plan" → exit after typing a name but before Step 4 → "keep
   as draft" → the hub shows a Draft card → delete it (only works because it
   never had a customer).
6. From a plan's card, tap "View customers" → the Customers tab opens
   filtered to that plan with a clear-filter banner.
