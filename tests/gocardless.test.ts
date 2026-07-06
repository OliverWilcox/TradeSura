import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "@/lib/gocardless";
import { appFeePence } from "@/lib/clauses";

describe("webhook signature verification", () => {
  const secret = "test-secret";
  const body = JSON.stringify({ events: [{ id: "EV1" }] });
  const good = crypto.createHmac("sha256", secret).update(body).digest("hex");

  it("accepts a valid signature", () => {
    expect(verifyWebhookSignature(body, good, secret)).toBe(true);
  });
  it("rejects a tampered body", () => {
    expect(verifyWebhookSignature(body + " ", good, secret)).toBe(false);
  });
  it("rejects a wrong-length signature without throwing", () => {
    expect(verifyWebhookSignature(body, "abc", secret)).toBe(false);
  });
});

describe("20% app fee", () => {
  it("£15.00 → £3.00", () => expect(appFeePence(1500)).toBe(300));
  it("£9.00 → £1.80", () => expect(appFeePence(900)).toBe(180));
  it("rounds to nearest penny", () => expect(appFeePence(999)).toBe(200));
});
