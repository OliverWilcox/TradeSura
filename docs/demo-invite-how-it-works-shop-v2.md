# Build Guide v2 Part 14 — Invite an engineer · How it works · Membership Shop

Source: `app/assets/TradeSura_Build_Guide_v2.html`, Part 14 and Part 6.5's
quick-actions row. Root + mobile typecheck / lint green; 137/139 tests (2
pre-existing `gas-safe.test.ts` failures need a live DB); `expo export
--platform ios` bundles clean. 2026-09-16.

## Invite an engineer (`referral.tsx`), rewired for the new ladder

Part 14's RULED close (first plan live, not 5) already landed last slice;
this pass fixes what that left broken:

- **The stage model.** `referralStage()` only had 3 states and no notion of
  "verified" — Part 14 wants "Signed up → Verified → Plan live → £50 paid."
  It's now a 4-stage function keyed on Gas Safe verification, active plans,
  and bounty-paid, with its own tests. The screen shows the stage label and
  a 4-step progress bar instead of the old, now-nonsensical "N/1 plans"
  fraction.
- **"Share my income card" is now actually soft-gated** — it wasn't gated at
  all before. `/api/referral` returns `hasPayout` (a real
  `payment_confirmed` event exists), and the card blurs with "Unlocks with
  your first payout" until then, per Part 14 verbatim.
- **"QR + copy link"** — there was a QR but no copy affordance. Added the
  link as `selectable` text (long-press to copy) rather than a new
  `expo-clipboard` dependency, which — like `expo-sharing` before it (see
  this file's own code comment) — needs a native rebuild to link into the
  current dev-client binary.
- Copy fixed throughout: "when they get 5 plans live" → "when their first
  plan goes live."

## How it works (new, `how-it-works.tsx`)

Never gated. The four steps, the maths (a worked £12/mo example, both per-
customer and at 50 customers), and the doorstep script — the exact same
`SCRIPT` text `offer/index.tsx` uses, duplicated by hand per this codebase's
established convention for small non-compliance display strings. This is
where Account's cut "How to sell more plans" row content now lives (Part
13: "its content lives in How it works — one home"). Wired from: the
dashboard's new quick-actions grid, and the Getting Started hub (Part 5:
"How TradeSura works → the How it works page").

## Membership Shop (new, `membership-shop.tsx`)

The honest one-card room Part 14 asks for: "the October face is the
coming-soon card." Shows the exact copy for each real state — locked,
verified-but-pack-not-requested, and pack-on-its-way — plus the credential-
lock explanation (Part 14 LAW: seal-bearing stock can't ship to an
unverified account and re-locks on pause/ban).

## Dashboard quick actions — now the 2×2 grid

`(home)/index.tsx`: My plans · Invite an engineer · How it works ·
Membership Shop, matching Part 6.5's row. My plans and Membership Shop
soft-gate through `GateSheet` with the guide's exact reason strings; Invite
an engineer and How it works are never gated. "Show a customer" (the
hand-the-phone flow) isn't in the guide's canonical four, but it's a
working, already-built feature — kept as an extra full-width button below
the grid rather than removed to hit an exact count.

## Walk it

1. Dashboard → the 2×2 grid; tap Membership Shop before verification — the
   exact gate reason, routes to Account.
2. Invite an engineer who never verifies — their row sits at "SIGNED UP"
   forever, no plans fraction.
3. Refer someone, they verify but haven't built a plan — "VERIFIED".
4. Their first plan goes live → "£50 PAID" appears (the payout trigger was
   already correct from the last slice; this just displays it honestly).
5. Before your own first payout, the income card is blurred and unshareable;
   after it, it's real and shareable.
6. From Getting Started, tap "How TradeSura works" → the four steps, the
   maths, the script — reachable before setup is even finished.
