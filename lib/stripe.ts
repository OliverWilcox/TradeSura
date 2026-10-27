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
import { TRADESURA_FEE_RATE } from "@/lib/clauses";
import { profileUrl } from "@/lib/public-url";
import { addMonths, billingIntervalOf, chargePence, coolingOffEnd, type BillingInterval } from "@/lib/billing-interval";

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
// Capabilities are only what launch needs (Stripe's onboarding guidance,
// point 5): bacs_debit_payments on merchant and stripe_transfers on
// recipient. Checked in test mode 23 Oct: a GB account accepts Bacs without
// card_payments and asks for the same details.
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

// A saved connected account this key can't see: it was created under another
// platform (an earlier test sandbox). Stripe answers with a permission error.
export function belongsToAnotherPlatform(err: unknown): boolean {
  return (
    err instanceof Stripe.errors.StripePermissionError ||
    (err instanceof Stripe.errors.StripeError && err.code === "resource_missing")
  );
}

// What we already know about the engineer from sign-up (Build Review 3,
// section 7): Stripe's hosted onboarding opens with it filled in, so a
// one-person limited company only checks the business details, types a date
// of birth and home address, and adds bank details.
export type ConnectEngineer = {
  id: string;
  email: string;
  slug: string;
  businessType: string | null;
  tradingName: string | null;
  legalName?: string | null;
  companyNumber?: string | null;
  soleOwner?: boolean | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  postcode?: string | null;
  // "line1\ntown\npostcode" from sign-up's address step — the Companies House
  // registered office for a limited company (pre-filled, editable), the
  // engineer's own address for a sole trader.
  packAddress?: string | null;
  gasSafeCompany?: string | null;
  stripeAccountId: string | null;
};

// Stripe's statement descriptor rules: 5–22 characters, latin letters,
// numbers and spaces only (no < > \ ' " *), at least one letter. The engineer
// is the seller, so this is their trading name, e.g. "MW HEATING".
export function statementDescriptor(...names: (string | null | undefined)[]): string | undefined {
  for (const name of names) {
    const s = (name ?? "")
      .toUpperCase()
      .replace(/&/g, " AND ")
      .normalize("NFKD")
      .replace(/[^A-Z0-9 ]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 22)
      .trim();
    if (s.length >= 5 && /[A-Z]/.test(s)) return s;
  }
  return undefined;
}

type GbAddress = { line1?: string; city?: string; postal_code?: string; country: string };

function addressFrom(e: ConnectEngineer): GbAddress | undefined {
  const lines = (e.packAddress ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const postcode = e.postcode?.trim() || undefined;
  if (lines.length === 0) return postcode ? { country: "GB", postal_code: postcode } : undefined;
  const last = lines[lines.length - 1];
  const lastIsPostcode = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i.test(last);
  const body = lastIsPostcode ? lines.slice(0, -1) : lines;
  return {
    country: "GB",
    line1: body[0]?.slice(0, 200),
    city: body.length > 1 ? body[body.length - 1].slice(0, 100) : undefined,
    postal_code: lastIsPostcode ? last.toUpperCase() : postcode,
  };
}

// The person params type isn't re-exported under Stripe.V2.Core.
type PersonCreateParams = NonNullable<Parameters<Stripe["v2"]["core"]["accounts"]["persons"]["create"]>[1]>;

const MCC = "1711"; // Heating, plumbing, air-conditioning contractors

// Everything we can send, verified against the installed SDK's v2 types
// (stripe@22.6.0, V2/Core/Accounts.d.ts AccountCreateParams). Fields we
// don't know stay unset so Stripe asks for them.
function prefillParams(e: ConnectEngineer) {
  const isIndividual = e.businessType === "sole_trader";
  const entityType = e.businessType ? IDENTITY_ENTITY_TYPE[e.businessType] : undefined;
  const phone = e.phone || undefined;
  const address = addressFrom(e);
  const legalName = e.legalName?.trim() || (isIndividual ? undefined : e.gasSafeCompany?.trim()) || undefined;
  const descriptor = statementDescriptor(e.tradingName, legalName);

  const businessDetails: Stripe.V2.Core.AccountCreateParams.Identity.BusinessDetails = {
    phone,
    // Sole traders have no registered name; their trading name goes on the
    // profile as doing_business_as instead.
    registered_name: isIndividual ? undefined : legalName,
    id_numbers:
      e.businessType === "ltd" && e.companyNumber
        ? [{ type: "gb_crn", value: e.companyNumber }]
        : undefined,
    // Registered office for a company. A sole trader's business address is
    // their home address, which goes on the individual below.
    address: isIndividual ? undefined : address,
  };

  const person = {
    given_name: e.firstName?.trim() || undefined,
    surname: e.lastName?.trim() || undefined,
    email: e.email,
    phone,
  };
  // A sole trader IS the account's individual; their home address is the
  // business address.
  const individual: Stripe.V2.Core.AccountCreateParams.Identity.Individual | undefined = isIndividual
    ? { ...person, address }
    : undefined;
  // A company's representative is a Person on the account. "Are you the only
  // owner of the company?" yes → they're also the owner and director, so
  // those steps disappear. Anyone else lists their co-owners/directors in
  // Stripe.
  const soleOwnerOfCompany = !isIndividual && e.soleOwner === true;
  const representative: PersonCreateParams | undefined = isIndividual
    ? undefined
    : {
        ...person,
        relationship: soleOwnerOfCompany
          ? {
              representative: true,
              owner: true,
              director: true,
              executive: true,
              percent_ownership: Stripe.Decimal.from("100"),
              title: "Director",
            }
          : { representative: true },
      };

  return {
    representative,
    contact_email: e.email,
    contact_phone: phone,
    display_name: e.tradingName?.trim() || legalName || undefined,
    identity: {
      country: "gb",
      entity_type: entityType,
      business_details: businessDetails,
      individual,
      attestations: soleOwnerOfCompany
        ? { persons_provided: { owners: true, directors: true, executives: true } }
        : undefined,
    },
    profile: {
      // "Get paid" runs before the engineer has a live plan, so this page can
      // 404 for a little while — still the correct URL to have on file, and
      // it's what Stripe otherwise flags as "provide a business website".
      business_url: profileUrl(e.slug),
      doing_business_as: e.tradingName?.trim() || undefined,
      product_description: "Monthly gas boiler care plans sold to the engineer's own customers.",
    },
    merchant: {
      mcc: MCC,
      statement_descriptor: descriptor ? { descriptor } : undefined,
      // Customer-facing support details are the engineer's own, not TradeSura's.
      support: { email: e.email, phone },
    },
  } satisfies {
    representative?: PersonCreateParams;
    contact_email: string;
    contact_phone?: string;
    display_name?: string;
    identity: Stripe.V2.Core.AccountCreateParams.Identity;
    profile: Stripe.V2.Core.AccountCreateParams.Defaults.Profile;
    merchant: Stripe.V2.Core.AccountCreateParams.Configuration.Merchant;
  };
}

function baseCreateParams(e: ConnectEngineer): Stripe.V2.Core.AccountCreateParams {
  return {
    contact_email: e.email,
    display_name: e.tradingName?.trim() || undefined,
    dashboard: "express",
    identity: {
      country: "gb",
      entity_type: e.businessType ? IDENTITY_ENTITY_TYPE[e.businessType] : undefined,
    },
    defaults: {
      // Express dashboard requires both collectors set to "application" —
      // Stripe rejects the combination otherwise
      // (account_controller_express_dash_without_application_losses_or_fees).
      responsibilities: { fees_collector: "application", losses_collector: "application" },
      profile: {
        business_url: profileUrl(e.slug),
        product_description: "Monthly gas boiler care plans sold to the engineer's own customers.",
      },
    },
    configuration: {
      merchant: {
        mcc: MCC,
        capabilities: {
          bacs_debit_payments: { requested: true },
        },
      },
      recipient: RECIPIENT_CONFIGURATION,
    },
    metadata: { engineerId: e.id },
  };
}

// Creates the connected account on first call, returns the existing id after.
// One account per engineer, always: an accidental "Return to TradeSura"
// leaves this id saved and the next link carries on where they stopped.
export async function getOrCreateConnectAccount(engineer: ConnectEngineer): Promise<string> {
  if (engineer.stripeAccountId) return engineer.stripeAccountId;
  const stripe = getStripe();
  const base = baseCreateParams(engineer);
  const create = async (e: ConnectEngineer) => {
    const p = prefillParams(e);
    const account = await stripe.v2.core.accounts.create({
      ...base,
      contact_phone: p.contact_phone,
      display_name: p.display_name,
      identity: p.identity,
      defaults: { ...base.defaults, profile: p.profile },
      configuration: {
        ...base.configuration,
        merchant: { ...base.configuration!.merchant, ...p.merchant },
      },
    });
    if (p.representative) await addRepresentative(account.id, p.representative);
    return account.id;
  };
  try {
    return await create(engineer);
  } catch (err) {
    if (!(err instanceof Stripe.errors.StripeInvalidRequestError)) throw err;
    console.error("[stripe] pre-filled account create rejected:", err.message, err.param);
    // One field Stripe won't take shouldn't cost the whole pre-fill: a phone
    // number it rejects (e.g. Ofcom's 07700 drama range) is retried without
    // the phone; anything else falls back to the bare account and the hosted
    // form asks for it.
    if (/phone/i.test(`${err.param ?? ""} ${err.message}`)) {
      try {
        return await create({ ...engineer, phone: null });
      } catch (retryErr) {
        if (!(retryErr instanceof Stripe.errors.StripeInvalidRequestError)) throw retryErr;
        console.error("[stripe] pre-fill without phone rejected:", retryErr.message, retryErr.param);
      }
    }
    const account = await stripe.v2.core.accounts.create(base);
    return account.id;
  }
}

// Best-effort: the account is already usable without it — Stripe's form
// asks for the representative itself if this didn't land.
async function addRepresentative(
  accountId: string,
  rep: PersonCreateParams,
): Promise<void> {
  try {
    await getStripe().v2.core.accounts.persons.create(accountId, rep);
  } catch (err) {
    console.error("[stripe] pre-filled representative rejected:", err);
  }
}

// Keeps only the parts of `want` the account doesn't already have, so a
// best-effort fill never overwrites something the engineer typed in Stripe.
function missingOnly(want: unknown, have: unknown): unknown {
  if (want === undefined) return undefined;
  const isPlain = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
  const empty =
    have === undefined || have === null || have === "" || (Array.isArray(have) && have.length === 0);
  if (empty) return want;
  if (!isPlain(want) || !isPlain(have)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(want)) {
    const m = missingOnly(v, have[k]);
    if (m !== undefined && !(isPlain(m) && Object.keys(m).length === 0)) out[k] = m;
  }
  return Object.keys(out).length ? out : undefined;
}

// Accounts created before Build Review 3 went out bare. Before each new link,
// fill in whatever is still missing, best-effort: never once the engineer has
// accepted Stripe's terms (their submitted details are theirs), never fatal.
export async function prefillConnectAccount(accountId: string, engineer: ConnectEngineer): Promise<void> {
  const stripe = getStripe();
  try {
    const a = await stripe.v2.core.accounts.retrieve(accountId, {
      include: ["identity", "defaults", "configuration.merchant"],
    });
    if (a.identity?.attestations?.terms_of_service?.account?.date) return;
    const p = prefillParams(engineer);
    // A different entity type means the engineer chose it in Stripe — leave
    // identity alone rather than send details for the wrong kind of business.
    const entityMismatch =
      a.identity?.entity_type && p.identity.entity_type && a.identity.entity_type !== p.identity.entity_type;
    const patchFor = (q: ReturnType<typeof prefillParams>) => {
      const patch = {
        contact_phone: missingOnly(q.contact_phone, a.contact_phone),
        display_name: missingOnly(q.display_name, a.display_name),
        identity: entityMismatch ? undefined : missingOnly(q.identity, a.identity),
        defaults: missingOnly({ profile: q.profile }, a.defaults),
        configuration: missingOnly({ merchant: q.merchant }, a.configuration),
      };
      return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    };
    const update = patchFor(p);
    if (Object.keys(update).length > 0) {
      try {
        await stripe.v2.core.accounts.update(accountId, update as Stripe.V2.Core.AccountUpdateParams);
      } catch (err) {
        // As at create: a rejected phone shouldn't block the rest.
        if (!(err instanceof Stripe.errors.StripeInvalidRequestError) || !/phone/i.test(`${err.param ?? ""} ${err.message}`)) throw err;
        const retry = patchFor(prefillParams({ ...engineer, phone: null }));
        if (Object.keys(retry).length > 0) {
          await stripe.v2.core.accounts.update(accountId, retry as Stripe.V2.Core.AccountUpdateParams);
        }
      }
    }
    if (p.representative && !entityMismatch) {
      const people = await stripe.v2.core.accounts.persons.list(accountId);
      if (!people.data.some((x) => x.relationship?.representative)) {
        await addRepresentative(accountId, p.representative);
      }
    }
  } catch (err) {
    // Once the engineer has opened Stripe's form, Stripe owns those answers
    // and refuses platform writes — expected, nothing to fix.
    if (err instanceof Stripe.errors.StripeError && /do not have permission/i.test(err.message)) {
      console.log("[stripe] pre-fill skipped: the engineer has started Stripe's form");
      return;
    }
    console.error("[stripe] best-effort account pre-fill failed:", err);
  }
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
        // Build Review 3: ask only for what's due now, not everything Stripe
        // might want later (that's also the default — stated so it stays).
        collection_options: { fields: "currently_due", future_requirements: "omit" },
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
  // Stripe is waiting on the engineer for something right now.
  requirementsDue: boolean;
};

function statusFromV2Account(a: Stripe.V2.Core.Account): ConnectAccountStatus {
  const caps = a.configuration?.merchant?.capabilities;
  // "Charges enabled" means a destination charge will actually succeed, which
  // needs Bacs (the only way customers pay) and the recipient's transfers
  // capability — a merchant-only account would read as ready while every
  // checkout failed.
  const transfersActive =
    a.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === "active";
  const chargesEnabled = caps?.bacs_debit_payments?.status === "active" && transfersActive;
  const payoutsEnabled = caps?.stripe_balance?.payouts?.status === "active";
  const deadline = a.requirements?.summary?.minimum_deadline?.status;
  const requirementsDue =
    deadline === "currently_due" ||
    deadline === "past_due" ||
    (a.requirements?.entries ?? []).some(
      (r) =>
        r.awaiting_action_from === "user" &&
        (r.minimum_deadline.status === "currently_due" || r.minimum_deadline.status === "past_due"),
    );
  // v2 has no v1-style details_submitted. Hosted onboarding records the
  // terms-of-service acceptance on its final "Submit" step, so that's the
  // "they got to the end" signal; an accidental "Return to TradeSura" before
  // it leaves the account half set up.
  const tosAccepted = Boolean(a.identity?.attestations?.terms_of_service?.account?.date);
  return {
    detailsSubmitted: tosAccepted || (!requirementsDue && (chargesEnabled || payoutsEnabled)),
    chargesEnabled,
    payoutsEnabled,
    requirementsDue,
  };
}

// Build Review 3 — what the hub and Home show about payment setup.
//   none        no Stripe account yet
//   half        account exists, onboarding not finished (e.g. an accidental
//               "Return to TradeSura") — "Continue (about 1 minute left)"
//   needs_more  finished, but Stripe wants something else before payments
//               can start — "Stripe needs one more thing"
//   checking    finished, nothing due from the engineer, Stripe still
//               verifying — no action to take
//   ready       customers can pay and payouts are on
export type StripeSetupState = "none" | "half" | "needs_more" | "checking" | "ready";

export function stripeSetupState(
  e: {
    stripeAccountId: string | null;
    stripeDetailsSubmitted: boolean;
    stripeChargesEnabled: boolean;
    stripePayoutsEnabled: boolean;
  },
  // Live status when we just fetched it; without it, anything unfinished
  // after submission reads as needs_more (the safe prompt).
  live?: ConnectAccountStatus | null,
): StripeSetupState {
  if (!e.stripeAccountId) return "none";
  if (e.stripeChargesEnabled && e.stripePayoutsEnabled) return "ready";
  if (!e.stripeDetailsSubmitted) return "half";
  if (live && !live.requirementsDue) return "checking";
  return "needs_more";
}

// Used both by the /api/me poll and by the account.updated webhook handler —
// the webhook only tells us *something* changed on `event.account`, so both
// paths re-fetch current state rather than trust a payload shape.
export async function getConnectAccountStatus(accountId: string): Promise<ConnectAccountStatus> {
  const stripe = getStripe();
  const a = await stripe.v2.core.accounts.retrieve(accountId, {
    include: ["configuration.merchant", "configuration.recipient", "requirements", "identity"],
  });
  return statusFromV2Account(a);
}

// ---------------------------------------------------------------------------
// Customer plan — Bacs Direct Debit subscription as a destination charge
// ---------------------------------------------------------------------------

// Build Review 3: TradeSura pays Stripe's ~32p processing out of its own
// share, so the fee is exactly 20% rounded DOWN to the penny, in the
// engineer's favour (£15.99 → fee £3.19, engineer keeps £12.80). Payouts and
// statements use this same function so every figure reconciles to Stripe.
// Applied per invoice (not as a flat subscription-level percent) via the
// invoice.created webhook handler, which can still edit a draft invoice
// before Stripe finalizes it — see app/api/stripe/webhook/route.ts.
export function computeApplicationFeePence(invoiceTotalPence: number): number {
  return Math.floor(invoiceTotalPence * TRADESURA_FEE_RATE);
}

export function publishableKey(): string {
  return process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
}

// Embedded Bacs checkout (C2). Creates (or reuses) the platform Customer and
// an embedded Stripe Checkout Session that sets up the plan's subscription as
// a destination charge on behalf of the engineer. The form sits inside the
// white-label page; the subscription only exists once the customer finishes.
//
// Section 1 — cooling-off: no collection until 14 days after sign-up. The
// subscription starts with a trial ending then, so the first real invoice
// (the first collection) is created at trial_end. Checkout collects the Bacs
// mandate for the trial; Stripe won't let this account create Bacs mandates
// with a bare SetupIntent (27 Oct, test mode: "isn't configured to directly
// use SetupIntents to create Mandates for Bacs Direct Debits"), which is why
// sign-up goes through Checkout. checkout.session.completed then stores the
// subscription and activates the plan (completeSignupCheckout).
export async function createSignupCheckout(opts: {
  engineerAccountId: string;
  priceMonthlyPence: number;
  billingInterval?: BillingInterval;
  productName: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  existingStripeCustomerId?: string | null;
  planId: string;
  planRef: string;
  /** Where Checkout sends the customer when they finish ({CHECKOUT_SESSION_ID} allowed). */
  returnUrl: string;
  /** Win-back "first month free": extra months before the first collection. */
  extraFreeMonths?: number;
}): Promise<{ sessionId: string; customerId: string; clientSecret: string; trialEnd: Date }> {
  const stripe = getStripe();
  const interval = billingIntervalOf(opts.billingInterval);
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

  const trialEnd = addMonths(coolingOffEnd(new Date()), opts.extraFreeMonths ?? 0);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    ui_mode: "embedded_page",
    customer: customerId,
    payment_method_types: ["bacs_debit"],
    line_items: [
      {
        price_data: {
          currency: "gbp",
          // Yearly = 12 months for the price of 11, charged in one collection.
          unit_amount: chargePence(opts.priceMonthlyPence, interval),
          recurring: { interval },
          product_data: { name: opts.productName },
        },
        quantity: 1,
      },
    ],
    subscription_data: {
      trial_end: Math.floor(trialEnd.getTime() / 1000),
      trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
      // No flat application_fee_percent here — the invoice.created webhook
      // sets application_fee_amount per invoice (20%, rounded down), so every
      // collection (monthly or yearly) gets it before finalization.
      transfer_data: { destination: opts.engineerAccountId },
      on_behalf_of: opts.engineerAccountId,
      metadata: { planId: opts.planId, planRef: opts.planRef, billingInterval: interval },
    },
    metadata: { planId: opts.planId, purpose: "signup" },
    return_url: opts.returnUrl,
  });
  if (!session.client_secret) throw new Error("Stripe did not return a checkout secret");
  return { sessionId: session.id, customerId, clientSecret: session.client_secret, trialEnd };
}

// The finished sign-up Checkout for a plan, if there is one: the
// subscription it created and the Bacs payment method it saved.
export async function completedSignupCheckout(
  customerId: string,
  planId: string,
): Promise<{ subscriptionId: string; paymentMethodId: string | null } | null> {
  const list = await getStripe().checkout.sessions.list({ customer: customerId, limit: 10 });
  const done = list.data.find((cs) => cs.metadata?.planId === planId && cs.status === "complete");
  return done ? signupCheckoutResult(done) : null;
}

export async function signupCheckoutResult(
  session: Stripe.Checkout.Session,
): Promise<{ subscriptionId: string; paymentMethodId: string | null } | null> {
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  if (!subscriptionId) return null;
  const sub = await getStripe().subscriptions.retrieve(subscriptionId);
  const pm = sub.default_payment_method;
  return { subscriptionId, paymentMethodId: typeof pm === "string" ? pm : (pm?.id ?? null) };
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
  const paid =
    invoice != null && typeof invoice !== "string" && invoice.status === "paid" && invoice.amount_paid > 0;
  return { paid, customerId: typeof sub.customer === "string" ? sub.customer : null };
}

// Section 3 — failed payment rescue: a fresh Bacs mandate on the same
// platform customer, on behalf of the engineer as the original mandate was.
// Embedded Checkout in setup mode, for the same reason as sign-up (no bare
// Bacs SetupIntents on this account); the SetupIntent it makes carries the
// rescue metadata, and checkout.session.completed finishes the rescue.
export async function createRescueCheckout(opts: {
  customerId: string;
  engineerAccountId: string;
  planId: string;
}): Promise<{ id: string; clientSecret: string }> {
  const cs = await getStripe().checkout.sessions.create({
    mode: "setup",
    ui_mode: "embedded_page",
    currency: "gbp",
    customer: opts.customerId,
    payment_method_types: ["bacs_debit"],
    setup_intent_data: {
      on_behalf_of: opts.engineerAccountId,
      metadata: { planId: opts.planId, purpose: "rescue" },
    },
    metadata: { planId: opts.planId, purpose: "rescue" },
    // Bacs never leaves the page; the form's onComplete finishes the rescue.
    redirect_on_completion: "never",
  });
  if (!cs.client_secret) throw new Error("Stripe did not return a checkout secret");
  return { id: cs.id, clientSecret: cs.client_secret };
}

// The rescue Checkout's saved Bacs details, once the customer finishes.
export async function rescueCheckoutResult(
  session: Stripe.Checkout.Session,
): Promise<{ paymentMethodId: string; mandateId: string | null } | null> {
  const siId = typeof session.setup_intent === "string" ? session.setup_intent : session.setup_intent?.id;
  if (!siId) return null;
  const si = await getStripe().setupIntents.retrieve(siId);
  const pm = typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id;
  if (!pm) return null;
  return { paymentMethodId: pm, mandateId: typeof si.mandate === "string" ? si.mandate : (si.mandate?.id ?? null) };
}

export async function cancelStripeSubscription(subscriptionId: string) {
  const stripe = getStripe();
  return stripe.subscriptions.cancel(subscriptionId);
}

// Ruling 3 — move an existing subscription to a new monthly price from its
// next invoice. No proration: the notice period already ran, and the
// customer pays the new amount from the next collection.
export async function updateSubscriptionPrice(subscriptionId: string, newPricePence: number) {
  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const item = sub.items.data[0];
  if (!item) throw new Error(`Subscription ${subscriptionId} has no items`);
  const productId = typeof item.price.product === "string" ? item.price.product : item.price.product.id;
  // A yearly plan stays yearly: 12 months at the new price of 11.
  const interval = billingIntervalOf(item.price.recurring?.interval);
  const price = await stripe.prices.create({
    currency: "gbp",
    unit_amount: chargePence(newPricePence, interval),
    recurring: { interval },
    product: productId,
  });
  return stripe.subscriptions.update(subscriptionId, {
    items: [{ id: item.id, price: price.id }],
    proration_behavior: "none",
  });
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

// Platform-funded transfer to a connected account — the referrer's share of
// TradeSura's fee on one invoice (Build Review 2, ruling 4). Keyed on the
// invoice so a replayed webhook can't pay twice.
export async function payReferralCommission(
  accountId: string,
  amountPence: number,
  ref: string,
  invoiceId: string,
) {
  const stripe = getStripe();
  return stripe.transfers.create(
    {
      amount: amountPence,
      currency: "gbp",
      destination: accountId,
      description: `TradeSura referral commission (${ref})`,
      metadata: { kind: "referral_commission", ref, invoiceId },
    },
    { idempotencyKey: `referral-commission-${invoiceId}` },
  );
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
