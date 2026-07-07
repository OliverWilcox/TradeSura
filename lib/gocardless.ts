// GoCardless sandbox integration. Engineer is the merchant: all merchant API
// calls use the engineer's OAuth org token. Tradeshura never holds funds.
// Endpoints per developer.gocardless.com (checked 2026-07-06).
import crypto from "node:crypto";

const GC_API = "https://api-sandbox.gocardless.com";
const GC_CONNECT = "https://connect-sandbox.gocardless.com";

// CLAUDE.md: sandbox only, go-live is a human sign-off. Hard stop, not a config.
function assertSandbox() {
  if (process.env.GC_ENVIRONMENT !== "sandbox") {
    throw new Error("GoCardless is locked to sandbox. Go-live is a human sign-off.");
  }
}

export function gcConfigured(): boolean {
  return Boolean(process.env.GC_OAUTH_CLIENT_ID && process.env.GC_OAUTH_CLIENT_SECRET);
}

export function oauthAuthorizeUrl(state: string): string {
  assertSandbox();
  const params = new URLSearchParams({
    client_id: process.env.GC_OAUTH_CLIENT_ID!,
    redirect_uri: `${process.env.APP_URL}/api/gc/callback`,
    scope: "read_write",
    response_type: "code",
    state,
  });
  return `${GC_CONNECT}/oauth/authorize?${params}`;
}

export async function exchangeOAuthCode(code: string) {
  assertSandbox();
  const res = await fetch(`${GC_CONNECT}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GC_OAUTH_CLIENT_ID!,
      client_secret: process.env.GC_OAUTH_CLIENT_SECRET!,
      redirect_uri: `${process.env.APP_URL}/api/gc/callback`,
      grant_type: "authorization_code",
      code,
    }),
  });
  if (!res.ok) {
    throw new Error(`GoCardless token exchange failed (${res.status})`);
  }
  return (await res.json()) as { access_token: string; organisation_id: string };
}

async function gcFetch<T>(
  accessToken: string,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
): Promise<T> {
  assertSandbox();
  const res = await fetch(`${GC_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "GoCardless-Version": "2015-07-06",
      "Content-Type": "application/json",
      ...(method === "POST" ? { "Idempotency-Key": crypto.randomUUID() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    // Never log tokens; the response body is safe and needed for diagnosis.
    const detail = await res.text();
    throw new Error(`GoCardless ${method} ${path} failed (${res.status}): ${detail.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

type GcLinks = Record<string, string | undefined>;

// One billing request carries both the mandate and the monthly subscription
// with Tradeshura's app fee — GoCardless creates both when the customer
// completes the hosted flow.
export async function createBillingRequestWithSubscription(
  accessToken: string,
  opts: { amountPence: number; appFeePence: number; name: string },
) {
  const res = await gcFetch<{ billing_requests: { id: string; links: GcLinks } }>(
    accessToken,
    "POST",
    "/billing_requests",
    {
      billing_requests: {
        mandate_request: { scheme: "bacs", currency: "GBP" },
        subscription_request: {
          amount: opts.amountPence,
          currency: "GBP",
          interval_unit: "monthly",
          name: opts.name,
          app_fee: opts.appFeePence,
        },
      },
    },
  );
  return res.billing_requests;
}

export async function createBillingRequestFlow(
  accessToken: string,
  opts: {
    billingRequestId: string;
    redirectUri: string;
    exitUri: string;
    prefilled: {
      given_name?: string;
      family_name?: string;
      email?: string;
      address_line1?: string;
      city?: string;
      postal_code?: string;
    };
  },
) {
  const res = await gcFetch<{
    billing_request_flows: { id: string; authorisation_url: string };
  }>(accessToken, "POST", "/billing_request_flows", {
    billing_request_flows: {
      redirect_uri: opts.redirectUri,
      exit_uri: opts.exitUri,
      prefilled_customer: opts.prefilled,
      links: { billing_request: opts.billingRequestId },
    },
  });
  return res.billing_request_flows;
}

export async function getBillingRequest(accessToken: string, id: string) {
  const res = await gcFetch<{
    billing_requests: { id: string; status: string; links: GcLinks };
  }>(accessToken, "GET", `/billing_requests/${id}`);
  return res.billing_requests;
}

export async function getSubscription(accessToken: string, id: string) {
  const res = await gcFetch<{
    subscriptions: { id: string; status: string; amount: number; app_fee?: number | null };
  }>(accessToken, "GET", `/subscriptions/${id}`);
  return res.subscriptions;
}

export async function cancelGcSubscription(accessToken: string, id: string) {
  const res = await gcFetch<{ subscriptions: { id: string; status: string } }>(
    accessToken,
    "POST",
    `/subscriptions/${id}/actions/cancel`,
    { data: {} },
  );
  return res.subscriptions;
}

// Webhook-Signature = HMAC-SHA256 hex digest of the raw body with the
// endpoint secret. Timing-safe compare.
export function verifyWebhookSignature(rawBody: string, signature: string, secret: string) {
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export type GcEvent = {
  id: string;
  resource_type: string;
  action: string;
  links: GcLinks;
};
