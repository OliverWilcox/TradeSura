// How we sign in to Twilio to send. An API key (TWILIO_API_KEY_SID +
// TWILIO_API_KEY_SECRET) is preferred: it can be revoked on its own, and
// Matt asked that sending never uses the main Auth Token. TWILIO_AUTH_TOKEN
// is still needed for one thing an API key can't do: checking the signature
// on what Twilio sends us (STOP replies, delivery receipts), since Twilio
// signs those with the Auth Token only. Older setups with only the Auth
// Token keep working.
export function twilioAuth(): { accountSid: string; authorization: string } | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  if (!accountSid) return null;
  const keySid = process.env.TWILIO_API_KEY_SID;
  const keySecret = process.env.TWILIO_API_KEY_SECRET;
  const [user, pass] = keySid && keySecret ? [keySid, keySecret] : [accountSid, process.env.TWILIO_AUTH_TOKEN];
  if (!pass) return null;
  return { accountSid, authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` };
}
