# Build Guide v2 Part 6 — Home dashboard, the standing strip, and the two-leg gate

Source: `app/assets/TradeSura_Build_Guide_v2.html`, Part 6 (Home dashboard),
Part 6.4/6.5's shared truth source and two-leg gate, and Part 14's RULED
referral-threshold close. Root + mobile typecheck / lint green; 131/133 tests
(2 pre-existing `gas-safe.test.ts` failures need a live DB); `expo export
--platform ios` bundles clean. 2026-09-16.

## New: the standing-strip truth source

`lib/verification-state.ts` — `standingState()` / `standingCopy()` — is the
one function Part 6.4 and Part 17.3 both call for: "one truth source read by
the strip, Payouts' banner, and the Account status card." Priority ladder,
worst first: **banned > paused > Stripe-needs-info > check-failed >
check-pending > active**, every string verbatim from Part 18. Proven in
`tests/verification-state.test.ts`.

`Engineer.pausedAt`/`pauseReason` and `bannedAt`/`banReason` are new,
nullable columns (migration `0014_standing_strip`) — no admin tool sets them
yet (ship-now-policy-later, same pattern as the Part 19 CONFIGs), but the
state machine is real and the dashboard renders all five non-active states
correctly once one is set directly.

**This slice wires the strip into the Home dashboard only.** Payouts' banner
and the Account status card (Parts 12/13) still need their own pass to read
the same source — noted as the next piece, not forgotten.

## Home dashboard (`(home)/index.tsx`, rewritten)

- **Structure LAW** — header → greeting → standing strip → money card →
  action cards → Today → quick actions, in that order, nothing else above
  the money card.
- **Greeting sub-line** is state-aware, exact Part 18 strings, switched on
  `me.hasPlan` (LIVE-only, from Part 7's work).
- **Money card LAW** — one hero number, nothing else on the card. Sub-line
  is now the exact pattern: `"N plans live · N offers out"` when active,
  `"Your first plan changes this"` when not. The ring (real asset, Part 2)
  sits beside the figure: 35% opacity and static until the first live plan,
  full colour once awake; the caption reads "Paid every / Friday" dormant or
  "Next payout / £X · date" awake. The full "fills through the payout week"
  animation isn't built — the ring's static awake/dormant states are, which
  is what the LAW actually gates on.
- **Offers-waiting card** (Part 6.6) — new: `/api/dashboard` finds the oldest
  PENDING offer older than 48 hours that hasn't already surfaced this card
  (tracked via an `offer_waiting_card_shown` event, so it really is once per
  offer, ever, not once per dashboard load).
- **Today feed** empty state is now the exact Part 18 string. The referral
  row's copy no longer shows a stale "N/5 plans" fraction (see below).
- **"My plans" quick action** is now genuinely soft-gated — greyed, tappable,
  opens the exact `GateSheet` reason string, routes to Getting Started. Every
  other door to the plan room (onboarding, Account, the offer gate) stays
  ungated, matching Part 6.5's table (gating lives on this specific door, not
  on setup's own step).

## The two-leg gate (Part 6.5 LAW)

`/offer` (the current stand-in for Part 9's not-yet-built Add-customer
sheet) now checks **plan AND badge**, not plan alone: a live plan with no
Gas Safe badge yet shows "You need your Gas Safe badge first · Check your
status →" instead of the send form. The tab-bar hero itself stays
plan-only-gated, per the guide's own table (the hero "wakes when: First plan
live"; the badge leg belongs to the actions inside, not the hero).

## Also fixed: the referral threshold (Part 14 RULED)

`lib/referral.ts`'s `REFERRAL_REQUIRED_PLANS` was still `5` — the old,
explicitly-superseded rule. It's now `1` ("the £50 pays when the invited
engineer's first plan goes live"), the notify string dropped its stale plan
count, and `/api/dashboard`'s referral card no longer shows a "N/5" fraction
that a threshold of 1 would have made nonsensical.

## Known gaps in this slice

- Payouts' banner and Account's status card don't read `standingCopy` yet —
  next up.
- The ring's payout-week fill is approximated (static awake/dormant), not
  animated.
- Membership Shop and "How it works" aren't real rooms yet (Part 14), so the
  dashboard's quick actions stay at their current three rather than the
  full 2×2 grid Part 6.5 describes.

## Walk it

1. Fresh account, no plan: dashboard shows the dormant ring, "£0 /month ·
   Your first plan changes this", the greeting's setup line, and "My plans"
   greyed — tap it, the gate sheet's exact reason, routes to setup.
2. Set the Gas Safe number to an unmatched one at signup (review #11's path)
   → the standing strip shows the amber "check in progress" line, tappable
   into Account.
3. Make a plan live, send an offer from `/offer` before the badge verifies →
   blocked with "You need your Gas Safe badge first".
4. Verify the badge, send an offer, don't complete it — 48+ hours later (or
   backdate the plan's `createdAt` in a sandbox) the dashboard shows the
   "hasn't set up their plan yet" card exactly once, ever.
5. Complete an offer → the ring wakes, the money card shows "1 plan live ·
   N offers out", and the strip reads "Gas Safe verified — account active."
