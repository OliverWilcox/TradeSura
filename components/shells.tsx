import type { ReactNode } from "react";
import { EMERGENCY_LINE } from "@/lib/compliance/interlock";

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
    <span className="inline-flex gap-1.5 items-center bg-warn-tint border border-warn-tint text-warn text-[10.5px] font-semibold px-2 py-0.5 rounded-md">
      ▲ GAS SAFE VERIFIED {regNo}
    </span>
  );
}
