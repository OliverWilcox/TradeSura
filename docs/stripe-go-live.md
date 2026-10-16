# Stripe: switching from test to live

Written for Build Review 2 (section 3, "Stripe account and going live"). Going
live is a human sign-off (CLAUDE.md): nothing here should be done by an agent.

## Where we are

- Test-mode platform account: `acct_1U11PuARf006Hfjk`, GB, business type
  "company", dashboard name "TradeSura". The API doesn't return a legal entity
  name, so **confirm in the Stripe dashboard (Settings → Business) that the
  legal entity is TradeSura Ltd**, not a personal or Vercel-provisioned
  sandbox. If it's a sandbox, claim it into TradeSura Ltd's Stripe
  organisation first.
- `lib/stripe.ts` refuses any key that isn't `sk_test_…`. That guard has to be
  changed deliberately as part of going live (step 8).

## Checklist

1. **Activate the live account** (TradeSura Ltd): company details, directors,
   bank account for TradeSura's fee income, statement descriptor.
2. **Connect platform profile** (live mode): platform name, support details,
   branding (lockup and ring from `public/brand/`), and the Connect
   onboarding settings used in test (Express-style, GB, Bacs).
3. **Enable Bacs Direct Debit** in live mode. Stripe reviews Bacs separately.
   Allow time for approval, and set the Bacs mandate display name and the
   service user details Stripe asks for.
4. **Pricing check:** confirm the 20% application fee and the 32p Bacs
   processing line (`computeApplicationFeePence`) against live Bacs fees.
5. **Live webhooks:** create both endpoints at
   `https://tradesura.com/api/stripe/webhook`: one for platform events, and
   one "Listen to events on Connected accounts" for `account.updated`. Events:
   `account.updated`, `checkout.session.completed`, `invoice.created`,
   `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`.
   Put both signing secrets in Vercel Production as `STRIPE_WEBHOOK_SECRET`
   and `STRIPE_WEBHOOK_SECRET_CONNECT`.
6. **Live keys in Vercel Production only:** `STRIPE_SECRET_KEY`,
   `STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`. Preview and
   Development stay on test keys.
7. **Referral commission transfers** (ruling 4) are platform-funded transfers,
   so keep enough balance in the live platform account (or enable top-ups) to
   cover them.
8. **Lift the test-only guard** in `lib/stripe.ts` so it accepts `sk_live_…`
   only when `VERCEL_ENV === "production"`. Review that change as its own PR.
9. **Existing test data:** connected accounts and subscriptions made in test
   mode don't carry over. Pilot engineers re-run "Get paid" against live, and
   any test plans in the production database are cancelled or cleared first.
10. **First live smoke test** with a real engineer account and a real £10 plan:
    offer, Direct Debit, `invoice.paid`, Home and Payouts update, payout on
    Friday. Then cancel it through the manage link and check the refund within
    cooling-off.
