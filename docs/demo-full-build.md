# TradeSura — full P0 loop demo

Takes you from an empty database to: verified engineer → branded 3-tier plan →
doorstep link → phone signup → **test-mode** Bacs mandate + subscription with
the 20% app fee → plan-document email → portal cancellation. No manual DB edits.

## 0. One-time prerequisites (human tasks)

1. **Stripe integration** — `vercel integration add stripe` (accept the
   Marketplace terms in the browser when prompted), then `vercel env pull`.
   That populates `STRIPE_SECRET_KEY` (`sk_test_…`) and
   `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_test_…`). `lib/stripe.ts` refuses
   any non-test key.
   - In the Stripe dashboard: **Connect** → enable Express accounts; complete
     the platform profile so **Bacs Direct Debit** is an available method.
2. **Webhook endpoint** — Stripe dashboard → Developers → Webhooks → add
   endpoint `<APP_URL>/api/stripe/webhook`, **with "Listen to events on
   Connected accounts" enabled**; events: `account.updated`,
   `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`,
   `customer.subscription.deleted`. Put the signing secret into `.env`
   (`STRIPE_WEBHOOK_SECRET`). Local dev: `stripe listen --forward-to
   localhost:3000/api/stripe/webhook` prints a `whsec_…` to use instead.
3. **Public tunnel** (needed for the real-phone step; the Stripe CLI covers
   webhooks locally):
   ```
   cloudflared tunnel --url http://localhost:3000
   ```
   Set `APP_URL` in `.env` to the printed `https://…trycloudflare.com` URL.
   Restart the dev server after changing `.env`.
   *(Local-only dry run? Leave `APP_URL=http://localhost:3000` — activation
   still works because the confirmed page actively polls the Checkout session;
   only the real-phone step needs the tunnel.)*
4. Real Gas Safe extract at `data/gas_safe.csv` if you have it — the repo ships
   a synthetic one (fictional engineers; reg no `584123` = "D. Smith, Smith
   Heating Ltd").

## 1. Empty DB → running app

```bash
npm install
npx prisma dev          # local Postgres — keep running (or use the preview server "planlock-db")
npx prisma migrate deploy
npm run db:seed          # 8 solicitor-approved clause templates
npm run import:gas-safe  # Gas Safe register lookup table
npm run dev              # or preview server "planlock"
npm run test && npm run typecheck && npm run lint   # tests green
```

## 2. Engineer: verify + brand (Screen 01)

1. Open `/signin`, enter any email → "Dev: open the sign-in link" (the email
   driver also prints the link to the server console).
2. Onboarding: Gas Safe no. `584 123` → **Check the register** → autofills
   "D. Smith · Smith Heating Ltd" → trading name `Smith Heating` → **Save**.
3. Step 3: **Set up payments** → complete the Stripe Connect Express test-mode
   onboarding → back with "✓ Payments ready" (`/api/me` syncs the account
   status; `account.updated` webhook confirms it out of band).

Events so far: `engineer_signed_up`, `gas_safe_verified`.

## 3. Branded plan (Screen 03)

`/plans` → **Start with the 3 recommended tiers** (two taps: Essential £9 /
Plus £15 / Complete £22, assembled from locked clauses only).
Try typing `We fix any breakdown free` as a custom line → **BLOCKED** with the
insurance explanation + nearest approved clause. Events: `tier_created` ×3.

## 4. Doorstep → real phone (Screens 04 + 09)

1. `/doorstep` → New customer (use a fictional 07700 900xxx number and an email
   you can read) → **Text the link now**. The SMS (dev driver) prints to the
   server console; **Show QR on my screen instead** for the phone.
2. Scan the QR with a real phone (needs the tunnel URL as `APP_URL`).
3. On the phone: tier cards show the full monthly price; pick **Plus** — the
   button restates "£15/month by Direct Debit" *before* the Stripe checkout.
4. Stripe Checkout (Bacs) — test bank details, use the 3-minute-delay account
   to mirror live timing: sort code `10-88-00`, account `90012345`, any name
   and email.
5. Watch the engineer screen: LINK SENT → OPENED → CHOOSING TIER → BANK
   DETAILS. Bacs settles on a delay — the screen holds at BANK DETAILS until
   the first collection clears (~3 min for the delayed test account), then
   flips to **ACTIVE** with the full-screen celebration.

Events: `doorstep_link_sent`, `signup_opened`, `tier_selected`,
`checkout_completed`, then `mandate_active` + `payment_confirmed` on
`invoice.paid`. Two abandon nudges are queued at link-send and cancelled on
activation (verify: `OutboundSms` rows with `cancelKey = nudge:<planId>`).

## 5. Verify the money (Stripe test dashboard)

In the Stripe dashboard (test mode), on the **platform** account:
- Payments / Subscriptions → "Smith Heating — Plus care plan", £15.00/month.
- The subscription's first invoice → charge of £15.00 with an **application
  fee of £3.00 (20%)** and a transfer of £12.00 to the connected (engineer)
  account. **If the application fee is missing, stop — do not work around it.**
- Connect → the engineer's Express account shows the £12.00 balance and the
  weekly payout schedule.

## 6. Plan-document email + portal (Screen 10)

- Server console shows `[EMAIL]` to the customer: tier clauses (assembled only
  from templates), price, **14-day cooling-off**, portal link.
- Portal link → covered card, included clauses, next service date.
- **Report a problem** → type "I can smell gas" → full-screen stop page
  (0800 111 999, required acknowledgement) → `emergency_interlock_triggered`
  logged; acknowledge → report reaches the engineer by email.

## 7. Cancel (2 taps)

Portal → Manage or cancel plan → **Cancel my plan** (tap 1) → **Yes, cancel my
plan** (tap 2) → subscription cancelled via the Stripe API (check the test
dashboard: subscription = canceled), confirmation email sent, queued nudges
cancelled, `plan_cancelled` logged.

## 8. Housekeeping

- Quiet-hours / nudge queue flush (dev): `curl -X POST <APP_URL>/api/jobs/flush-sms`
- Event audit: `SELECT name, ts FROM "Event" ORDER BY ts;`

## Evidence from the dry run (2026-07-06, GoCardless era — superseded)

The earlier dry run below was against the GoCardless flow, before the
2026-08-28 swap to Stripe (`docs/build-spec-v1-plan.md`). The
provider-independent parts (verification, tiers, blocklist, SMS nudges,
interlock, cancel) still hold; the payment-dependent steps (§2 step 3, §4
steps 4–5, §5, §7 provider side) need re-running against Stripe test mode.

- Engineer `dave@smithheating.co.uk` verified as `584123 · D. Smith · Smith
  Heating Ltd`, slug `smith-heating`.
- 3 preset tiers created two-tap; blocklist rejected "We fix any breakdown
  free" inline with clause suggestion (screenshot in session log).
- Doorstep plan `TSH-2882` → SMS printed:
  `[SMS] from="Smith Heating" to=+447700431902 … /p/smith-heating/signup/…`
  + 2 marketing nudges queued (18:30 same day, day+3 10:00) with STOP suffix.
- Signup page: white-label header, Gas Safe badge, 3-tier anchor, price on the
  button; choosing a tier before the engineer's payment setup is finished
  fails honestly ("hasn't finished their payment setup").
- Interlock: `emergency_interlock_triggered` events logged with
  `matched: "smell of gas"`, report stored with `emergencyAcknowledged: true`.
- 2-tap cancel on a second plan → `plan_cancelled` event + confirmation email.
- `next build` clean; unit tests, typecheck, lint all green.

## After the Stripe swap (2026-08-28)

- `lib/gocardless.ts` + `app/api/gc/**` + `GcWebhookEvent` removed; `lib/stripe.ts`,
  `app/api/stripe/{connect-link,webhook}`, migration `0005_stripe`, and
  `tests/stripe.test.ts` added.
- `next build` clean; root + mobile typecheck and lint green; 101 unit tests
  pass (the 2 `gas-safe` integration tests need a live DB — pre-existing).
- Not yet walked against live Stripe test mode — needs the integration
  installed (`vercel integration add stripe`) and the §0 dashboard steps.
