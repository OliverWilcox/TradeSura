// Letter → app without Branch (Matt, 13 Nov): the claim page notes its network
// (hashed) when it sends someone to the store; the app's first open gets the
// code back only when exactly one claim page was opened from that network.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ hints: [] as { meta: unknown }[], claimable: new Set<string>(), track: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { event: { findMany: vi.fn(async () => m.hints) } } }));
vi.mock("@/lib/track", () => ({ track: m.track }));
vi.mock("@/lib/claim", () => ({ claimForPage: vi.fn(async (c: string) => (m.claimable.has(c) ? { code: c } : null)) }));

import { matchInstall, networkKey, recordInstallHint } from "@/lib/install-match";

const from = (ip: string) => new Request("https://tradesura.com/api/claim/install-match", { headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } });

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "s");
  m.hints = [];
  m.claimable = new Set(["SMITH-7K3Q", "JONES-4M2P"]);
  m.track.mockClear();
});

describe("install matching", () => {
  it("never stores the address, only a keyed hash", async () => {
    await recordInstallHint("SMITH-7K3Q", from("81.2.69.160"));
    const meta = m.track.mock.calls[0][2] as { net: string };
    expect(meta.net).toBe(networkKey(from("81.2.69.160")));
    expect(JSON.stringify(meta)).not.toContain("81.2.69.160");
  });

  it("returns the one code opened from this network", async () => {
    m.hints = [{ meta: { code: "SMITH-7K3Q" } }, { meta: { code: "SMITH-7K3Q" } }];
    expect(await matchInstall(from("81.2.69.160"))).toBe("SMITH-7K3Q");
  });

  it("returns nothing when two different codes share the network, or the code is used", async () => {
    m.hints = [{ meta: { code: "SMITH-7K3Q" } }, { meta: { code: "JONES-4M2P" } }];
    expect(await matchInstall(from("81.2.69.160"))).toBeNull();
    m.hints = [{ meta: { code: "SMITH-7K3Q" } }];
    m.claimable.clear();
    expect(await matchInstall(from("81.2.69.160"))).toBeNull();
  });
});
