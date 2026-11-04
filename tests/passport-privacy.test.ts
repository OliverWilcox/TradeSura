// Matt, 4 Nov — a forwarded Home Passport link shows nothing personal until
// the homeowner enters a code texted to the mobile on their plan, and the
// link itself expires. Engineers' photos and documents: each only their own.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  process.env.SESSION_SECRET = "test-secret-for-passport-privacy-0123456789";
  return {
    cookies: new Map<string, string>(),
    passport: { id: "pp1" } as { id: string } | null,
    planPhones: [{ customer: { phone: "+447700900123" } }],
    loadView: vi.fn(),
    requestCode: vi.fn(async () => ({ requestToken: "rt" })),
    verifyCode: vi.fn(),
    fileFindMany: vi.fn(async () => []),
    fileDeleteMany: vi.fn(async () => ({ count: 0 })),
    recordFindFirst: vi.fn(async () => null),
    track: vi.fn(),
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (m.cookies.has(name) ? { value: m.cookies.get(name) } : undefined),
    set: (name: string, value: string) => m.cookies.set(name, value),
  }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    homePassport: { findUnique: vi.fn(async () => m.passport) },
    plan: { findMany: vi.fn(async () => m.planPhones) },
    property: { findMany: vi.fn(async () => []) },
    passportFile: { findMany: m.fileFindMany, deleteMany: m.fileDeleteMany },
    serviceRecord: { findFirst: m.recordFindFirst },
  },
}));
vi.mock("@/lib/passport", async (orig) => ({ ...(await orig<typeof import("@/lib/passport")>()), loadPassportView: m.loadView }));
vi.mock("@/lib/contact-verification", async (orig) => ({
  ...(await orig<typeof import("@/lib/contact-verification")>()),
  requestContactCode: m.requestCode,
  verifyContactCode: m.verifyCode,
}));
vi.mock("@/lib/track", () => ({ track: m.track }));
vi.mock("@/app/api/customers/[id]/passport/access", async (orig) => ({
  ...(await orig<typeof import("@/app/api/customers/[id]/passport/access")>()),
  passportAccess: vi.fn(async () => ({
    ok: true,
    actor: { actorId: "e1", businessId: "e1", role: "owner" },
    customerId: "c1",
    passportId: "pp1",
    state: "LIVE",
  })),
}));

import { PASSPORT_LINK_DAYS, passportLinkState, passportPath } from "@/lib/passport-link";
import { VerificationError } from "@/lib/contact-verification";
import PassportPage from "@/app/passport/[token]/page";
import { PassportGate } from "@/components/passport-gate";
import { POST as homeownerBoiler } from "@/app/api/passport/[token]/boiler/route";
import { POST as requestCode } from "@/app/api/passport/[token]/code/route";
import { POST as verify } from "@/app/api/passport/[token]/verify/route";
import { DELETE as deleteFile, GET as listFiles, POST as addFile } from "@/app/api/customers/[id]/passport/files/route";

const TOKEN = "view-token-abc";
const params = { params: Promise.resolve({ token: TOKEN }) };
const post = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body) });
const linkParts = (path: string) => Object.fromEntries(new URL(`http://x${path}`).searchParams) as { e: string; s: string };

beforeEach(() => {
  m.cookies.clear();
  m.passport = { id: "pp1" };
  m.loadView.mockReset();
  m.requestCode.mockClear();
  m.verifyCode.mockReset();
  m.fileFindMany.mockClear();
  m.fileDeleteMany.mockClear();
  m.recordFindFirst.mockClear();
});

describe("passport links expire", () => {
  it("a fresh link is good; past its 30 days it isn't", () => {
    const now = new Date("2026-11-04T12:00:00Z");
    const { e, s } = linkParts(passportPath(TOKEN, now));
    expect(passportLinkState(TOKEN, e, s, now)).toBe("ok");
    const later = new Date(now.getTime() + (PASSPORT_LINK_DAYS + 1) * 86_400_000);
    expect(passportLinkState(TOKEN, e, s, later)).toBe("expired");
  });

  it("an old unsigned link, an edited date or another home's signature counts as expired", () => {
    const { e, s } = linkParts(passportPath(TOKEN));
    expect(passportLinkState(TOKEN, undefined, undefined)).toBe("expired");
    expect(passportLinkState(TOKEN, String(Number(e) + 86_400 * 365), s)).toBe("expired");
    expect(passportLinkState("another-home", e, s)).toBe("expired");
  });
});

describe("nothing personal without the code", () => {
  it("the page shows only the code screen, and never loads the passport", async () => {
    const { e, s } = linkParts(passportPath(TOKEN));
    const page = (await PassportPage({ params: params.params, searchParams: Promise.resolve({ e, s }) })) as {
      props: { children: { type: unknown; props: { expired: boolean; mobiles: string[] } } };
    };
    expect(m.loadView).not.toHaveBeenCalled();
    expect(page.props.children.type).toBe(PassportGate);
    expect(page.props.children.props).toMatchObject({ expired: false, mobiles: ["mobile ending 23"] });
  });

  it("an old link shows the expired screen", async () => {
    const page = (await PassportPage({ params: params.params, searchParams: Promise.resolve({}) })) as {
      props: { children: { props: { expired: boolean } } };
    };
    expect(page.props.children.props.expired).toBe(true);
    expect(m.loadView).not.toHaveBeenCalled();
  });

  it("the homeowner's boiler form is refused", async () => {
    const res = await homeownerBoiler(post({ make: "Worcester" }), params);
    expect(res.status).toBe(401);
  });

  it("a code is only texted from an in-date link, to the number on file", async () => {
    expect((await requestCode(post({}), params)).status).toBe(410);
    const { e, s } = linkParts(passportPath(TOKEN));
    const res = await requestCode(post({ e, s }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sentTo: "mobile ending 23" });
    expect(m.requestCode).toHaveBeenCalledWith("passport-sms", "+447700900123", { passportId: "pp1", phone: "+447700900123" });
  });
});

describe("the code", () => {
  it("a wrong code is refused and lets nobody in", async () => {
    m.verifyCode.mockRejectedValue(new VerificationError("That code doesn't match — try again."));
    const res = await verify(post({ requestToken: "rt", code: "0000" }), params);
    expect(res.status).toBe(400);
    expect(m.cookies.size).toBe(0);
  });

  it("a code for another home doesn't open this one", async () => {
    m.verifyCode.mockResolvedValue({ passportId: "someone-else" });
    expect((await verify(post({ requestToken: "rt", code: "1234" }), params)).status).toBe(400);
    expect(m.cookies.size).toBe(0);
  });

  it("the right code opens the passport, even once the link has expired", async () => {
    m.verifyCode.mockResolvedValue({ passportId: "pp1" });
    expect((await verify(post({ requestToken: "rt", code: "1234" }), params)).status).toBe(200);
    m.loadView.mockResolvedValue(null);
    await PassportPage({ params: params.params, searchParams: Promise.resolve({}) }).catch(() => null);
    expect(m.loadView).toHaveBeenCalledWith({ viewToken: TOKEN });
  });
});

describe("photos and documents: each engineer sees only their own", () => {
  const ctx = { params: Promise.resolve({ id: "c1" }) };

  it("listing asks only for this engineer's files", async () => {
    await listFiles(new Request("http://x"), ctx);
    expect(m.fileFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { passportId: "pp1", engineerId: "e1" } }));
  });

  it("removing only reaches this engineer's files", async () => {
    const res = await deleteFile(new Request("http://x?fileId=f9", { method: "DELETE" }), ctx);
    expect(m.fileDeleteMany).toHaveBeenCalledWith({ where: { id: "f9", passportId: "pp1", engineerId: "e1" } });
    expect(res.status).toBe(404);
  });

  it("adding to another engineer's visit is refused", async () => {
    const res = await addFile(post({ kind: "invoice", base64: "JVBERi0=", mimeType: "application/pdf", recordId: "r-other" }), ctx);
    expect(m.recordFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "r-other", passportId: "pp1", engineerId: "e1" } }));
    expect(res.status).toBe(404);
  });
});
