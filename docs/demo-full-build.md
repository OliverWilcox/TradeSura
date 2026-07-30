# TradeSura — full P0 loop demo

Takes you from an empty database to: verified engineer → branded 3-tier plan →
doorstep link → phone signup → **sandbox** mandate + subscription with the 20%
app fee → plan-document email → portal cancellation. No manual DB edits.

## 0. One-time prerequisites (human tasks)

1. **GoCardless sandbox partner app** — create at
   https://manage-sandbox.gocardless.com → Developers → Create → App.
   - Redirect URI: `<APP_URL>/api/gc/callback`
   - Put the client id/secret into `.env` (`GC_OAUTH_CLIENT_ID`, `GC_OAUTH_CLIENT_SECRET`).
2. **Webhook endpoint** — Developers → Webhook endpoints → create, URL
   `<APP_URL>/api/gc/webhook`; put its secret into `.env` (`GC_WEBHOOK_SECRET`).
3. **Public tunnel** (needed for webhooks + the real-phone step):
   ```
   cloudflared tunnel --url http://localhost:3000
   ```
   Set `APP_URL` in `.env` to the printed `https://…trycloudflare.com` URL and
   use that URL in the GoCardless redirect URI + webhook endpoint. Restart the
   dev server after changing `.env`.
   *(Local-only dry run? Leave `APP_URL=http://localhost:3000` — activation
   still works because the confirmed page actively polls the billing request;
   only the real-phone step and webhooks need the tunnel.)*
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
npm run test && npm run typecheck && npm run lint   # 53 tests green
```

## 2. Engineer: verify + brand (Screen 01)

1. Open `/signin`, enter any email → "Dev: open the sign-in link" (the email
   driver also prints the link to the server console).
2. Onboarding: Gas Safe no. `584 123` → **Check the register** → autofills
   "D. Smith · Smith Heating Ltd" → trading name `Smith Heating` → **Save**.
3. Step 3: **Connect GoCardless (sandbox)** → approve on the GC sandbox page →
   back with "✓ GoCardless connected".

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
   button restates "£15/month by Direct Debit" *before* the GoCardless page.
4. GoCardless hosted flow — sandbox test bank details:
   sort code `20-00-00`, account `55779911`, any UK address.
5. Watch the engineer screen: LINK SENT → OPENED → CHOOSING TIER → BANK
   DETAILS → **ACTIVE** with the full-screen flame-lit celebration.

Events: `doorstep_link_sent`, `signup_opened`, `tier_selected`,
`mandate_active`. Two abandon nudges are queued at link-send and cancelled on
activation (verify: `OutboundSms` rows with `cancelKey = nudge:<planId>`).

## 5. Verify the money (GC sandbox dashboard)

In https://manage-sandbox.gocardless.com **as the connected engineer org**:
- Customers → the mandate (ACTIVE)
- Subscriptions → "Smith Heating — Plus care plan", £15.00 monthly, and on the
  subscription/first payment the **app fee of £3.00 (20%)** payable to the
  partner app. **If the app fee is missing, stop — do not work around it.**

## 6. Plan-document email + portal (Screen 10)

- Server console shows `[EMAIL]` to the customer: tier clauses (assembled only
  from templates), price, **14-day cooling-off**, portal link.
- Portal link → covered card, included clauses, next service date.
- **Report a problem** → type "I can smell gas" → full-screen stop page
  (0800 111 999, required acknowledgement) → `emergency_interlock_triggered`
  logged; acknowledge → report reaches the engineer by email.

## 7. Cancel (2 taps)

Portal → Manage or cancel plan → **Cancel my plan** (tap 1) → **Yes, cancel my
plan** (tap 2) → subscription cancelled via the GC API (check the sandbox
dashboard: subscription = cancelled), confirmation email sent, queued nudges
cancelled, `plan_cancelled` logged.

## 8. Housekeeping

- Quiet-hours / nudge queue flush (dev): `curl -X POST <APP_URL>/api/jobs/flush-sms`
- Event audit: `SELECT name, ts FROM "Event" ORDER BY ts;`

## Evidence from the dry run (2026-07-06, no GC creds yet)

Everything below was exercised live in a browser against a clean DB; the
GC-dependent steps (§2 step 3, §4 steps 4–5, §5, §7 GC side) await the `.env`
credentials — the code paths are built and unit-tested.

- Engineer `dave@smithheating.co.uk` verified as `584123 · D. Smith · Smith
  Heating Ltd`, slug `smith-heating`.
- 3 preset tiers created two-tap; blocklist rejected "We fix any breakdown
  free" inline with clause suggestion (screenshot in session log).
- Doorstep plan `TSH-2882` → SMS printed:
  `[SMS] from="Smith Heating" to=+447700431902 … /p/smith-heating/signup/…`
  + 2 marketing nudges queued (18:30 same day, day+3 10:00) with STOP suffix.
- Signup page: white-label header, Gas Safe badge, 3-tier anchor, price on the
  button; choose-with-no-GC-creds fails honestly ("hasn't finished their
  payment setup").
- Interlock: `emergency_interlock_triggered` events logged with
  `matched: "smell of gas"`, report stored with `emergencyAcknowledged: true`.
- 2-tap cancel on a second plan → `plan_cancelled` event + confirmation email.
- `next build` clean; 53 unit tests, typecheck, lint all green.
