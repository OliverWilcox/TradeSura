// Stripe integration. Engineer = Connect Express account (the settlement
// merchant, via on_behalf_of). Customer plans are monthly subscriptions
// created on the platform as destination charges, with TradeSura's 20% taken
// as an application fee and the balance transferred to the engineer's
// connected account. Funds only ever pass through the platform to the
// engineer — TradeSura never holds a customer balance.
//
// Docs consulted 2026-08-28:
//   docs.stripe.com/connect/subscriptions (destination charges + app fee)
//   docs.stripe.com/billing/subscriptions/bacs-debit (Bacs mandate + delayed settlement)
//   docs.stripe.com/connect/express-accounts (account links onboarding)
import Stripe from "stripe";
import { TRADESURA_FEE_RATE, BACS_PROCESSING_FEE_PENCE } from "@/lib/clauses";
import { appUrl } from "@/lib/app-url";

// CLAUDE.md: test/sandbox only. Go-live is a human sign-off — a hard stop,
// not a config toggle. Mirrors the old assertSandbox() guard.
function assertTestMode() {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!key.startsWith("sk_test_")) {
    throw new Error("Stripe is locked to test mode. Go-live is a human sign-off.");
  }
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

let _stripe: Stripe | null = null;
export function getStripe(): Stripe {
  assertTestMode();
  if (!_stripe) {
    // No explicit apiVersion — pin to the account default the SDK ships with.
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { typescript: true });
  }
  return _stripe;
}

// ---------------------------------------------------------------------------
// Engineer onboarding — Connect v2 Accounts
// ---------------------------------------------------------------------------
// Accounts v1 (`stripe.accounts.create({ type: "express" })`) is disabled for
// this platform — Stripe now requires new connected accounts to go through
// the v2 Accounts API (docs.stripe.com/connect/accounts-v2). Migrated
// 2026-09-23; field names verified against the installed SDK's own type
// definitions (node_modules/stripe/.../V2/Core/Accounts.d.ts), not just docs.
//
// Configuration: `merchant` AND `recipient`. Merchant makes the engineer the
// merchant of record (on_behalf_of); recipient carries the
// stripe_balance.stripe_transfers capability, which is the only thing that
// lets an account be a `transfer_data.destination`. Merchant-only accounts
// fail every destination charge with "No such destination: acct_…" (seen in
// production 29 Sept, req_vqw2i8fG29yblL) — the merchant config has no
// transfers capability at all in the v2 types.
//
// VERIFY IN TEST MODE before relying on this: the bacs_debit_payments
// capability key under configuration.merchant.capabilities is confirmed to
// exist in the SDK types, but its actual approval behaviour for a GB
// individual/company account (does it need anything else alongside
// card_payments?) hasn't been exercised against a live sandbox call from
// this session — no Stripe CLI/keys available here. Watch for
// capability_not_available_* errors on first real account creation.
const IDENTITY_ENTITY_TYPE: Record<string, "individual" | "company"> = {
  sole_trader: "individual",
  ltd: "company",
  partnership: "company",
};

const RECIPIENT_CONFIGURATION = {
  capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
};

// Accounts created between the v2 migration (23 Sept) and the recipient fix
// are merchant-only. Idempotent: adds the recipient configuration if it's
// missing, no-op otherwise. The engineer may then have a requirement or two
// to finish in onboarding, which the next account link collects.
export async function ensureRecipientConfiguration(accountId: string): Promise<void> {
  const stripe = getStripe();
  const a = await stripe.v2.core.accounts.retrieve(accountId, {
    include: ["configuration.recipient"],
  });
  if (a.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers) return;
  await stripe.v2.core.accounts.update(accountId, {
    configuration: { recipient: RECIPIENT_CONFIGURATION },
  });
}

// The error a merchant-only (or otherwise non-transfer-capable) account gives
// on a destination charge. Checkout routes use this to heal the account and
// flip the engineer back to "finish payment setup" instead of failing
// silently on every customer.
export function isMissingDestination(err: unknown): boolean {
  return (
    err instanceof Stripe.errors.StripeInvalidRequestError &&
    err.code === "resource_missing" &&
    err.param === "transfer_data[destination]"
  );
}

// Creates the connected account on first call, returns the existing id after.
export async function getOrCreateConnectAccount(engineer: {
  id: string;
  email: string;
  slug: string;
  businessType: string | null;
  tradingName: string | null;
  stripeAccountId: string | null;
}): Promise<string> {
  if (engineer.stripeAccountId) return engineer.stripeAccountId;
  const stripe = getStripe();
  const account = await stripe.v2.core.accounts.create({
    contact_email: engineer.email,
    display_name: engineer.tradingName?.trim() || undefined,
    dashboard: "express",
    identity: {
      country: "gb",
      entity_type: engineer.businessType ? IDENTITY_ENTITY_TYPE[engineer.businessType] : undefined,
    },
    defaults: {
      // Express dashboard requires both collectors set to "application" —
      // Stripe rejects the combination otherwise
      // (account_controller_express_dash_without_application_losses_or_fees).
      responsibilities: { fees_collector: "application", losses_collector: "application" },
      profile: {
        // "Get paid" runs before the engineer has a live plan (onboarding
        // step 1 of 4), so this page can 404 for a little while — still the
        // correct URL to have on file, and it's what Stripe otherwise flags
        // as an "Overdue: provide a business website" requirement.
        business_url: `${appUrl()}/p/${engineer.slug}`,
        product_description: "Monthly gas boiler care plans sold to the engineer's own customers.",
      },
    },
    configuration: {
      merchant: {
        mcc: "1711", // Heating, plumbing, air-conditioning contractors
        capabilities: {
          // card_payments is a platform-level prerequisite for the merchant
          // configuration even though this integration only charges Bacs —
          // mirrors the same requirement the old v1 Express account had.
          card_payments: { requested: true },
          bacs_debit_payments: { requested: true },
        },
      },
      recipient: RECIPIENT_CONFIGURATION,
    },
    metadata: { engineerId: engineer.id },
  });
  return account.id;
}

export async function createAccountOnboardingLink(
  accountId: string,
  opts: { returnUrl: string; refreshUrl: string },
): Promise<string> {
  const stripe = getStripe();
  const link = await stripe.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: ["merchant", "recipient"],
        return_url: opts.returnUrl,
        refresh_url: opts.refreshUrl,
      },
    },
  });
  return link.url;
}

export type ConnectAccountStatus = {
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
};

function statusFromV2Account(a: Stripe.V2.Core.Account): ConnectAccountStatus {
  const caps = a.configuration?.merchant?.capabilities;
  // "Charges enabled" means a destination charge will actually succeed, which
  // needs the recipient's transfers capability too — card_payments alone
  // let a merchant-only account read as ready while every checkout failed.
  const transfersActive =
    a.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === "active";
  const chargesEnabled = caps?.card_payments?.status === "active" && transfersActive;
  const payoutsEnabled = caps?.stripe_balance?.payouts?.status === "active";
  // v2 has no single "details_submitted" boolean like v1 did — the nearest
  // analog is whether anything is blocking right now.
  const currentlyDue = a.requirements?.summary?.minimum_deadline?.status === "currently_due";
  return {
    detailsSubmitted: !currentlyDue && (chargesEnabled || payoutsEnabled),
    chargesEnabled,
    payoutsEnabled,
  };
}

// Used both by the /api/me poll and by the account.updated webhook handler —
// the webhook only tells us *something* changed on `event.account`, so both
// paths re-fetch current state rather than trust a payload shape.
export async function getConnectAccountStatus(accountId: string): Promise<ConnectAccountStatus> {
  const stripe = getStripe();
  const a = await stripe.v2.core.accounts.retrieve(accountId, {
    include: ["configuration.merchant", "configuration.recipient", "requirements"],
  });
  return statusFromV2Account(a);
}

// ---------------------------------------------------------------------------
// Customer plan — Bacs Direct Debit subscription as a destination charge
// ---------------------------------------------------------------------------

// Build Spec v1 S1/Q2: 20% + ~32p Bacs processing, borne by the engineer.
// Applied per invoice (not as a flat subscription-level percent) via the
// invoice.created webhook handler, which can still edit a draft invoice
// before Stripe finalizes it — see app/api/stripe/webhook/route.ts.
export function computeApplicationFeePence(invoiceTotalPence: number): number {
  return Math.round(invoiceTotalPence * TRADESURA_FEE_RATE) + BACS_PROCESSING_FEE_PENCE;
}

export function publishableKey(): string {
  return process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
}

// Embedded Bacs checkout (C2). Creates the platform Customer and an
// incomplete monthly Subscription as a destination charge, and returns the
// confirmation secret the Payment Element needs — the customer never leaves
// the white-label page.
export async function createEmbeddedSubscription(opts: {
  engineerAccountId: string;
  priceMonthlyPence: number;
  productName: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  existingStripeCustomerId?: string | null;
  planId: string;
  planRef: string;
}): Promise<{ subscriptionId: string; customerId: string; clientSecret: string }> {
  const stripe = getStripe();

  const customerId =
    opts.existingStripeCustomerId ??
    (
      await stripe.customers.create({
        name: opts.customerName,
        email: opts.customerEmail,
        phone: opts.customerPhone,
        metadata: { planId: opts.planId },
      })
    ).id;

  const price = await stripe.prices.create({
    currency: "gbp",
    unit_amount: opts.priceMonthlyPence,
    recurring: { interval: "month" },
    product_data: { name: opts.productName },
  });

  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: price.id }],
    payment_behavior: "default_incomplete",
    payment_settings: {
      payment_method_types: ["bacs_debit"],
      save_default_payment_method: "on_subscription",
    },
    // No flat application_fee_percent here — the invoice.created webhook sets
    // application_fee_amount per invoice (20% + Bacs processing), so every
    // month's invoice (including this first one) gets it before finalization.
    transfer_data: { destination: opts.engineerAccountId },
    on_behalf_of: opts.engineerAccountId,
    metadata: { planId: opts.planId, planRef: opts.planRef },
    expand: ["latest_invoice.confirmation_secret"],
  });

  const invoice = subscription.latest_invoice;
  const secret =
    invoice && typeof invoice !== "string"
      ? (invoice as unknown as { confirmation_secret?: { client_secret?: string } })
          .confirmation_secret?.client_secret
      : undefined;
  if (!secret) throw new Error("Stripe did not return a confirmation secret");

  return { subscriptionId: subscription.id, customerId, clientSecret: secret };
}

// Poll fallback for local dev without a webhook tunnel. Returns whether the
// first Bacs collection on this subscription has cleared.
export async function subscriptionPaid(
  subscriptionId: string,
): Promise<{ paid: boolean; customerId: string | null }> {
  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["latest_invoice"],
  });
  const invoice = sub.latest_invoice;
  const paid = invoice != null && typeof invoice !== "string" && invoice.status === "paid";
  return { paid, customerId: typeof sub.customer === "string" ? sub.customer : null };
}

export async function cancelStripeSubscription(subscriptionId: string) {
  const stripe = getStripe();
  return stripe.subscriptions.cancel(subscriptionId);
}

// ---------------------------------------------------------------------------
// Payouts (E11) — read the connected account's real Stripe balance + payouts
// ---------------------------------------------------------------------------
// Unchanged by the v1→v2 Accounts migration above: Balance, Payouts and
// external_accounts stay on the v1 API surface regardless of which API
// created the account — the v2 SDK types describe the stripe_balance
// capability itself as "Enables this Account to complete payouts from their
// Stripe Balance (/v1/balance)".

export type PayoutSummary = {
  pendingPence: number;
  availablePence: number;
  bankLast4: string | null;
  nextPayout: { amountPence: number; arrivalDate: string; status: string } | null;
  history: { id: string; amountPence: number; arrivalDate: string; status: string }[];
};

export async function getPayoutSummary(accountId: string): Promise<PayoutSummary> {
  const stripe = getStripe();
  const opts = { stripeAccount: accountId };
  const [balance, payouts, account] = await Promise.all([
    stripe.balance.retrieve({}, opts),
    stripe.payouts.list({ limit: 13 }, opts),
    stripe.accounts.retrieve(accountId),
  ]);
  const extBank = account.external_accounts?.data.find((a) => a.object === "bank_account") as
    | { last4?: string }
    | undefined;
  const gbp = (rows: { amount: number; currency: string }[]) =>
    rows.filter((r) => r.currency === "gbp").reduce((s, r) => s + r.amount, 0);

  const upcoming = payouts.data.find((p) => p.status === "pending" || p.status === "in_transit");
  return {
    pendingPence: gbp(balance.pending),
    availablePence: gbp(balance.available),
    bankLast4: extBank?.last4 ?? null,
    nextPayout: upcoming
      ? {
          amountPence: upcoming.amount,
          arrivalDate: new Date(upcoming.arrival_date * 1000).toISOString(),
          status: upcoming.status,
        }
      : null,
    history: payouts.data
      .filter((p) => p.status === "paid")
      .slice(0, 12)
      .map((p) => ({
        id: p.id,
        amountPence: p.amount,
        arrivalDate: new Date(p.arrival_date * 1000).toISOString(),
        status: p.status,
      })),
  };
}

// Platform-funded transfer to a connected account (E10 referral bounty).
export async function payReferralBounty(accountId: string, amountPence: number, ref: string) {
  const stripe = getStripe();
  return stripe.transfers.create({
    amount: amountPence,
    currency: "gbp",
    destination: accountId,
    description: `TradeSura referral bounty (${ref})`,
    metadata: { kind: "referral_bounty", ref },
  });
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

// Stripe requires two separate webhook endpoint objects for one URL to
// receive both scopes (docs.stripe.com/connect/webhooks): an "account"
// endpoint (connect:false) for platform events — checkout, invoices,
// subscriptions — and a "Connect" endpoint (connect:true) for
// account.updated on connected accounts. Each has its own signing secret,
// so a single request may have been signed with either — try each in turn.
export function constructWebhookEvent(
  rawBody: string,
  signature: string,
  secrets: string[],
): Stripe.Event {
  let lastErr: unknown;
  for (const secret of secrets) {
    try {
      return getStripe().webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}
