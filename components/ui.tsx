import Link from "next/link";
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
    <div className="flex justify-between items-center gap-2 py-2 border-b border-line-soft last:border-b-0 text-sm">
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

export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 py-24 text-center">
      <h1 className="font-disp text-3xl uppercase tracking-wide">{title}</h1>
      <Pill tone="info">COMING SOON</Pill>
      <p className="text-sm text-muted max-w-[32ch]">
        This part of Planlock arrives in the next release.
      </p>
      <Link href="/" className="text-flame-deep font-semibold text-sm">
        Back to home
      </Link>
    </div>
  );
}
