import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-paper border border-line rounded-xl p-4 ${className}`}>
      {children}
    </div>
  );
}

export function Micro({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`font-mono text-[10px] tracking-[0.1em] uppercase text-faint ${className}`}>
      {children}
    </p>
  );
}

const pillStyles = {
  ok: "bg-ok-tint text-ok",
  warn: "bg-warn-tint text-[#9A6C0C]",
  info: "bg-flame-tint text-flame-deep",
  off: "bg-panel text-faint border border-line",
  danger: "bg-danger text-white",
} as const;

export function Pill({
  tone,
  children,
}: {
  tone: keyof typeof pillStyles;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-block font-mono text-[10px] font-semibold px-2.5 py-0.5 rounded-full ${pillStyles[tone]}`}
    >
      {children}
    </span>
  );
}

const btnStyles = {
  flame: "bg-flame text-white",
  copper: "bg-copper text-white",
  ghost: "bg-transparent text-flame-deep border-[1.5px] border-flame",
  dangerghost: "bg-transparent text-danger border-[1.5px] border-danger-tint",
} as const;

export function btnClass(variant: keyof typeof btnStyles = "flame") {
  return `block w-full text-center font-semibold rounded-[10px] px-4 py-3 text-sm disabled:opacity-50 ${btnStyles[variant]}`;
}

export function RowLine({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex justify-between items-center gap-2 py-2.5 border-b border-line-soft last:border-b-0 text-sm">
      <span>{left}</span>
      {right !== undefined && <span>{right}</span>}
    </div>
  );
}

export function Money({ pence, suffix = "" }: { pence: number; suffix?: string }) {
  const pounds = pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`;
  return (
    <span className="font-mono font-semibold">
      {pounds}
      {suffix}
    </span>
  );
}

// Handover 1.4 — the industry's failure mode is a customer who thinks the plan
// covers breakdowns. Stated plainly wherever the plan is presented.
export function NotIncluded() {
  return (
    <div className="bg-warn-tint border border-[#EBD98F] rounded-xl px-4 py-3">
      <p className="font-mono text-[10px] tracking-[0.1em] uppercase text-[#9A6C0C] mb-1">
        What&apos;s not included
      </p>
      <p className="text-xs text-[#7A5E00] leading-relaxed">
        <b>Breakdown repairs.</b> If something breaks, your engineer prioritises you and repair
        work is chargeable at your plan discount. This plan is a maintenance &amp; priority
        agreement, not an insurance policy.
      </p>
    </div>
  );
}
