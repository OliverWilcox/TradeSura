import { describe, expect, it } from "vitest";
import { isExpoPushToken } from "@/lib/push";

describe("isExpoPushToken", () => {
  it("accepts the current ExpoPushToken format", () => {
    expect(isExpoPushToken("ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]")).toBe(true);
  });
  it("accepts the classic ExponentPushToken format", () => {
    expect(isExpoPushToken("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]")).toBe(true);
  });
  it("rejects an empty token", () => {
    expect(isExpoPushToken("")).toBe(false);
  });
  it("rejects a bare device token that isn't wrapped by Expo", () => {
    expect(isExpoPushToken("abc123")).toBe(false);
  });
  it("rejects a token missing the closing bracket", () => {
    expect(isExpoPushToken("ExpoPushToken[abc123")).toBe(false);
  });
});
