import Link from "next/link";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { adminAuthorised } from "@/lib/admin-auth";
import { profileUrl } from "@/lib/public-url";
import { AdminNav } from "@/components/admin-nav";

export const dynamic = "force-dynamic";

// Review 3 §9 — Mohammed's engineers list: everyone who has signed up, with
// their Gas Safe and Stripe state and what they've sold. Gated by
// ADMIN_SECRET like the other admin pages: open /admin/engineers?key=…
const BUSINESS_TYPE: Record<string, string> = { sole_trader: "Sole trader", ltd: "Ltd", partnership: "Partnership" };
const th = "text-left font-mono text-[10px] uppercase tracking-[0.08em] text-faint px-2 py-1.5";
const td = "px-2 py-1.5 border-t border-line-soft align-top";

type Row = {
  gasSafeNo: string | null;
  gasSafeVerifiedAt: Date | null;
  gasSafeRejectedAt: Date | null;
  stripeAccountId: string | null;
  stripeDetailsSubmitted: boolean;
  stripeChargesEnabled: boolean;
  stripePayoutsEnabled: boolean;
};

function gasSafeState(e: Row): { label: string; cls: string } {
  if (e.gasSafeVerifiedAt) return { label: "Verified", cls: "text-ok" };
  if (e.gasSafeRejectedAt) return { label: "Rejected", cls: "text-danger" };
  if (e.gasSafeNo) return { label: "Pending", cls: "text-warn" };
  return { label: "Not submitted", cls: "text-muted" };
}

function stripeState(e: Row): string {
  if (!e.stripeAccountId) return "Not started";
  if (e.stripeChargesEnabled && e.stripePayoutsEnabled) return "Ready";
  if (e.stripeChargesEnabled) return "Charges on, payouts off";
  if (e.stripeDetailsSubmitted) return "Under review";
  return "Started";
}

export default async function Engineers({ searchParams }: { searchParams: Promise<{ key?: string; q?: string }> }) {
  const { key, q } = await searchParams;
  if (!adminAuthorised(key)) return <main className="p-8 text-sm text-muted">Not found.</main>;

  const query = q?.trim() ?? "";
  const contains = (field: string): Prisma.EngineerWhereInput => ({
    [field]: { contains: query, mode: "insensitive" },
  });
  const where: Prisma.EngineerWhereInput = {
    deletedAt: null,
    ...(query
      ? {
          OR: ["firstName", "lastName", "tradingName", "legalName", "email", "phone", "slug", "town", "gasSafeNo"].map(
            contains,
          ),
        }
      : {}),
  };

  const [engineers, livePlans, activeCustomers] = await Promise.all([
    prisma.engineer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        tradingName: true,
        legalName: true,
        email: true,
        phone: true,
        slug: true,
        town: true,
        businessType: true,
        gasSafeNo: true,
        gasSafeVerifiedAt: true,
        gasSafeRejectedAt: true,
        stripeAccountId: true,
        stripeDetailsSubmitted: true,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        ownerId: true,
        owner: { select: { tradingName: true, legalName: true } },
        pausedAt: true,
        bannedAt: true,
        leftAt: true,
        createdAt: true,
      },
    }),
    prisma.plan.groupBy({ by: ["engineerId"], where: { status: { in: ["ACTIVE", "PAUSED"] } }, _count: true }),
    prisma.customer.groupBy({
      by: ["engineerId"],
      where: { plans: { some: { status: "ACTIVE" } } },
      _count: true,
    }),
  ]);
  const liveBy = new Map(livePlans.map((r) => [r.engineerId, r._count]));
  const customersBy = new Map(activeCustomers.map((r) => [r.engineerId, r._count]));

  return (
    <main className="mx-auto w-full max-w-7xl p-6 text-sm">
      <AdminNav adminKey={key!} current="/admin/engineers" />
      <h1 className="text-2xl font-bold">Engineers</h1>
      <p className="mt-1 text-muted">
        {engineers.length} {query ? `matching “${query}”` : "signed up"}
        {engineers.length === 500 ? " (showing the newest 500)" : ""}. Staff plans and customers count towards
        their business owner.
      </p>

      <form className="mt-4 flex flex-wrap gap-2" action="/admin/engineers">
        <input type="hidden" name="key" value={key} />
        <input
          name="q"
          defaultValue={query}
          placeholder="Search name, email, phone, town, Gas Safe no…"
          className="min-w-64 flex-1 rounded-lg border border-line bg-transparent px-3 py-2"
        />
        <button className="rounded-lg bg-white px-4 py-2 font-semibold text-[#0f2140]">Search</button>
        {query && (
          <Link href={`/admin/engineers?key=${encodeURIComponent(key!)}`} className="self-center text-flame underline">
            Clear
          </Link>
        )}
      </form>

      <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-paper">
        <table className="w-full min-w-[1100px]">
          <thead>
            <tr>
              <th className={th}>Name</th>
              <th className={th}>Trading name</th>
              <th className={th}>Contact</th>
              <th className={th}>Profile</th>
              <th className={th}>Town</th>
              <th className={th}>Business</th>
              <th className={th}>Gas Safe</th>
              <th className={th}>Stripe</th>
              <th className={`${th} text-right`}>Live plans</th>
              <th className={`${th} text-right`}>Active customers</th>
              <th className={th}>Joined</th>
              <th className={th}>Role</th>
            </tr>
          </thead>
          <tbody>
            {engineers.map((e) => {
              const gs = gasSafeState(e);
              const flags = [e.bannedAt && "Banned", e.pausedAt && "Paused", e.leftAt && "Left"].filter(Boolean);
              return (
                <tr key={e.id}>
                  <td className={td}>
                    <div className="font-semibold">{[e.firstName, e.lastName].filter(Boolean).join(" ") || "—"}</div>
                    {flags.length > 0 && <div className="text-xs font-semibold text-danger">{flags.join(" · ")}</div>}
                  </td>
                  <td className={td}>{e.tradingName || e.legalName || "—"}</td>
                  <td className={td}>
                    <div>{e.email}</div>
                    <div className="text-muted">{e.phone ?? "No phone"}</div>
                  </td>
                  <td className={td}>
                    <a href={profileUrl(e.slug)} target="_blank" rel="noreferrer" className="text-flame underline">
                      /{e.slug}
                    </a>
                  </td>
                  <td className={td}>{e.town ?? "—"}</td>
                  <td className={td}>{e.businessType ? (BUSINESS_TYPE[e.businessType] ?? e.businessType) : "—"}</td>
                  <td className={td}>
                    <div className={`font-semibold ${gs.cls}`}>{gs.label}</div>
                    {e.gasSafeNo && <div className="font-mono text-xs text-muted">{e.gasSafeNo}</div>}
                  </td>
                  <td className={td}>{stripeState(e)}</td>
                  <td className={`${td} text-right tabular-nums`}>{liveBy.get(e.id) ?? 0}</td>
                  <td className={`${td} text-right tabular-nums`}>{customersBy.get(e.id) ?? 0}</td>
                  <td className={td}>{e.createdAt.toLocaleDateString("en-GB", { timeZone: "Europe/London" })}</td>
                  <td className={td}>
                    {e.ownerId ? (
                      <span>
                        Staff
                        <span className="block text-xs text-muted">
                          of {e.owner?.tradingName || e.owner?.legalName || "owner"}
                        </span>
                      </span>
                    ) : (
                      "Owner"
                    )}
                  </td>
                </tr>
              );
            })}
            {engineers.length === 0 && (
              <tr>
                <td className={td} colSpan={12}>
                  No engineers found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
