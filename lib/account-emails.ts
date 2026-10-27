// Build Review 3 §8 — "Also planned (account emails, no opt-in needed)":
// day 1 payments not set up, day 3 no plan yet, first customer, first
// Friday payout. Account emails about the engineer's own account, so they
// go to everyone (tips and product news stay opt-in). Each is sent once,
// claimed with a timestamp first so a cron re-run or webhook retry can't
// send it twice. The badge-live email goes out when the Gas Safe check is
// approved.
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/app-url";
import { sendEmail } from "@/lib/email";
import { EMAIL, SUPPORT_EMAIL, emailButton, emailShell, escapeHtml } from "@/lib/email-layout";
import { engineerYearlyPence } from "@/lib/engineer-welcome-email";
import { poundsFromPence } from "@/lib/plan-doc";
import { poundsLabel } from "@/lib/billing-interval";

const DAY_MS = 24 * 60 * 60 * 1000;
// Nudges only go to new sign-ups: an older account that never set up
// shouldn't get a "day 1" email weeks later (or on the first deploy).
const NUDGE_WINDOW_DAYS = 14;
const EXAMPLE_PLAN_PENCE = 1200;

type Field = "paymentsNudgeEmailAt" | "noPlanNudgeEmailAt" | "firstCustomerEmailAt" | "firstPayoutEmailAt";

function wholePounds(pence: number): string {
  return `£${Math.floor(pence / 100).toLocaleString("en-GB")}`;
}

function accountEmail(opts: {
  firstName: string | null;
  title: string;
  preheader: string;
  paragraphs: string[];
  button: { to: string; label: string };
}) {
  const open = `${appUrl()}/api/open?to=${opts.button.to}`;
  const body = opts.paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:22px;color:${EMAIL.body};">${p}</p>`)
    .join("");
  const rows = `
  <tr><td style="padding:28px 32px 6px;">
    <div style="font-size:22px;line-height:28px;font-weight:700;color:${EMAIL.ink};padding-bottom:14px;">${escapeHtml(opts.title)}</div>
    <p style="margin:0 0 14px;font-size:15px;line-height:22px;color:${EMAIL.body};">Hi ${escapeHtml(opts.firstName || "there")},</p>
    ${body}
  </td></tr>
  <tr><td style="padding:6px 32px 8px;">${emailButton(open, opts.button.label)}</td></tr>
  <tr><td style="padding:18px 32px 26px;font-size:14px;line-height:21px;color:${EMAIL.body};">
    Any questions, just reply to this email or write to <a href="mailto:${SUPPORT_EMAIL}" style="color:${EMAIL.link};">${SUPPORT_EMAIL}</a>.<br><br>
    The TradeSura team
  </td></tr>`;
  const footerExtra = `You're receiving this because you have a TradeSura account. <a href="${appUrl()}/privacy" style="color:${EMAIL.muted};">Privacy policy</a><br>`;
  return {
    subject: opts.title,
    html: emailShell({ title: opts.title, preheader: opts.preheader, rows, footerExtra }),
  };
}

const money = (s: string) => `<b style="color:${EMAIL.money};">${s}</b>`;

export function paymentsNudgeEmail(firstName: string | null) {
  // The engineer's 80% (our 20% rounds down in their favour).
  const keep = engineerYearlyPence(EXAMPLE_PLAN_PENCE) / 12;
  return accountEmail({
    firstName,
    title: "Set up payments to start taking customers",
    preheader: "About 3 minutes with Stripe. We've filled in what we already know.",
    paragraphs: [
      "Customers can only join your plans once payments are set up. It takes about 3 minutes with Stripe, and we've already filled in your business details.",
      `You keep 80% of every plan, ${money(poundsFromPence(keep))} a month on a ${poundsLabel(EXAMPLE_PLAN_PENCE)} plan, paid into your bank every Friday.`,
    ],
    button: { to: "get-paid", label: "Set up payments" },
  });
}

export function noPlanNudgeEmail(firstName: string | null) {
  return accountEmail({
    firstName,
    title: "Build your first plan in about 2 minutes",
    preheader: "Start from Boiler Care and set your own price.",
    paragraphs: [
      `Start from Boiler Care at ${poundsLabel(EXAMPLE_PLAN_PENCE)} a month, change anything you like and set your own price. Each customer on it is worth ${money(`${wholePounds(engineerYearlyPence(EXAMPLE_PLAN_PENCE))} a year`)} to you.`,
      "Your plan is saved as you go, so you can finish it later.",
    ],
    button: { to: "plan-wizard", label: "Build my plan" },
  });
}

export function firstCustomerEmail(firstName: string | null, customerName: string, planName: string, yearlyPence: number) {
  return accountEmail({
    firstName,
    title: "Your first customer has joined",
    preheader: `${customerName} joined ${planName}.`,
    paragraphs: [
      `${escapeHtml(customerName)} has joined ${escapeHtml(planName)}. That's ${money(`${wholePounds(yearlyPence)} a year`)} to you.`,
      "Their Direct Debit is set up. The first payment is taken after their 14-day cooling-off period, and we'll remind them when their annual service is due.",
    ],
    button: { to: "customers", label: "See your customers" },
  });
}

export function firstPayoutEmail(firstName: string | null, amountPence: number) {
  return accountEmail({
    firstName,
    title: "Your first payout has landed",
    preheader: `${poundsFromPence(amountPence)} is on its way to your bank.`,
    paragraphs: [
      `Your first TradeSura payout of ${money(poundsFromPence(amountPence))} has been paid to your bank. It can take a few hours to show.`,
      "From now on you're paid every Friday. Every payment, fee and payout is in the Payouts tab.",
    ],
    button: { to: "payouts", label: "See payouts" },
  });
}

async function claim(engineerId: string, field: Field): Promise<boolean> {
  const res = await prisma.engineer.updateMany({
    where: { id: engineerId, [field]: null },
    data: { [field]: new Date() },
  });
  return res.count === 1;
}

async function sendClaimed(
  engineer: { id: string; email: string | null },
  field: Field,
  email: { subject: string; html: string },
): Promise<boolean> {
  if (!engineer.email || !(await claim(engineer.id, field))) return false;
  try {
    await sendEmail({ to: engineer.email, subject: email.subject, html: email.html, replyTo: SUPPORT_EMAIL });
    return true;
  } catch (err) {
    // Release the claim so tomorrow's run tries again.
    await prisma.engineer.update({ where: { id: engineer.id }, data: { [field]: null } }).catch(() => {});
    console.error(`[account-emails] ${field} failed:`, err);
    return false;
  }
}

// Daily cron (app/api/jobs/flush-sms): business owners only, never staff,
// deleted, banned or paused accounts.
export async function sendSetupNudges(now = new Date()): Promise<{ payments: number; noPlan: number }> {
  const oldest = new Date(now.getTime() - NUDGE_WINDOW_DAYS * DAY_MS);
  const base = { ownerId: null, deletedAt: null, bannedAt: null, pausedAt: null };
  const select = { id: true, email: true, firstName: true } as const;

  const unpaid = await prisma.engineer.findMany({
    where: {
      ...base,
      createdAt: { gte: oldest, lte: new Date(now.getTime() - DAY_MS) },
      stripeChargesEnabled: false,
      paymentsNudgeEmailAt: null,
    },
    select,
  });
  let payments = 0;
  for (const e of unpaid) if (await sendClaimed(e, "paymentsNudgeEmailAt", paymentsNudgeEmail(e.firstName))) payments++;

  const noPlanYet = await prisma.engineer.findMany({
    where: {
      ...base,
      createdAt: { gte: oldest, lte: new Date(now.getTime() - 3 * DAY_MS) },
      noPlanNudgeEmailAt: null,
      tiers: { none: { status: "LIVE" } },
    },
    select,
  });
  let noPlan = 0;
  for (const e of noPlanYet) if (await sendClaimed(e, "noPlanNudgeEmailAt", noPlanNudgeEmail(e.firstName))) noPlan++;

  return { payments, noPlan };
}

export async function sendFirstCustomerEmail(
  engineerId: string,
  customerName: string,
  planName: string,
  yearlyPence: number,
): Promise<void> {
  const e = await prisma.engineer.findUnique({ where: { id: engineerId }, select: { id: true, email: true, firstName: true } });
  if (!e) return;
  await sendClaimed(e, "firstCustomerEmailAt", firstCustomerEmail(e.firstName, customerName, planName, yearlyPence));
}

export async function sendFirstPayoutEmail(engineerId: string, amountPence: number): Promise<void> {
  const e = await prisma.engineer.findUnique({ where: { id: engineerId }, select: { id: true, email: true, firstName: true } });
  if (!e) return;
  await sendClaimed(e, "firstPayoutEmailAt", firstPayoutEmail(e.firstName, amountPence));
}
