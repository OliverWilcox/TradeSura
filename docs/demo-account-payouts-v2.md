# Build Guide v2 Part 13 (Account) + Part 12's standing-strip banner

Source: `app/assets/TradeSura_Build_Guide_v2.html`, Part 13 (Account) and
Part 12's "amber slim banner... reads the standing strip's truth source."
Root + mobile typecheck / lint green; 136/138 tests (2 pre-existing
`gas-safe.test.ts` failures need a live DB); `expo export --platform ios`
bundles clean. 2026-09-16.

## `lib/verification-state.ts` grows two more exports

`gasSafeStatus()` and `paymentsStatus()` — Account needs the Gas Safe and
Payments facts as two **independent** lines (Part 13: "same words, same
state machine," shown separately), unlike the dashboard's single collapsed
priority-ladder line. Same wording, different shape; both new functions are
additive — `standingState`/`standingCopy` and their tests are untouched.
`/api/settings` and `/api/payouts` now both expose `standing` (the collapsed
ladder, for the banned/paused override) plus their own independent facts.

## Account (`more.tsx`, rebuilt)

- **Identity header** — avatar (with the credential tick), name, email.
- **Status card** — the two independent lines, or the single banned/paused
  banner when one of those outranks everything. The Payments line is
  tappable straight into Stripe Connect when it's not yet active.
- **"Your page"** row — `tradesura.com/p/{slug}`, replacing a small caption.
- **Trimmed to four rows + one exception**: My plans, Invite an engineer ·
  £50, WhatsApp support, Terms & privacy — each with a chevron, per Part 13.
  Cut: "This month, transparently" (Payouts owns the money), "Payouts &
  collections" (duplicates the tab), "How to sell more plans" (moves to How
  it works). **Kept**, against the default: "Messages & tickets" — Part 13
  says cut it unless it's load-bearing "in which case say what it does
  before it stays." It is: `messages.tsx` is the engineer's only visibility
  into the gas-emergency interlock firing. "Trades & TradePacks" is hidden,
  no comparable justification found.
- Sign out is now `ghost` (muted), not the red `dangerghost` it was.

## Fixed in passing: the slug bug Part 13 names outright

"Today's `/p/info/…` is the bug; the target is `tradesura.com/p/mattwood`."
`/api/settings` and `/api/onboarding` already derived the slug from the
trading name on any later rename — only the **initial signup** route
(`app/api/auth/request`) was still keying off the email's local part. Fixed
to use the trading name from the moment the account exists. (Kept the
existing hyphenated `slugify()` format rather than introducing a second,
inconsistent no-hyphen style just to match the guide's illustrative
"mattwood" — Matt's call if that distinction actually matters.)

## Payouts banner (Part 12)

The Stripe-needs-more-info state was rendering **red** ("genuinely broken"),
which Part 12 explicitly reserves for banned/paused. It's now amber and
tappable through to Account's payment setup; banned/paused still gets red.

## Known gaps

- Payouts' hero and transparency card haven't had their own full Part 12
  pass (ring-docked hero, reconciling-to-the-penny check) — only the banner
  LAW was fixed here.
- `paymentsStatus`'s "Set up payments →" (never started) and "Finish payment
  setup →" (submitted but not enabled) collapse to one amber state in the
  shared function; Account's tap always opens the same Stripe Connect flow
  either way, so this doesn't lose any functionality, just a label nuance.

## Walk it

1. Open Account — avatar, name, email up top; two status lines beneath.
2. Before Stripe is connected, tap the amber Payments line — it opens the
   real Connect flow, same as before.
3. Go to Payouts before finishing Stripe onboarding — the banner is amber,
   not red, and tapping it lands back on Account.
4. Confirm "Messages & tickets" is still there, and that Trades/Payouts/How-
   to-sell rows are gone from Account.
5. Sign up a brand-new test account with trading name "Acme Heating" — its
   public page is `tradesura.com/p/acme-heating`, not derived from the
   email.
