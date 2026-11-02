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
