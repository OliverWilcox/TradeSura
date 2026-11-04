import { createHmac, timingSafeEqual } from "node:crypto";

// Twilio's request-signing algorithm: HMAC-SHA1, keyed by the Auth Token, of
// the exact webhook URL with every POST param's key+value appended in
// alphabetical order — see https://www.twilio.com/docs/usage/security.
// The URL must match byte-for-byte what Twilio was given (the console, or a
// message's StatusCallback).
export function verifyTwilioSignature(url: string, params: URLSearchParams, signature: string, authToken: string) {
  const sorted = [...params.keys()].sort();
  const data = sorted.reduce((acc, key) => acc + key + params.get(key), url);
  const expected = createHmac("sha1", authToken).update(data, "utf8").digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Matt asked that the main Auth Token isn't used. Without it, each webhook
// address in Twilio carries a secret instead (?key=TWILIO_WEBHOOK_KEY), and
// that is what's checked. With the Auth Token set, Twilio's signature counts too.
export function webhookKeyMatches(url: string): boolean {
  const key = process.env.TWILIO_WEBHOOK_KEY;
  if (!key) return false;
  const given = Buffer.from(new URL(url).searchParams.get("key") ?? "");
  const expected = Buffer.from(key);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Whether a webhook request came from Twilio: the URL's secret key, or Twilio's signature. */
export function twilioWebhookCheck(
  urls: string[],
  params: URLSearchParams,
  signature: string | null,
): "ok" | "not_configured" | "forbidden" {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken && !process.env.TWILIO_WEBHOOK_KEY) return "not_configured";
  if (urls.some(webhookKeyMatches)) return "ok";
  if (authToken && signature && urls.some((url) => verifyTwilioSignature(url, params, signature, authToken))) return "ok";
  return "forbidden";
}
