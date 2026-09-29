import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { notifyEngineer } from "@/lib/sms";
import { sendPushNotification } from "@/lib/push";
import { track } from "@/lib/track";

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
    );
    await notifyEngineer(engineerId, "You're Gas Safe verified on TradeSura — your member pack is on its way.");
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
    await track("gas_safe_rejected", { type: "SYSTEM" }, { engineerId, reason });
  }
  revalidatePath("/admin/verifications");
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
      createdAt: true,
    },
  });

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <h1 className="text-2xl font-bold">Gas Safe verification queue</h1>
      <p className="mt-1 text-sm text-muted">
        Check each number and card against the Gas Safe register, then approve or reject.
        Engineers are texted either way.
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
                  No card photo (older app build)
                </div>
              )}
              <div className="min-w-0 flex-1 text-sm">
                <div className="text-lg font-semibold">
                  {e.firstName} {e.lastName}
                </div>
                <div>{e.tradingName}</div>
                <div className="mt-2 font-mono text-base">Gas Safe {e.gasSafeNo}</div>
                <div className="mt-2 text-muted">
                  {e.email} · {e.phone} · signed up {e.createdAt.toLocaleString("en-GB")}
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
    </main>
  );
}
