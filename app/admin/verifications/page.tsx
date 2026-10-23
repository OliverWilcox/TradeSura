import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { CLAUSE_TEMPLATES } from "@/lib/clauses";
import { confirmedQualifications } from "@/lib/plan-rules";
import { notifyEngineer } from "@/lib/sms";
import { sendEmail } from "@/lib/email";
import { sendPushNotification } from "@/lib/push";
import { track } from "@/lib/track";
import { companyOfficers, officerMatches, type Officer } from "@/lib/companies-house";
import { AdminNav } from "@/components/admin-nav";

export const dynamic = "force-dynamic";

// 29 Sept review — "Submit for verification" puts every new engineer's
// Gas Safe number + ID-card photo here; a person checks them against the
// register and grants or rejects the badge. Signup never grants it.
// Gated by ADMIN_SECRET (open /admin/verifications?key=…); no admin
// accounts exist yet, so this is deliberately the smallest thing that works.
function authorised(key: string | undefined): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || !key || key.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(key), Buffer.from(secret));
}

async function emailEngineer(engineerId: string, subject: string, html: string) {
  const engineer = await prisma.engineer.findUnique({ where: { id: engineerId }, select: { email: true, firstName: true } });
  if (!engineer?.email) return;
  await sendEmail({
    to: engineer.email,
    subject,
    html: `<p>Hi ${engineer.firstName ?? "there"},</p>${html}`,
  }).catch((err) => console.error("[verify] result email failed:", err));
}

async function decide(formData: FormData) {
  "use server";
  const key = String(formData.get("key") ?? "");
  if (!authorised(key)) return;
  const engineerId = String(formData.get("engineerId"));
  const approve = formData.get("decision") === "approve";
  const reason = String(formData.get("reason") ?? "").trim() || null;

  if (approve) {
    await prisma.engineer.update({
      where: { id: engineerId },
      data: { gasSafeVerifiedAt: new Date(), gasSafeRejectedAt: null, gasSafeRejectReason: null },
    });
    // Part 6.4 — badge-granted: push → strip flips to active → avatar tick
    // → member pack ships. The last three read gasSafeVerifiedAt directly.
    await sendPushNotification(
      engineerId,
      "You're verified",
      "You're Gas Safe verified — your member pack is on its way",
      { url: "/more" },
    );
    await notifyEngineer(engineerId, "You're Gas Safe verified on TradeSura — your member pack is on its way.");
    // Build Review 2 — texts aren't switched on yet, so email carries the
    // result alongside the push.
    await emailEngineer(
      engineerId,
      "You're Gas Safe verified on TradeSura",
      "<p>Good news — we've checked your Gas Safe registration and your Verified badge is now live. You can send plan offers straight away, and your member pack is on its way.</p>",
    );
    await track("gas_safe_verified", { type: "SYSTEM" }, { engineerId, via: "admin_review" });
  } else {
    await prisma.engineer.update({
      where: { id: engineerId },
      data: { gasSafeRejectedAt: new Date(), gasSafeRejectReason: reason },
    });
    await notifyEngineer(
      engineerId,
      "We couldn't verify your Gas Safe number on TradeSura — open the app to check it and try again.",
    );
    await emailEngineer(
      engineerId,
      "We couldn't verify your Gas Safe registration",
      `<p>We weren't able to verify your Gas Safe registration${reason ? ` (${reason.replace(/</g, "&lt;")})` : ""}. Open the TradeSura app to check your number and ID card, then submit it again.</p>`,
    );
    await sendPushNotification(
      engineerId,
      "Verification needs a look",
      "We couldn't verify your Gas Safe number — check it and try again.",
      { url: "/more" },
    );
    await track("gas_safe_rejected", { type: "SYSTEM" }, { engineerId, reason });
  }
  revalidatePath("/admin/verifications");
}

// Part 17.4 / 30 Sept step 2 item 10 — "the welcome pack only posts when the
// badge goes live". Address capture is allowed before verification; this is
// the list of packs that are now actually allowed to go out.
async function markPosted(formData: FormData) {
  "use server";
  if (!authorised(String(formData.get("key") ?? ""))) return;
  const engineerId = String(formData.get("engineerId"));
  await prisma.engineer.update({ where: { id: engineerId }, data: { packShippedAt: new Date() } });
  await track("member_pack_shipped", { type: "SYSTEM" }, { engineerId });
  revalidatePath("/admin/verifications");
}

function Officers({
  officers,
  firstName,
  lastName,
}: {
  officers: Officer[] | null;
  firstName: string | null;
  lastName: string | null;
}) {
  if (officers === null) return <div className="mt-1 text-xs text-muted">Officers unavailable — check Companies House.</div>;
  const matched = officers.some((o) => officerMatches(o.name, firstName, lastName));
  return (
    <div className="mt-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">
        Current officers{" "}
        <span className={matched ? "text-ok" : "text-warn"}>
          {matched ? "· name matches" : "· no name match — check they're a director"}
        </span>
      </div>
      <ul className="mt-1 text-xs">
        {officers.map((o) => (
          <li key={o.name} className={officerMatches(o.name, firstName, lastName) ? "font-semibold" : ""}>
            {o.name} <span className="text-muted">({o.role})</span>
          </li>
        ))}
        {officers.length === 0 && <li className="text-muted">None listed</li>}
      </ul>
    </div>
  );
}

export default async function Verifications({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>;
}) {
  const { key } = await searchParams;
  if (!authorised(key)) {
    return <main className="p-8 text-sm text-muted">Not found.</main>;
  }

  const queue = await prisma.engineer.findMany({
    where: { gasSafeVerifiedAt: null, gasSafeRejectedAt: null, gasSafeNo: { not: null } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      tradingName: true,
      email: true,
      phone: true,
      gasSafeNo: true,
      gasSafeCardUrl: true,
      businessType: true,
      companyNumber: true,
      companyStatus: true,
      qualificationConfirmations: true,
      createdAt: true,
    },
  });

  // Review 3 R12 — every engineer who has confirmed a qualification, newest
  // first, so a confirmation made after approval is still seen.
  const qualified = await prisma.engineer.findMany({
    where: { qualificationConfirmations: { not: Prisma.DbNull } },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: { id: true, firstName: true, lastName: true, tradingName: true, gasSafeNo: true, qualificationConfirmations: true },
  });

  const officersByEngineer = new Map(
    await Promise.all(
      queue
        .filter((e) => e.businessType === "ltd" && e.companyNumber)
        .map(async (e) => [e.id, await companyOfficers(e.companyNumber!)] as const),
    ),
  );

  // The Verified Member seal never ships to an unverified, paused or banned
  // account (Part 14 LAW) — those packs simply wait off this list.
  const packs = await prisma.engineer.findMany({
    where: {
      packRequestedAt: { not: null },
      packShippedAt: null,
      gasSafeVerifiedAt: { not: null },
      pausedAt: null,
      bannedAt: null,
    },
    orderBy: { gasSafeVerifiedAt: "asc" },
    select: { id: true, firstName: true, lastName: true, tradingName: true, packAddress: true, gasSafeVerifiedAt: true },
  });

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <AdminNav adminKey={key!} current="/admin/verifications" />
      <h1 className="text-2xl font-bold">Gas Safe verification queue</h1>
      <p className="mt-1 text-sm text-muted">
        Check each number and card against the Gas Safe register, then approve or reject.
        Engineers get a push, text and email either way.
      </p>
      {queue.length === 0 && <p className="mt-8 text-sm">Nothing waiting.</p>}
      <ul className="mt-6 flex flex-col gap-4">
        {queue.map((e) => (
          <li key={e.id} className="rounded-xl border border-line bg-paper p-4">
            <div className="flex flex-wrap items-start gap-4">
              {e.gasSafeCardUrl ? (
                <a href={e.gasSafeCardUrl} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- admin-only preview of an uploaded photo */}
                  <img src={e.gasSafeCardUrl} alt="Gas Safe ID card" className="h-40 w-auto rounded-lg" />
                </a>
              ) : (
                <div className="flex h-40 w-56 items-center justify-center rounded-lg border border-line text-xs text-muted">
                  No card photo yet — added later from the app
                </div>
              )}
              <div className="min-w-0 flex-1 text-sm">
                <div className="text-lg font-semibold">
                  {e.firstName} {e.lastName}
                </div>
                <div>{e.tradingName}</div>
                {e.businessType === "ltd" && e.companyNumber && (
                  <div className="mt-1">
                    Company {e.companyNumber}
                    {/* Flag, never block (30 Sept build notes, step 3). */}
                    {e.companyStatus && e.companyStatus !== "active" && (
                      <span className="ml-2 rounded bg-danger-tint px-1.5 py-0.5 text-xs font-semibold text-danger">
                        Companies House: {e.companyStatus}
                      </span>
                    )}
                    <Officers
                      officers={officersByEngineer.get(e.id) ?? null}
                      firstName={e.firstName}
                      lastName={e.lastName}
                    />
                  </div>
                )}
                <div className="mt-2 font-mono text-base">Gas Safe {e.gasSafeNo}</div>
                <Qualifications value={e.qualificationConfirmations} />
                <div className="mt-2 text-muted">
                  {e.email} · {e.phone} · signed up {e.createdAt.toLocaleString("en-GB", { timeZone: "Europe/London" })}
                </div>
                <a
                  href="https://www.gassaferegister.co.uk/"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-flame underline"
                >
                  Check the register →
                </a>
              </div>
            </div>
            <form action={decide} className="mt-4 flex flex-wrap items-center gap-2">
              <input type="hidden" name="key" value={key} />
              <input type="hidden" name="engineerId" value={e.id} />
              <button
                name="decision"
                value="approve"
                className="rounded-lg bg-white px-4 py-2 font-semibold text-[#0f2140]"
              >
                Approve
              </button>
              <input
                name="reason"
                placeholder="Reason if rejecting"
                className="min-w-48 flex-1 rounded-lg border border-line bg-transparent px-3 py-2"
              />
              <button
                name="decision"
                value="reject"
                className="rounded-lg border border-danger px-4 py-2 font-semibold text-danger"
              >
                Reject
              </button>
            </form>
          </li>
        ))}
      </ul>

      <h2 className="mt-12 text-xl font-bold">Member packs to post</h2>
      <p className="mt-1 text-sm text-muted">
        Verified accounts whose pack is waiting. Packs for accounts still in the queue above stay
        off this list until they&apos;re approved.
      </p>
      {packs.length === 0 && <p className="mt-6 text-sm">Nothing to post.</p>}
      <ul className="mt-4 flex flex-col gap-3">
        {packs.map((e) => (
          <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line bg-paper p-4 text-sm">
            <div className="min-w-0">
              <div className="font-semibold">
                {e.firstName} {e.lastName} · {e.tradingName}
              </div>
              <div className="mt-1 whitespace-pre-line">{e.packAddress}</div>
              <div className="mt-1 text-muted">Verified {e.gasSafeVerifiedAt?.toLocaleDateString("en-GB", { timeZone: "Europe/London" })}</div>
            </div>
            <form action={markPosted}>
              <input type="hidden" name="key" value={key} />
              <input type="hidden" name="engineerId" value={e.id} />
              <button className="rounded-lg bg-white px-4 py-2 font-semibold text-[#0f2140]">Mark posted</button>
            </form>
          </li>
        ))}
      </ul>
      <h2 className="mt-10 text-xl font-bold">Qualification confirmations</h2>
      <p className="mt-1 text-sm text-muted">
        Engineers who confirmed they&apos;re qualified for an option (gas fires, cookers, unvented
        cylinders, legionella). Spot-check against the register categories.
      </p>
      {qualified.length === 0 && <p className="mt-4 text-sm">None yet.</p>}
      <ul className="mt-4 flex flex-col gap-2">
        {qualified.map((e) => (
          <li key={e.id} className="rounded-xl border border-line bg-paper p-3 text-sm">
            <b>
              {e.firstName} {e.lastName}
            </b>{" "}
            · {e.tradingName} · Gas Safe {e.gasSafeNo}
            <Qualifications value={e.qualificationConfirmations} />
          </li>
        ))}
      </ul>
    </main>
  );
}

function Qualifications({ value }: { value: unknown }) {
  const entries = Object.entries(confirmedQualifications(value));
  if (!entries.length) return null;
  return (
    <ul className="mt-2 list-disc pl-5">
      {entries.map(([code, at]) => (
        <li key={code}>
          {CLAUSE_TEMPLATES.find((c) => c.code === code)?.title ?? code}: confirmed{" "}
          {new Date(at).toLocaleDateString("en-GB", { timeZone: "Europe/London" })}
        </li>
      ))}
    </ul>
  );
}
