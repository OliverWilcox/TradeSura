# Interactive-prototype gap close

Six places where `tradesura-interactive-prototype.html` pinned down detail the
build had left looser or deferred. All closed 2026-08-28. Root + mobile
typecheck / lint / build / `expo export` green; 107/109 tests.

## 1 · C2 — embedded Payment Element (was hosted Checkout)

- `lib/stripe.ts` → `createEmbeddedSubscription()`: creates the platform
  Customer + an **incomplete** monthly Subscription as a destination charge
  (`transfer_data.destination`, `application_fee_percent`, `on_behalf_of`,
  `payment_behavior: default_incomplete`, `payment_method_types: ['bacs_debit']`),
  expands `latest_invoice.confirmation_secret`.
- `components/embedded-checkout.tsx` — `<Elements>` + `<PaymentElement>` +
  `confirmPayment({ redirect: 'if_required' })`, DD-Guarantee card, terms
  checkbox, green "Confirm and join" button. Deps added:
  `@stripe/stripe-js`, `@stripe/react-stripe-js`.
- `/api/p/[slug]/start` and `/api/signup/[token]/choose` now return
  `{ clientSecret, publishableKey, confirmedUrl }` instead of a redirect URL.
- `components/public-signup.tsx` + `components/signup-tiers.tsx` render the
  Payment Element inline once started; `/api/signup/[token]/status` polls the
  **subscription's** latest invoice (`subscriptionPaid`), not a session.
- Demo mode (E5) still just opens `/p/{slug}?demo=1` in a WebView — the inline
  form works there, no native Stripe SDK.
- Follow-up: a Stripe Product/Price is created per checkout (functionally
  fine; a per-tier cached price id would tidy the Stripe dashboard).

## 2 · E6 — price stepper

`mobile/app/tier/[tierId].tsx`: the free-text price field is now a
**`−` / `+` stepper** (50p steps, £8–£25 clamp). "Apply suggested" snaps to
the nearest 50p.

## 3 · E4 — Send Offer

The compose screen (`/offer`) now shows **the outgoing message as a bubble
preview** and two co-equal buttons: **Send by text** / **WhatsApp**.
`/api/offer` takes `channel: 'sms' | 'whatsapp'` — on `whatsapp` it skips our
branded SMS (the engineer shares the link himself via `whatsapp://send`) but
still queues the 3-day nudge and logs `offer_sent` with the channel.

## 4 · Payouts breakdown

`/api/payouts` + `mobile/app/payouts.tsx` now itemise the prototype's rows:
`N collections · your 80%` / `Referral bonus +£50` (from `referral_activated`
events this month) / `Processing (N × ~32p)` / **To your bank** /
`Bank ···{last4}` (from the connected account's external bank account).

## 5 · Dashboard "Today" list

`/api/dashboard` returns `referral` (the most-advanced unpaid invitee).
`mobile/app/(tabs)/index.tsx` renders a **Today card**: 🔧 services due →
Reminders · ⏳ payments retrying → Payouts · 🤝 "{name}'s nearly live — n/5
plans to your £50" → Referral.

## 6 · Reminders screen

The **Jobs tab is renamed "Reminders"** (`_layout.tsx` + header). The screen
leads with the prototype's framing line ("Gas engineers fit and forget. You
won't…"); member rows show **"✓ We've messaged them to book a weekday with
you"** + an `AUTO` (green) pill; non-member rows keep the one-tap
**Book + offer** button (`/api/jobs/remind`). The calendar stays (it's
restored Screen 07 scope). The bottom nav keeps 5 slots
(Home / Customers / [+] / Reminders / More + Plans) rather than the
prototype's exact 5 — the app carries more scope than the 18 prototype
screens (Plans builder, More hub); Payouts is one tap from the Home money
card.
