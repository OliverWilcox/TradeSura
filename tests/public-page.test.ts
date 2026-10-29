import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.SESSION_SECRET = "test-secret-for-public-page";
});
vi.mock("next/headers", () => ({ headers: async () => new Map() }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
import { isProfilePreview, pageMode, profilePreviewToken, profileVisible } from "@/lib/public-page";
import { getActor, signToken } from "@/lib/auth";

const live = { gasSafeVerifiedAt: new Date(), pausedAt: null, bannedAt: null, stripeChargesEnabled: true };

describe("public page mode (Review 4)", () => {
  it("is live only with the Gas Safe check and payments both done", () => {
    expect(pageMode({ preview: false, practice: false, engineer: live })).toBe("live");
    expect(pageMode({ preview: false, practice: false, engineer: { ...live, gasSafeVerifiedAt: null } })).toBe("closed");
    expect(pageMode({ preview: false, practice: false, engineer: { ...live, stripeChargesEnabled: false } })).toBe("closed");
    expect(pageMode({ preview: false, practice: false, engineer: { ...live, pausedAt: new Date() } })).toBe("closed");
  });

  it("preview and demo practice never take a real sign-up", () => {
    expect(pageMode({ preview: true, practice: false, engineer: live })).toBe("preview");
    expect(pageMode({ preview: false, practice: true, engineer: live })).toBe("practice");
    expect(pageMode({ preview: true, practice: true, engineer: live })).toBe("preview");
  });

  it("an unpublished profile is visible only through a preview link", () => {
    expect(profileVisible(false, false)).toBe(false);
    expect(profileVisible(false, true)).toBe(true);
    expect(profileVisible(true, false)).toBe(true);
  });
});

describe("profile preview link", () => {
  it("opens only the engineer it was made for", async () => {
    const token = await profilePreviewToken("mw-heating");
    expect(await isProfilePreview(token, "mw-heating")).toBe(true);
    expect(await isProfilePreview(token, "someone-else")).toBe(false);
    expect(await isProfilePreview(undefined, "mw-heating")).toBe(false);
    expect(await isProfilePreview("not-a-token", "mw-heating")).toBe(false);
  });

  it("a sign-in token is not a preview link", async () => {
    expect(await isProfilePreview(await signToken({ engineerId: "e1" }, "1h"), "mw-heating")).toBe(false);
  });

  it("a preview link can't be used to sign in", async () => {
    const token = await profilePreviewToken("mw-heating");
    vi.doMock("next/headers", () => ({ headers: async () => new Map([["authorization", `Bearer ${token}`]]) }));
    vi.resetModules();
    const auth = await import("@/lib/auth");
    expect(await auth.getActor()).toBeNull();
    expect(getActor).toBeDefined();
  });
});
