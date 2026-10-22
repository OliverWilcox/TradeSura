import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { brandName } from "@/lib/engineer";
import { adminAuthorised } from "@/lib/admin-auth";
import { removeRating, settingInt, NEW_MEMBER_THRESHOLD_KEY } from "@/lib/ratings";
import { reasonLabel } from "@/lib/retention";
import { offerNearbyEngineers } from "@/lib/installer-leaves";
import { websiteSalesByEngineer } from "@/lib/website-sales";
import { startOfMonth } from "@/lib/enquiries";
import { LISTED_ENGINEER_WHERE, markTownPublished } from "@/lib/town";
import {
  CANCEL_RATE_FLAG_KEY,
  DEFAULT_CANCEL_RATE_FLAG,
  DEFAULT_STICKER_LOW_STOCK,
  EDITABLE_SETTINGS,
  STICKER_LOW_STOCK_KEY,
  cancelRatePercent,
  installerFlags,
  isKept,
  parseSettingValue,
  qualityLabel,
  rescueSummary,
  topReason,
} from "@/lib/admin-metrics";

export const dynamic = "force-dynamic";

// Section 10 (for Mohammed) — which installers keep customers and which lose
// them, so we can step in early. Gated by ADMIN_SECRET like the verification
// queue: open /admin/retention?key=…
const PATH = "/admin/retention";
const DAY = 24 * 60 * 60 * 1000;

function keyOf(fd: FormData): string | null {
  const key = String(fd.get("key") ?? "");
  return adminAuthorised(key) ? key : null;
}

async function setWidget(fd: FormData) {
  "use server";
  if (!keyOf(fd)) return;
  const engineerId = String(fd.get("engineerId"));
  const off = fd.get("action") === "off";
  await prisma.engineer.update({ where: { id: engineerId }, data: { widgetDisabledAt: off ? new Date() : null } });
  await track(off ? "widget_disabled" : "widget_enabled", { type: "SYSTEM" }, { engineerId, by: "admin" });
  revalidatePath(PATH);
}

async function setTown(fd: FormData) {
  "use server";
  if (!keyOf(fd)) return;
  const slug = String(fd.get("slug"));
  const hold = fd.get("action") === "hold";
  const page = await prisma.townPage.findUnique({ where: { slug } });
  if (!page) return;
  await prisma.townPage.update({ where: { slug }, data: { heldAt: hold ? new Date() : null } });
  if (!hold && (await prisma.engineer.count({ where: { townSlug: slug, ...LISTED_ENGINEER_WHERE } })) > 0) {
    await markTownPublished(slug, page.name);
  }
  await track(hold ? "town_page_held" : "town_page_released", { type: "SYSTEM" }, { slug });
  revalidatePath(PATH);
}

async function saveSettings(fd: FormData) {
  "use server";
  if (!keyOf(fd)) return;
  for (const s of EDITABLE_SETTINGS) {
    const value = parseSettingValue(String(fd.get(s.key) ?? ""));
    if (value === null) continue;
    await prisma.appSetting.upsert({ where: { key: s.key }, update: { value }, create: { key: s.key, value } });
  }
  await track("app_settings_saved", { type: "SYSTEM" }, {});
  revalidatePath(PATH);
}

async function removeRatingAction(fd: FormData) {
  "use server";
  if (!keyOf(fd)) return;
  const result = await removeRating(String(fd.get("ratingId")), String(fd.get("reason") ?? ""), "admin");
  if (!result.ok) console.error("[admin] remove rating:", result.error);
  revalidatePath(PATH);
}

async function installerLeft(fd: FormData) {
  "use server";
  if (!keyOf(fd)) return;
  if (fd.get("confirm") !== "yes") return;
  const engineerId = String(fd.get("engineerId") ?? "");
  const e = await prisma.engineer.findUnique({ where: { id: engineerId }, select: { leftAt: true } });
  if (!e || e.leftAt) return;
  await prisma.engineer.update({ where: { id: engineerId }, data: { leftAt: new Date() } });
  const { offered } = await offerNearbyEngineers(engineerId);
  await track("installer_left", { type: "SYSTEM" }, { engineerId, customersOffered: offered });
  revalidatePath(PATH);
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY);
}

type Meta = { planId?: string; engineerId?: string; left?: number } | null;
const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}%`);
const th = "text-left font-mono text-[10px] uppercase tracking-[0.08em] text-faint px-2 py-1.5";
const td = "px-2 py-1.5 border-t border-line-soft align-top";
const btn = "rounded-lg border border-line-strong px-2.5 py-1 text-xs font-semibold";

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-line bg-paper p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-faint">{label}</div>
      <div className="mt-1 text-3xl font-bold">{value}</div>
    </div>
  );
}

export default async function Retention({ searchParams }: { searchParams: Promise<{ key?: string }> }) {
  const { key } = await searchParams;
  if (!adminAuthorised(key)) return <main className="p-8 text-sm text-muted">Not found.</main>;

  const since = daysAgo(30);
  const month = startOfMonth();

  const [
    requests,
    payEvents,
    enquiryRows,
    engineers,
    livePlans,
    ratingAgg,
    lowAgg,
    stickersLeft,
    stickersAll,
    lowRatings,
    towns,
    listedByTown,
    topups,
    settings,
    websiteSales,
  ] = await Promise.all([
    prisma.cancelRequest.findMany({
      where: { createdAt: { gte: since } },
      select: { engineerId: true, reason: true, outcome: true, createdAt: true },
    }),
    prisma.event.findMany({
      where: { name: { in: ["payment_failed", "payment_rescued", "payment_lost"] }, ts: { gte: since } },
      select: { id: true, name: true, meta: true },
    }),
    prisma.enquiry.groupBy({ by: ["engineerId", "kind"], where: { createdAt: { gte: since } }, _count: true }),
    prisma.engineer.findMany({
      where: { ownerId: null, deletedAt: null, OR: [{ gasSafeVerifiedAt: { not: null } }, { plans: { some: {} } }] },
      select: {
        id: true,
        slug: true,
        tradingName: true,
        legalName: true,
        town: true,
        websiteConnectedAt: true,
        websiteHost: true,
        widgetDisabledAt: true,
        leftAt: true,
      },
    }),
    prisma.plan.groupBy({ by: ["engineerId"], where: { status: { in: ["ACTIVE", "PAUSED"] } }, _count: true }),
    prisma.rating.groupBy({
      by: ["engineerId"],
      where: { ratedAt: { not: null }, removedAt: null, stars: { not: null } },
      _avg: { stars: true },
      _count: true,
    }),
    prisma.rating.groupBy({
      by: ["engineerId"],
      where: { ratedAt: { not: null }, removedAt: null, stars: { lte: 2 } },
      _count: true,
    }),
    prisma.sticker.groupBy({ by: ["engineerId"], where: { engineerId: { not: null }, passportId: null }, _count: true }),
    prisma.sticker.groupBy({ by: ["engineerId"], where: { engineerId: { not: null } }, _count: true }),
    prisma.rating.findMany({
      where: { ratedAt: { not: null }, stars: { lte: 2 } },
      orderBy: { ratedAt: "desc" },
      take: 50,
      include: { engineer: { select: { tradingName: true, legalName: true, slug: true } } },
    }),
    prisma.townPage.findMany({ orderBy: { name: "asc" } }),
    prisma.engineer.groupBy({ by: ["townSlug"], where: { townSlug: { not: null }, ...LISTED_ENGINEER_WHERE }, _count: true }),
    prisma.event.findMany({
      where: { name: "sticker_topup_requested", ts: { gte: since } },
      orderBy: { ts: "desc" },
      select: { id: true, ts: true, meta: true },
    }),
    Promise.all([
      settingInt(CANCEL_RATE_FLAG_KEY, DEFAULT_CANCEL_RATE_FLAG),
      settingInt(STICKER_LOW_STOCK_KEY, DEFAULT_STICKER_LOW_STOCK),
      settingInt(NEW_MEMBER_THRESHOLD_KEY, 3),
      prisma.appSetting.findMany(),
    ]),
    websiteSalesByEngineer(month),
  ]);
  const [cancelThreshold, stickerThreshold, newThreshold, settingRows] = settings;
  const settingValue = new Map(settingRows.map((r) => [r.key, r.value]));

  // ---- tiles ----
  const kept = requests.filter((r) => isKept(r.outcome)).length;
  const planOf = (e: { id: string; meta: unknown }) => (e.meta as Meta)?.planId ?? e.id;
  const rescue = rescueSummary(
    payEvents.filter((e) => e.name === "payment_failed").map(planOf),
    payEvents.filter((e) => e.name === "payment_rescued").map(planOf),
    payEvents.filter((e) => e.name === "payment_lost").map(planOf),
  );
  const enquiryTotal = enquiryRows.reduce((n, r) => n + r._count, 0);

  // ---- per installer ----
  const count = <T extends { engineerId: string | null; _count: number }>(rows: T[]) =>
    new Map(rows.map((r) => [r.engineerId ?? "", r._count]));
  const liveBy = count(livePlans);
  const lowBy = count(lowAgg);
  const leftBy = count(stickersLeft);
  const allocBy = count(stickersAll);
  const ratingBy = new Map(ratingAgg.map((r) => [r.engineerId, { avg: r._avg.stars, n: r._count }]));
  const enquiryBy = new Map<string, { call: number; message: number }>();
  for (const r of enquiryRows) {
    const e = enquiryBy.get(r.engineerId) ?? { call: 0, message: 0 };
    if (r.kind === "call") e.call += r._count;
    else e.message += r._count;
    enquiryBy.set(r.engineerId, e);
  }
  const requestsBy = new Map<string, typeof requests>();
  for (const r of requests) requestsBy.set(r.engineerId, [...(requestsBy.get(r.engineerId) ?? []), r]);

  const rows = engineers
    .map((e) => {
      const reqs = requestsBy.get(e.id) ?? [];
      const live = liveBy.get(e.id) ?? 0;
      const cancelled = reqs.filter((r) => r.outcome === "cancelled").length;
      const cancelRate = cancelRatePercent(cancelled, live);
      const rating = ratingBy.get(e.id);
      const average = rating?.avg == null ? null : Math.round(rating.avg * 10) / 10;
      const ratingCount = rating?.n ?? 0;
      const low = lowBy.get(e.id) ?? 0;
      const stickers = leftBy.get(e.id) ?? 0;
      const flags = installerFlags({
        cancelRate,
        stickersLeft: stickers,
        cancelThreshold,
        stickerThreshold,
        stickersAllocated: allocBy.get(e.id) ?? 0,
      });
      const enq = enquiryBy.get(e.id) ?? { call: 0, message: 0 };
      return {
        ...e,
        name: brandName(e),
        live,
        requests: reqs.length,
        kept: reqs.filter((r) => isKept(r.outcome)).length,
        cancelled,
        cancelRate,
        top: topReason(reqs.map((r) => ({ reason: r.reason, at: r.createdAt }))),
        average,
        ratingCount,
        isNew: ratingCount < newThreshold,
        low,
        enq,
        widgetLive: Boolean(e.websiteConnectedAt) && !e.widgetDisabledAt,
        stickers,
        allocated: allocBy.get(e.id) ?? 0,
        flags,
        quality: qualityLabel({ highCancel: flags.highCancel, average, count: ratingCount, lowRatings: low }),
        websiteSold: websiteSales.get(e.id) ?? 0,
      };
    })
    .sort(
      (a, b) =>
        Number(b.flags.highCancel || b.flags.lowStickers) - Number(a.flags.highCancel || a.flags.lowStickers) ||
        b.live - a.live,
    );

  // ---- overall cancellation reasons ----
  const reasons = new Map<string, { total: number; saved: number; paused: number; downgraded: number; cancelled: number; pending: number }>();
  for (const r of requests) {
    const x = reasons.get(r.reason) ?? { total: 0, saved: 0, paused: 0, downgraded: 0, cancelled: 0, pending: 0 };
    x.total += 1;
    if (r.outcome in x) x[r.outcome as keyof typeof x] += 1;
    reasons.set(r.reason, x);
  }

  const listedBy = new Map(listedByTown.map((t) => [t.townSlug ?? "", t._count]));
  const nameById = new Map(rows.map((r) => [r.id, r.name]));
  const widgetRows = rows.filter((r) => r.websiteConnectedAt || r.widgetDisabledAt);

  return (
    <main className="mx-auto w-full max-w-6xl p-6 text-sm">
      <h1 className="text-2xl font-bold">Installer retention</h1>
      <p className="mt-1 text-muted">Last 30 days unless marked. A ⚑ flag means it&apos;s worth stepping in early.</p>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Cancel requests (30 days)" value={requests.length} />
        <Tile label="Saved, paused or switched" value={kept} />
        <Tile label="Failed payments rescued" value={`${rescue.rescued} of ${rescue.failed}`} />
        <Tile label="Profile enquiries" value={enquiryTotal} />
      </div>

      <h2 className="mt-10 text-xl font-bold">Installers</h2>
      <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-paper">
        <table className="w-full min-w-[980px]">
          <thead>
            <tr>
              {["Installer", "Live plans", "Cancel rate", "Top reason", "Rating", "Low ratings", "Enquiries", "Widget", "Stickers", "Quality"].map((h) => (
                <th key={h} className={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.leftAt ? "opacity-50" : ""}>
                <td className={td}>
                  <div className="font-semibold">{r.name}</div>
                  <div className="text-xs text-muted">
                    {r.town ?? "no town"}
                    {r.leftAt ? ` · left ${r.leftAt.toLocaleDateString("en-GB")}` : ""}
                  </div>
                </td>
                <td className={td}>{r.live}</td>
                <td className={`${td} ${r.flags.highCancel ? "font-semibold text-danger" : ""}`}>
                  {pct(r.cancelRate)}
                  {r.flags.highCancel && " ⚑"}
                  <div className="text-xs text-muted font-normal">
                    {r.requests} req · {r.kept} kept · {r.cancelled} gone
                  </div>
                </td>
                <td className={td}>{r.top ? reasonLabel(r.top) : "—"}</td>
                <td className={td}>
                  {r.isNew || r.average === null ? "New" : `${r.average.toFixed(1)} (${r.ratingCount})`}
                </td>
                <td className={`${td} ${r.low > 0 ? "text-warn font-semibold" : ""}`}>{r.low}</td>
                <td className={td}>
                  {r.enq.call + r.enq.message}
                  <div className="text-xs text-muted">
                    {r.enq.call} calls · {r.enq.message} msgs
                  </div>
                </td>
                <td className={td}>{r.widgetLive ? "LIVE" : "—"}</td>
                <td className={`${td} ${r.flags.lowStickers ? "font-semibold text-danger" : ""}`}>
                  {r.allocated ? r.stickers : "—"}
                  {r.flags.lowStickers && " ⚑"}
                </td>
                <td className={td}>{r.quality}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">
        ⚑ Flagged: cancel rate above {cancelThreshold}% · sticker stock at or below {stickerThreshold}. Cancel rate =
        cancelled ÷ (live + cancelled) over 30 days.
      </p>

      <h2 className="mt-10 text-xl font-bold">Cancellations by reason</h2>
      <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-paper">
        <table className="w-full">
          <thead>
            <tr>
              {["Reason", "Requests", "Saved", "Paused", "Switched", "Cancelled", "Pending"].map((h) => (
                <th key={h} className={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...reasons.entries()].sort((a, b) => b[1].total - a[1].total).map(([reason, x]) => (
              <tr key={reason}>
                <td className={td}>{reasonLabel(reason)}</td>
                <td className={td}>{x.total}</td>
                <td className={td}>{x.saved}</td>
                <td className={td}>{x.paused}</td>
                <td className={td}>{x.downgraded}</td>
                <td className={td}>{x.cancelled}</td>
                <td className={td}>{x.pending}</td>
              </tr>
            ))}
            {reasons.size === 0 && (
              <tr><td className={td} colSpan={7}>No cancel requests in the last 30 days.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">
        Failed payments: {rescue.rescued} rescued, {rescue.lost} lost, {rescue.failed - rescue.rescued - rescue.lost} still
        in rescue.
      </p>

      <h2 className="mt-10 text-xl font-bold">1 and 2 star ratings</h2>
      <p className="mt-1 text-muted">
        Every rating stays up. Remove only for clear abuse (threats, personal data, not about the service), with
        the reason — it&apos;s logged.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {lowRatings.map((r) => (
          <li key={r.id} className="rounded-xl border border-line bg-paper p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <b>{r.stars}★</b> · {brandName(r.engineer)} · {r.customerName ?? "customer"} ·{" "}
                {r.ratedAt?.toLocaleDateString("en-GB")}
              </div>
              <div className="text-xs">
                {r.removedAt ? (
                  <span className="text-danger">Removed: {r.removedReason}</span>
                ) : r.reply ? (
                  <span className="text-ok">Replied</span>
                ) : (
                  <span className="text-warn">No reply yet</span>
                )}
              </div>
            </div>
            {r.comment && <p className="mt-1 text-muted">&ldquo;{r.comment}&rdquo;</p>}
            {r.reply && <p className="mt-1 text-xs text-muted">Reply: {r.reply}</p>}
            {!r.removedAt && (
              <form action={removeRatingAction} className="mt-2 flex flex-wrap gap-2">
                <input type="hidden" name="key" value={key} />
                <input type="hidden" name="ratingId" value={r.id} />
                <input
                  name="reason"
                  required
                  minLength={5}
                  placeholder="Reason for removing (abuse only)"
                  className="min-w-56 flex-1 rounded-lg border border-line bg-transparent px-2.5 py-1 text-xs"
                />
                <button className={`${btn} border-danger text-danger`}>Remove for abuse</button>
              </form>
            )}
          </li>
        ))}
        {lowRatings.length === 0 && <li className="text-muted">None.</li>}
      </ul>

      <h2 className="mt-10 text-xl font-bold">Website widgets</h2>
      <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-paper">
        <table className="w-full">
          <thead>
            <tr>
              {["Installer", "Site", "Status", "Website sign-ups this month", ""].map((h) => (
                <th key={h} className={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {widgetRows.map((r) => (
              <tr key={r.id}>
                <td className={td}>{r.name}</td>
                <td className={td}>{r.websiteHost ?? "—"}</td>
                <td className={td}>{r.widgetDisabledAt ? "Switched off" : r.widgetLive ? "LIVE" : "—"}</td>
                <td className={td}>{r.websiteSold}</td>
                <td className={td}>
                  <form action={setWidget}>
                    <input type="hidden" name="key" value={key} />
                    <input type="hidden" name="engineerId" value={r.id} />
                    <button name="action" value={r.widgetDisabledAt ? "on" : "off"} className={btn}>
                      {r.widgetDisabledAt ? "Switch on" : "Switch off"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {widgetRows.length === 0 && (
              <tr><td className={td} colSpan={5}>No widgets seen on a website yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 text-xl font-bold">Town pages</h2>
      <p className="mt-1 text-muted">
        A town goes live by itself once it has a verified engineer with a published profile and a live plan.
        Hold one to keep it off Google (e.g. until its regional letter campaign).
      </p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-paper">
        <table className="w-full">
          <thead>
            <tr>
              {["Town", "Listed engineers", "Status", "First published", ""].map((h) => (
                <th key={h} className={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {towns.map((t) => {
              const listed = listedBy.get(t.slug) ?? 0;
              const status = t.heldAt ? "Held" : listed > 0 ? "Live" : "Waiting for an engineer";
              return (
                <tr key={t.slug}>
                  <td className={td}>
                    <a href={`/gas-engineers/${t.slug}`} className="text-flame underline" target="_blank" rel="noreferrer">
                      {t.name}
                    </a>
                  </td>
                  <td className={td}>{listed}</td>
                  <td className={td}>{status}</td>
                  <td className={td}>{t.publishedAt?.toLocaleDateString("en-GB") ?? "—"}</td>
                  <td className={td}>
                    <form action={setTown}>
                      <input type="hidden" name="key" value={key} />
                      <input type="hidden" name="slug" value={t.slug} />
                      <button name="action" value={t.heldAt ? "publish" : "hold"} className={btn}>
                        {t.heldAt ? "Publish" : "Hold"}
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {towns.length === 0 && (
              <tr><td className={td} colSpan={5}>No towns yet — they appear as installers publish profiles.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 text-xl font-bold">Stickers</h2>
      <p className="mt-1 text-muted">Stock left is in the installer table. Top-up requests, last 30 days:</p>
      <ul className="mt-2 flex flex-col gap-1">
        {topups.map((t) => {
          const m = t.meta as Meta;
          return (
            <li key={t.id}>
              {t.ts.toLocaleDateString("en-GB")} · {nameById.get(m?.engineerId ?? "") ?? m?.engineerId ?? "unknown"} ·{" "}
              {m?.left ?? "?"} left
            </li>
          );
        })}
        {topups.length === 0 && <li className="text-muted">None.</li>}
      </ul>

      <h2 className="mt-10 text-xl font-bold">Settings</h2>
      <form action={saveSettings} className="mt-3 flex flex-col gap-2 rounded-xl border border-line bg-paper p-4">
        <input type="hidden" name="key" value={key} />
        {EDITABLE_SETTINGS.map((s) => (
          <label key={s.key} className="flex items-center justify-between gap-3">
            <span>{s.label}</span>
            <input
              name={s.key}
              defaultValue={settingValue.get(s.key) ?? String(s.fallback)}
              inputMode="numeric"
              pattern="\d{1,4}"
              className="w-24 rounded-lg border border-line bg-transparent px-2.5 py-1 text-right"
            />
          </label>
        ))}
        <button className="mt-2 self-start rounded-lg bg-white px-4 py-2 font-semibold text-[#0f2140]">Save settings</button>
      </form>

      <h2 className="mt-10 text-xl font-bold">Installer left</h2>
      <p className="mt-1 text-muted">
        Marks the installer as left, takes their profile and widget down, and offers each of their plan customers a
        nearby TradeSura engineer. Plans only move with the customer&apos;s agreement.
      </p>
      <form action={installerLeft} className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-paper p-4">
        <input type="hidden" name="key" value={key} />
        <select name="engineerId" required className="rounded-lg border border-line bg-transparent px-2.5 py-1.5">
          <option value="">Choose installer…</option>
          {rows.filter((r) => !r.leftAt).map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} ({r.live} live plans)
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" name="confirm" value="yes" required /> They have left TradeSura
        </label>
        <button className={`${btn} border-danger text-danger`}>Mark as left</button>
      </form>
    </main>
  );
}
