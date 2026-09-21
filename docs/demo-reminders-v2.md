# Build Guide v2 Part 11 — Reminders

Source: `app/assets/TradeSura_Build_Guide_v2.html`, Part 11 — "Best screen of
the original build — the picture folds in the two fixes." Root + mobile
typecheck / lint green; 136/138 tests (2 pre-existing `gas-safe.test.ts`
failures need a live DB); `expo export --platform ios` bundles clean.
2026-09-16.

## The two named fixes

1. **The AUTO·SMS chip is blue, not green** — already done in the Part 2
   brand-kit slice (`tone="info"`).
2. **The calendar is a compact week strip, not a full month grid** — the old
   `CalendarCard` rendered the whole current month; replaced with `WeekStrip`,
   this Mon–Sun only, a small dot under days with a job. "It earns more size
   only with content" — it doesn't grow with the job count, the rows below it
   do.

## Also fixed, from Part 11's own text

- **Rows are now tappable** → the customer's detail page, where "Mark
  service done" actually lives. They weren't before — only the "Book + offer"
  button was interactive.
- **Row subtext is stage-specific**, not generic: "N-day text goes out
  {weekday}." derived from the due date and the fixed 30/14/3 offsets, or
  "Reminder sent — they can reply to book." once all three have fired.
  (The guide's example uses "she" — no pronoun is ever captured anywhere in
  this codebase, so this stays neutral rather than guessing one, same
  reasoning as Part 10's customer-detail card.)
- **Footer line added**, verbatim to the spec's intent: "Tap a job to open
  their page — Mark service done lives there."

## Known gap: push notifications aren't wired up at all

Part 11 wants a tab count-badge (already built, `/api/jobs/badge`, from the
earlier Part 3 slice), a push permission pre-prompt after the first plan
goes live ("Get told when payouts land and services come due"), and an
app-icon badge mirroring overdue-only. **None of the actual push
infrastructure exists** — no `expo-notifications` dependency, no device
token registration, no send path. This isn't a UI gap I can close with a
copy or wiring change; it's new native infrastructure (a dependency that
needs a dev-client rebuild to test on a real device, Expo push tokens,
APNs/FCM credentials) — flagging it rather than half-building a permission
prompt that can't actually deliver anything yet.

## Walk it

1. Reminders shows this week only, compact, with a dot on days that have a
   job — not last month's dates taking up half the screen.
2. Tap any upcoming job → lands on that customer's detail page.
3. A plan member due in 10 days reads "3-day text goes out {weekday}" — the
   date shown is genuinely 3 days before their due date.
4. The reminder-engine card's footer line points at where the actual "Mark
   service done" control lives.
