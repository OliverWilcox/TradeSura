import Link from "next/link";
import { getEngineerId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { activeMonthlyPence } from "@/lib/plans";
import { SeenWelcome } from "@/components/seen-welcome";

// Handover §2 — approved welcome design. First open only; the "Get started"
// CTA and the /signin visit both set the seen-cookie (see app/page.tsx).
const TICKS = [
  "Gas Safe verified members",
  "You're the merchant — money goes to your bank",
  "Signed in about 90 seconds, before you've packed the van",
];

// Illustrative figures for a first-time visitor (approved design). A returning
// signed-in engineer sees their own numbers instead.
const EXAMPLE = { monthly: "£576", yearly: "£6,912", plans: 48, newThisMonth: 6 };

export default async function WelcomePage() {
  const engineerId = await getEngineerId();
  let real: { monthly: string; yearly: string; plans: number; newThisMonth: number } | null = null;

  if (engineerId) {
    const { totalPence, count } = await activeMonthlyPence(engineerId);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const newThisMonth = await prisma.plan.count({
      where: { engineerId, status: "ACTIVE", activatedAt: { gte: monthStart } },
    });
    real = {
      monthly: `£${(totalPence / 100).toFixed(0)}`,
      yearly: `£${((totalPence * 12) / 100).toLocaleString("en-GB")}`,
      plans: count,
      newThisMonth,
    };
  }
  const figures = real ?? EXAMPLE;

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-night text-night-text">
      <SeenWelcome />
      <div className="flex-1 flex flex-col justify-center max-w-md w-full mx-auto px-6 py-10 gap-6">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
        <img src="/logo-mark.svg" alt="TradeSura" className="h-10 w-auto self-start" />

        <div>
          <h1 className="font-disp font-bold text-[44px] leading-[0.95] uppercase tracking-wide">
            Your trade.
            <br />
            On plan.
          </h1>
          <p className="text-sm text-night-muted mt-3 max-w-[34ch]">
            Care plans your customers sign at the end of the job, collected by Direct Debit.
          </p>
        </div>

        <div className="relative">
          <div
            className="absolute -inset-3 rounded-[22px] bg-brand-blue/25 blur-2xl"
            aria-hidden="true"
          />
          <div className="relative bg-night-card border border-[#22303F] rounded-[16px] p-5">
            <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-night-muted">
              Locked-in income
            </p>
            <p className="font-mono text-[38px] font-semibold text-brand-copper leading-none mt-2">
              {figures.monthly}
              <span className="text-base">/mo</span>
            </p>
            <p className="font-mono text-sm text-brand-copper/90 mt-1.5">
              = {figures.yearly} a year
            </p>
            <p className="text-xs text-night-muted mt-2">
              {figures.plans} active plan{figures.plans === 1 ? "" : "s"} · +{figures.newThisMonth}{" "}
              this month
            </p>
          </div>
        </div>

        <ul className="space-y-2.5">
          {TICKS.map((t) => (
            <li key={t} className="flex gap-2.5 items-start text-sm">
              <span className="text-brand-blue-lift font-bold leading-5">✓</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>

        <div className="space-y-3 pt-1">
          <Link
            href="/signin?new=1"
            className="block text-center bg-brand-blue text-white font-semibold rounded-[10px] px-4 py-3.5"
          >
            Get started — it&apos;s free
          </Link>
          <Link
            href="/signin"
            className="block text-center text-sm text-brand-blue-lift font-semibold"
          >
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
