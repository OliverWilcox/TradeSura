import Link from "next/link";
import type { ReactNode } from "react";
import { EMERGENCY_LINE } from "@/lib/compliance/interlock";

const TABS = [
  { label: "HOME", href: "/" },
  { label: "CUSTOMERS", href: "/customers" },
  { label: "PLANS", href: "/plans" },
  { label: "JOBS", href: "/jobs" },
  { label: "MORE", href: "/more" },
];

export function Brandmark() {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand asset
    <img src="/logo-mark.svg" alt="TradeSura" className="h-8 w-auto rounded-md" />
  );
}

// Engineer surface: mobile-first shell with bottom tab bar.
export function AppShell({
  children,
  active,
  topRight,
}: {
  children: ReactNode;
  active?: string;
  topRight?: ReactNode;
}) {
  return (
    <div className="flex-1 flex flex-col max-w-md w-full mx-auto min-h-screen bg-panel">
      <div className="flex justify-between items-center px-4 py-3 bg-black">
        <Brandmark />
        {topRight}
      </div>
      <main className="flex-1 flex flex-col gap-3.5 px-4 pt-4 pb-28">{children}</main>
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md flex border-t border-line bg-paper">
        {TABS.map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className={`flex-1 text-center py-4 font-mono text-[11px] tracking-wide relative ${
              active === t.label
                ? "text-flame-deep font-semibold before:content-[''] before:absolute before:-top-px before:left-[20%] before:right-[20%] before:h-[3px] before:bg-flame before:rounded-b"
                : "text-faint"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

// Customer surface: white-label pages wearing the engineer's brand.
// Emergency line sits permanently in the footer (spec Screen 10).
export function CustomerShell({
  children,
  tradingName,
  sub,
}: {
  children: ReactNode;
  tradingName: string;
  sub?: ReactNode;
}) {
  return (
    <div className="flex-1 flex flex-col max-w-md w-full mx-auto min-h-screen bg-panel">
      <header className="bg-paper px-4 pt-4 pb-2.5 border-b border-line-soft">
        <div className="font-disp text-xl font-bold uppercase tracking-wide">
          {tradingName} <span className="text-flame">Care Plans</span>
        </div>
        {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
      </header>
      <main className="flex-1 flex flex-col gap-3.5 px-4 py-4">{children}</main>
      <footer className="font-mono text-[10px] text-faint text-center px-4 py-3 space-y-1">
        <p>
          Smell gas? Call the National Gas Emergency line free:{" "}
          <a href="tel:0800111999" className="font-semibold text-ink">
            {EMERGENCY_LINE}
          </a>
        </p>
        <p>powered by TradeSura</p>
      </footer>
    </div>
  );
}

export function GasSafeBadge({ regNo }: { regNo: string }) {
  return (
    <span className="inline-flex gap-1.5 items-center bg-[#FFF6D6] border border-[#EBD98F] text-[#7A5E00] text-[10.5px] font-semibold px-2 py-0.5 rounded-md">
      ▲ GAS SAFE VERIFIED {regNo}
    </span>
  );
}
