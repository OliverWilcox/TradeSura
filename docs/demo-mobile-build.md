# TradeSura — engineer app (Expo) demo

Companion to `demo-full-build.md`: same P0 loop, walked from the Expo app
instead of the browser. The customer-facing steps (§4 phone signup onward)
are unchanged — that surface is still plain web.

**What's verified in this pass, and what isn't:** every screen below has
been typechecked, linted, and bundled for iOS and Android (`npx expo export`)
against the real API route handlers. None of it has been walked live against
a running Postgres + Stripe test mode + a real device in this environment
— there was no local database available to run one. Treat the steps below
as the script to run, not as a report that they were run.

## 0. Prerequisites

Same as `demo-full-build.md` §0 (Stripe test-mode keys + webhook, tunnel or
Stripe CLI, Gas Safe CSV) — the backend is the same Next.js app. Additionally:

- `cd mobile && cp .env.example .env` and set `EXPO_PUBLIC_API_URL` to the
  Next.js server's URL (the same `APP_URL` from the root `.env` — use the
  cloudflared tunnel URL if testing on a physical device or if the Stripe
  onboarding round-trip needs to reach a real host; `http://localhost:3000`
  is enough for the iOS Simulator).
- A dev build or `npx expo start` + iOS Simulator/Android emulator. Note:
  the custom URL scheme (`tradesura://`) that the magic-link and Stripe
  onboarding redirects target needs a dev client or standalone build to
  resolve reliably — Expo Go's handling of arbitrary custom schemes is limited.

## 1. Empty DB → running app

```bash
npm install && npx prisma dev && npx prisma migrate deploy
npm run db:seed && npm run import:gas-safe
npm run dev                          # Next.js — backend + customer web
npm run test && npm run typecheck && npm run lint

cd mobile
npm install
npx expo start                       # then open in a dev build / simulator
```

## 2. Sign in + onboarding (Screen 01)

1. Sign-in screen → enter any email → **Send magic link**. In dev, tap
   "DEV: open sign-in link" to open the emailed link directly (it deep-links
   back into the app via `tradesura://auth-callback` rather than a web page).
2. Onboarding: Gas Safe no. `584 123` → **Check the register** → autofills
   "D. Smith · Smith Heating Ltd" → trading name → **Save and continue**.
3. **Set up payments** → opens Stripe Connect Express onboarding in an in-app
   browser session → complete the test-mode form → returns to the app; `/api/me`
   syncs the account status and the card shows "✓ Payments ready".

## 3. Branded plan (Screen 03)

Plans tab → **Start with the 3 recommended tiers**. Try adding "We fix any
breakdown free" as a custom line → the app calls the same
`/api/tiers/check-wording` endpoint the server-side save re-checks —
**BLOCKED** with the insurance explanation + nearest approved clause either
way.

## 4. Doorstep → real phone (Screen 04, then the unchanged web Screen 09)

1. Home → **Offer a plan** → new customer (fictional `07700 900xxx`) →
   **Text the link now**.
2. **Show QR on my screen instead** → scan with a real phone.
3. Everything from here is identical to `demo-full-build.md` §4 steps 3–5 —
   the customer's signup page is still plain web, untouched by this build.
4. Watch the engineer's phone: LINK SENT → OPENED → CHOOSING TIER → BANK
   DETAILS → **ACTIVE**, full-screen celebration, "Back to the dashboard".
   Bacs settles on a delay — with the delayed test account (`10-88-00 /
   90012345`) the plan flips to ACTIVE ~3 min after checkout, when the first
   collection clears (`invoice.paid`).

## 5. Customer book + import (Screen 05)

Customers tab → **Import CSV** (pick a `.csv` via the native file picker) or
**Import from contacts** (native contacts permission → multi-select list →
**Import N contacts**). Both call the same `/api/customers/import*` routes
the web version used.

## 6. Jobs + More hub (Screen 07 lite, More hub)

- Jobs tab: month calendar with job-dot days, overdue/next/past lists.
- More tab: Gas Safe badge or "finish verification" link, trading name/logo
  edit, Stripe payments status, this month's collections summary, dev SMS-queue
  flush, sign out.

## 7. Messages, Trades, Payouts (restored 2026-08-03)

These three were briefly stubbed as "coming soon" (P1 per the original scope
fence), then explicitly restored — see CLAUDE.md's 2026-08-03 note.

- More → **Messages & tickets**: customer problem reports, auto-triaged
  (emergency / no-heat / reschedule / question). Report "I can smell gas" on
  a customer portal (still web, unchanged) and confirm the ⚠ emergency banner
  and `EMERGENCY` tag actually show up here — this is the one path where a
  gap would be a safety issue, not just a missing nicety.
- More → **Trades & TradePacks**: register interest on a non-live pack →
  "INTEREST REGISTERED" pill persists on reload.
- More → **Payouts & collections**: full breakdown + failed-collection list
  → **Tax-year export (CSV)** opens the native share sheet with the CSV text
  (no file-system dependency added — see `mobile/lib/api.ts`'s `apiText`).

## 8. Housekeeping

- `npx expo lint` / `npx tsc --noEmit` inside `mobile/` before considering a
  mobile change done, same as `npm run lint`/`typecheck` at the root.
- `npx expo export --platform ios` (and `--platform android`) is the fastest
  way to catch a Metro/Babel/NativeWind wiring mistake without a simulator.
