# Design-system re-skin — to Build Spec v1 §1 / interactive prototype

The app had been built on the older `docs/design-spec.html` tokens (Flue Iron
/ Burner Blue / Barlow). Build Spec v1 §1 and the interactive prototype use a
different system; this pass applies it. `[DECISION 2026-08-28]` recorded in
`CLAUDE.md`.

Verified: root + mobile typecheck / lint / build / iOS+Android export;
107/109 tests.

## Tokens

`app/globals.css` `@theme` and `mobile/tailwind.config.js` remapped (semantic
keys kept so screens didn't churn):

| key | was | now |
|---|---|---|
| `flame` (primary) | `#0E7FD0` | **`#1966CC`** TS Blue |
| `flame-deep` | `#0A62A3` | `#0F4C9E` |
| `copper` / `ok` (money) | `#C2622E` / `#1E9E5A` | **`#0E9F5B`** money-green |
| `iron` (chrome) | `#232A33` dark | `#FFFFFF` light |
| `panel` / `bg` | `#F7F9FB` / `#EEF1F4` | `#F5F8FB` / `#E9EEF4` |
| `ink` | `#1B222B` | `#14202E` |
| `muted` | `#5E6975` | `#5B6B7C` |
| `line` | `#D9DEE4` | `#E1E8F0` |
| `warn` / `danger` | `#DD9A14` / `#D64545` | `#B7791F` / `#C0392B` |
| `night*` (auth) | dark | light (same as the rest) |

## Font

- **System font**, no webfonts (Build Spec §1). `@expo-google-fonts/*` and
  `next/font` Barlow/IBM Plex loading removed from both `_layout` files.
- The `font-{sans,disp}-{bold,semibold,medium}` family classes were converted
  to the `font-{bold,semibold,medium}` weight utilities across the mobile app.
- `font-mono` keeps a platform monospace fallback + `font-variant-numeric:
  tabular-nums` (web) so money columns stay aligned.

## Structure

- **Bottom nav → Home / Customers / [ + ] / Reminders / Payouts** (matches the
  prototype). `payouts.tsx` moved into `(tabs)/`. Plans + More are hidden tab
  routes (`href: null`), reached from the Home avatar (→ More) and the More
  hub. The `+` FAB is now blue.
- **Dashboard** rebuilt to the prototype: white **money card** ("Your plan
  income · £N /month · N plans live · Next payout"), amber **missed-money**
  card, 3-line **Today** list (services / payments retrying / referral
  progress), then **Show a customer** / **Invite an engineer** ghost buttons.
  The dark "iron" income hero is gone.
- **Headers**: light (`bg-paper` + bottom border). Home shows the `TradeSura✓`
  wordmark; every other screen shows a plain bold title (`<AppHeader title=…>`).
- The doorstep "plan active" celebration and the contacts-import screen were
  flipped from dark to light (the latter was also missing its `SafeAreaView`,
  which is the "stuck at the top" bug).

## Not pixel-identical

The prototype is a web mockup; a native RN app renders the system font,
tab bar and shadows differently, so this matches the **design language**, not
the pixels. Run it on a simulator/device to check per-screen spacing — a few
screens (sign-up wizard, messages, trades) had dark themes flipped by the
token remap and may want a spacing tweak that only shows at runtime.
