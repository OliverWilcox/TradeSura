# Demo — Build Guide v2 Part 2: brand kit & design rules

Source: `app/assets/TradeSura_Build_Guide_v2.html`, Part 2 (2.1 colours,
2.2 logo system, 2.3 the broken seal, 2.4 picture-vs-build differences).

## What changed

**Assets (supplied, never redrawn)**
- `mobile/assets/brand/lockup.png` and `public/brand/lockup.png` — the ring +
  wordmark lockup, trimmed from the guide's asset.
- `mobile/assets/brand/ring.png` and `public/brand/ring.png` — the ring on
  transparent, cut from the lockup (the only transparent ring supplied).
- `mobile/assets/icon.png`, `favicon.png`, `splash-icon.png`, the Android
  adaptive set, `app/favicon.ico`, `public/brand/icon-{192,512}.png` and
  `public/manifest.json` — all now the ring. The retired "Λ" chevron icon and
  the "TRADESURA ✓" text mark are gone.
- The Verified Member seal is **not** in the repo — it is concept-only
  (mirrored text) and nothing may ship wearing it.

**Components (`mobile/components/`)**
- `icon.tsx` — the one icon family: SF Symbols on iOS, Material Symbols on
  Android via `expo-symbols` (now a direct dependency). No emoji anywhere.
- `ui.tsx` — `AppHeader` with no title renders the lockup masthead + avatar
  (every tab screen); with a title renders the back chevron + left-aligned
  title (every pushed page). New `Lockup`, `Avatar` (first + last initials,
  green credential tick once Gas Safe verified), `Tick` (white; `credential`
  = the only green one) and `Chevron`. The `green` button variant is removed.

**Green-is-money audit** — every non-£ use of green is gone: status chips
are blue (`info`), list ticks are white, the WhatsApp share buttons are the
white primary, success text is white, the referral progress bar is blue.
Remaining green: £ figures, the payout £ chip, the Gas Safe credential tick.

**Copy** — sentence case ("Heat pump", "Air con", "Care plan platform");
"doorstep" removed from app copy; "More" is now "Account"; Part 18 strip
strings on the Account credential line; bare "guarantee" and "emergency
response" added to the wording blocklist (`lib/compliance/blocklist.ts`).

## Run it

```
cd mobile && npm run typecheck && npm run lint
cd .. && npm run lint && npm test
npx expo start   # in mobile/
```

## Walk (on a device)

1. Cold launch — navy splash with the lockup; the home-screen icon is the ring.
2. Welcome, sign-in and sign-up headers wear the lockup, not the text mark.
3. Sign in. Home / Customers / Reminders / Payouts each show the lockup
   top-left and the avatar top-right; the avatar reads first + last initials
   ("MW", not the email letter) with a green tick only when Gas Safe verified.
4. Tap the avatar — "Account" opens with a back chevron and a left-aligned
   title. Credential line: green tick + "Gas Safe verified — account active."
5. Tab bar icons are native symbols; only the active tab is blue.
6. Open any plan: benefit ticks are white; "CORE" chips are blue.
7. Offer a plan → the WhatsApp button is white, not green.
8. Plan builder: type "satisfaction guarantee" or "emergency response" into a
   custom line — both are blocked with the insurance explanation.

## Not in this slice (belongs to later parts)

- Part 6.3: the ring as the dashboard payout indicator (dormant at 35%,
  filling through the payout week). The ring asset is in place for it.
- Part 2.4 bell badge: data-driven Reminders count on the tab — needs the
  due-items feed wired into the tab bar (Part 11).
- The FAB label "Add customer" and the sheet behind it (Part 9).
- A 1024px master of the ring icon from the designer — the current one is the
  supplied 256px asset upscaled.
