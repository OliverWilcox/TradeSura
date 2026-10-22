import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import { appUrl } from "@/lib/app-url";
import { sendSms } from "@/lib/sms";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/email-layout";
import { track } from "@/lib/track";
import { postcodeArea, postcodeDistrict } from "@/lib/retention";

// Retention spec, section 9 — "Installer leaves: offer the customer a nearby
// TradeSura engineer; the plan only moves with the customer's agreement."
// Nothing moves automatically: each customer gets a text and email with a
// page of engineers near them (portal/{token}/nearby), and joins one with a
// fresh signup if they choose to.

export type NearbyEngineer = { id: string; name: string; town: string | null; slug: string };

// Engineers who can take on plans near this home: same town as the leaving
// engineer, or the same postcode area as the customer. Closest district
// first. Deliberately simple — a radius search can come later.
export async function nearbyEngineers(opts: {
  excludeEngineerId: string;
  townSlug: string | null;
  postcode: string | null;
  limit?: number;
}): Promise<NearbyEngineer[]> {
  const area = postcodeArea(opts.postcode);
  const district = postcodeDistrict(opts.postcode);
  if (!area && !opts.townSlug) return [];
  const rows = await prisma.engineer.findMany({
    where: {
      id: { not: opts.excludeEngineerId },
      ownerId: null,
      leftAt: null,
      deletedAt: null,
      bannedAt: null,
      gasSafeVerifiedAt: { not: null },
      tiers: { some: { status: "LIVE" } },
      OR: [
        ...(opts.townSlug ? [{ townSlug: opts.townSlug }] : []),
        ...(area ? [{ postcode: { startsWith: area, mode: "insensitive" as const } }] : []),
      ],
    },
    select: { id: true, tradingName: true, legalName: true, slug: true, town: true, townSlug: true, postcode: true },
    take: 50,
  });
  return rows
    .filter((e) => (opts.townSlug && e.townSlug === opts.townSlug) || (area && postcodeArea(e.postcode) === area))
    .sort((a, b) => Number(postcodeDistrict(b.postcode) === district) - Number(postcodeDistrict(a.postcode) === district))
    .slice(0, opts.limit ?? 5)
    .map((e) => ({ id: e.id, name: brandName(e), town: e.town, slug: e.slug }));
}

// Called when Engineer.leftAt is set (admin) and before an account with
// customers still on a plan is deleted. Covers every customer still on a
// live plan, including one running out its paid month.
export async function offerNearbyEngineers(engineerId: string): Promise<{ offered: number }> {
  const engineer = await prisma.engineer.findUniqueOrThrow({ where: { id: engineerId } });
  const brand = brandName(engineer);
  // No more welcome or win-back texts in the name of someone who's gone.
  await prisma.outboundSms.updateMany({
    where: {
      engineerId,
      status: "QUEUED",
      OR: [{ cancelKey: { startsWith: "winback:" } }, { cancelKey: { startsWith: "welcome:" } }],
    },
    data: { status: "CANCELLED" },
  });
  const plans = await prisma.plan.findMany({
    where: { engineerId, status: { in: ["ACTIVE", "PAUSED"] } },
    include: { customer: { include: { properties: true } } },
  });
  let offered = 0;
  for (const plan of plans) {
    const postcode = plan.customer.properties[0]?.postcode ?? null;
    const nearby = await nearbyEngineers({ excludeEngineerId: engineerId, townSlug: engineer.townSlug, postcode });
    const link = `${appUrl()}/portal/${plan.portalToken}/nearby`;
    const offer = nearby.length
      ? `There are TradeSura engineers near you who can look after your boiler instead. Have a look and choose one if you'd like: ${link}`
      : `We'll let you know when another TradeSura engineer covers your area. Your options: ${link}`;
    await sendSms({
      engineerId,
      to: plan.customer.phone,
      body: `Hi ${plan.customer.firstName}, ${brand} is no longer offering care plans through TradeSura. ${offer}`,
      messageClass: "TRANSACTIONAL",
      consentBasis: "plan-member-transactional",
      cancelKey: `leaves:${plan.id}`,
    });
    if (plan.customer.email) {
      await sendEmail({
        to: plan.customer.email,
        subject: `${brand} is leaving TradeSura: your care plan options`,
        html: `<p>Hi ${escapeHtml(plan.customer.firstName)},</p>
<p>${escapeHtml(brand)} is no longer offering care plans through TradeSura.</p>
<p>${nearby.length ? "Other TradeSura engineers near you can look after your boiler instead." : "We don't have another engineer in your area just yet."}
Nothing changes unless you choose: if you'd like to move, you sign up with the engineer you pick.</p>
<p><a href="${link}"><b>See your options</b></a></p>`,
      }).catch((err) => console.error("[installer-leaves] email failed:", err));
    }
    offered++;
  }
  await track("installer_left_customers_offered", { type: "SYSTEM" }, { engineerId, offered });
  return { offered };
}
