import { after } from "next/server";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { adminEvent } from "@/lib/admin-api/audit";
import type { AdminPrincipal } from "@/lib/admin-api/token";
import { displayName } from "@/lib/engineer";
import { cardAlertRecipients } from "@/lib/card-alert";
import { emailConfigured, sendEmail } from "@/lib/email";
import { noticeEmail } from "@/lib/admin/notice-email";
import { textStaff } from "@/lib/sms";

export const SAFETY_COMPLAINT_LIMITS = { min: 10, max: 2000 } as const;
const REASON_CHARS = 300;

export type SafetyRecheck = "requested" | "already_due" | "not_checked";

export type SafetyComplaint = {
  engineerId: string;
  customerId: string;
  planId: string | null;
  message: string;
  from: "homeowner" | "admin";
};

export const recheckReasonOf = (message: string) => {
  const text = message.trim().replace(/\s+/g, " ");
  return `Safety complaint from a homeowner: ${text.length > REASON_CHARS ? `${text.slice(0, REASON_CHARS - 1)}…` : text}`;
};

export async function raiseSafetyComplaint(input: SafetyComplaint, admin?: AdminPrincipal): Promise<{ recheck: SafetyRecheck; at: string }> {
  const now = new Date();
  const recheck = await prisma.$transaction(async (tx) => {
    const e = await tx.engineer.findUniqueOrThrow({
      where: { id: input.engineerId },
      select: { gasSafeVerifiedAt: true, gasSafeCardReadId: true, gasSafeRegisterCheckedAt: true, gasSafeRecheckRequestedAt: true },
    });
    let state: SafetyRecheck = "not_checked";
    if (e.gasSafeVerifiedAt && e.gasSafeCardReadId && e.gasSafeRegisterCheckedAt) {
      state = e.gasSafeRecheckRequestedAt ? "already_due" : "requested";
      if (state === "requested") {
        const reason = recheckReasonOf(input.message);
        await tx.engineer.update({ where: { id: input.engineerId }, data: { gasSafeRecheckRequestedAt: now, gasSafeRecheckReason: reason } });
        const meta = { engineerId: input.engineerId, reason, why: "safety_complaint" };
        if (admin) await adminEvent(admin, "gas_safe_recheck_requested", meta, tx);
        else await tx.event.create({ data: { name: "gas_safe_recheck_requested", actorType: "SYSTEM", meta } });
      }
    }
    const meta = { engineerId: input.engineerId, customerId: input.customerId, planId: input.planId, reason: input.message, from: input.from, recheck: state };
    if (admin) await adminEvent(admin, "safety_complaint", meta, tx);
    else await tx.event.create({ data: { name: "safety_complaint", actorType: "CUSTOMER", actorId: input.customerId, meta } });
    return state;
  });
  queueSafetyAlert(input, recheck);
  return { recheck, at: now.toISOString() };
}

const RECHECK_LINE: Record<SafetyRecheck, string> = {
  requested: "Their register re-check is now due and they're on the Re-check due list.",
  already_due: "A register re-check was already due for them.",
  not_checked: "Their register check hasn't passed yet, so it's still to do.",
};

async function alertSafetyComplaint(input: SafetyComplaint, recheck: SafetyRecheck) {
  const { emails, mobiles } = cardAlertRecipients();
  if (!emails.length && !mobiles.length) return;
  const e = await prisma.engineer.findUnique({ where: { id: input.engineerId }, select: { tradingName: true, legalName: true, slug: true } });
  if (!e) return;
  const business = displayName(e);
  const admin = process.env.ADMIN_APP_URL?.replace(/\s+/g, "").replace(/\/$/, "");
  const link = admin ? `${admin}/customers/${input.customerId}` : null;
  const email = noticeEmail({
    firstName: null,
    title: `Safety complaint about ${business}`,
    paragraphs: [
      input.from === "homeowner" ? "A homeowner has raised a safety complaint about their engineer from their plan page." : "A safety complaint from a homeowner has been logged in TradeSura Admin.",
      `What they said: ${input.message}`,
      RECHECK_LINE[recheck],
    ],
    ...(link ? { button: { href: link, label: "Open the customer" } } : {}),
  });
  const sent = { email: 0, sms: 0 };
  for (const to of emails) {
    try {
      await sendEmail({ to, ...email });
      if (emailConfigured()) sent.email++;
    } catch (err) {
      console.error("[safety-complaint] email failed:", err);
    }
  }
  for (const to of mobiles) {
    try {
      if (await textStaff(to, `TradeSura: safety complaint about ${business}.${link ? ` ${link}` : ""}`)) sent.sms++;
    } catch (err) {
      console.error("[safety-complaint] text failed:", err);
    }
  }
  await track("safety_alert_sent", { type: "SYSTEM" }, { engineerId: input.engineerId, customerId: input.customerId, emails: sent.email, texts: sent.sms }).catch(() => {});
}

function queueSafetyAlert(input: SafetyComplaint, recheck: SafetyRecheck) {
  const task = () => alertSafetyComplaint(input, recheck).catch((err) => console.error("[safety-complaint] alert failed:", err));
  try {
    after(task);
  } catch {
    void task();
  }
}
