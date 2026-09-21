# Build Guide v2 Part 9.2 + Part 15.1 — offering (and pinning) a specific plan

Source: `app/assets/TradeSura_Build_Guide_v2.html`, Part 9.2 ("Pick the
customer, pick the plan, see the exact text, send") and Part 15.1 (the
public page's trust line and the personal-link greeting). Root + mobile
typecheck / lint green; 137/139 tests (2 pre-existing `gas-safe.test.ts`
failures need a live DB); `expo export --platform ios` bundles clean.
2026-09-16.

## The gap this closes

Rebuilding the Add-customer sheet last slice, I pointed route 2 at the
existing `/offer` screen without checking it against Part 9.2's own text
closely enough — it let an engineer pick a **customer** but never a
**plan**. `POST /api/offer` created a plan-less `Plan` row and left tier
choice entirely to the customer at checkout; the SMS was a generic "my care
plan" line, not the templated, plan-specific text Part 18 specifies. Found
while wiring Part 15.1's personal-link greeting, which needs a pinned plan
to point at and had nothing to pin.

## What changed

- **`/api/offer`** — `tierId` is now required, validated against the
  engineer's own LIVE plans. The plan row is created with that `tierId` as
  a pin (not a commitment — `/choose` still freezes the real `agreedTier`
  snapshot whatever the customer actually picks). The SMS body is now the
  **exact Part 18 template**: "Hi {first name} — {engineer first name} from
  {trading name}. My {plan name} plan is £{X} a month: {benefits, lower
  case, comma-run}. Sign up here — takes a minute: {link}" — sent
  server-side and returned to the client so the WhatsApp path shares the
  identical text rather than a second, drifted copy.
- **`offer/index.tsx`** — a plan-picker chip row (skipped when there's only
  one live plan), the message preview rebuilt to match the template
  exactly, and `canSend` now requires a plan too.
- **The personal signup link now pins that plan.** `SignupTiers` takes an
  optional `pinnedTierId`/`pinnedGreeting`; the token page reads the offer's
  `plan.tierId`, reorders the cards so it's first, and shows "{Engineer
  first name} suggested {plan name}" above them — Part 15.1 verbatim. The
  generic `/p/{slug}` address (QR, blast) is untouched: "nothing
  pre-filled" there is correct as built.

## Also fixed: the trust line and header (Part 15.1)

- **Header now wears the ring**, not just the trading name — `CustomerShell`
  (used by every customer-facing page: the public page, personal signup
  links, the portal) gets the supplied ring asset from `public/brand/`.
- **The trust line is the exact string** — "Gas Safe verified · Backed by
  TradeSura" — replacing an ad-hoc "Your engineer: {name} [badge]" line.
  Judgment call: it only renders when the engineer is **actually** verified;
  otherwise it reads "Backed by TradeSura" alone. Asserting a false
  compliance claim to a customer would matter more than matching the string
  in that edge case.
- Route 1 (hand-the-phone) reuses this same page via WebView, so its "trust
  block" is fixed by the same change — no separate work needed there.

## Walk it

1. Build two plans. Open the offer sheet, route 2 — a plan-picker chip row
   appears; the message preview updates live as you switch plans.
2. Send it — the SMS a real phone receives matches the preview character
   for character, mentions the specific plan and its actual benefits.
3. Open the personal link — that plan is pinned first, with "{Your first
   name} suggested {Plan name}" above the cards.
4. Open the generic `/p/{slug}` page (or scan a QR) — plain, no pin, no
   greeting, every live plan shown — unchanged.
5. Compare an unverified engineer's public page against a verified one — the
   trust line differs; neither ever claims verification that hasn't happened.
