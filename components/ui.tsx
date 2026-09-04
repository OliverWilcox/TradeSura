import type { ReactNode } from "react";

// `variant` picks the card treatment from Screen Designs v2: `flat` (default,
// most cards), `raised` (surface-2→surface gradient + shadow, for the
// highlighted item in a list), `hero` (the deep navy gradient reserved for
// money cards and celebration moments).
export function Card({
  children,
  className = "",
  variant = "flat",
}: {
  children: ReactNode;
  className?: string;
  variant?: "flat" | "raised" | "hero";
}) {
  if (variant === "hero") {
    return (
      <div
        className={`rounded-2xl border border-line-strong p-4 ${className}`}
        style={{
          background:
            "linear-gradient(160deg, #1a3a66 0%, #122540 60%, #0f2140 100%)",
          boxShadow: "0 14px 34px rgba(0,0,0,.45)",
        }}
      >
        {children}
      </div>
    );
  }
  if (variant === "raised") {
    return (
      <div
        className={`rounded-2xl border border-line-strong p-4 ${className}`}
        style={{
          background: "linear-gradient(180deg, #193150, #122540)",
          boxShadow: "0 10px 30px rgba(0,0,0,.35)",
        }}
      >
        {children}
      </div>
    );
  }
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

// Status pills always carry text, never colour alone — tinted background +
// matching-hue text, never a solid fill.
const pillStyles = {
  ok: "bg-ok-tint text-ok",
  warn: "bg-warn-tint text-warn",
  info: "bg-flame-tint text-flame",
  off: "bg-line-soft text-faint border border-line",
  danger: "bg-danger-tint text-danger",
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

// v2 rule: primary is white-on-navy (not a filled brand colour) — the
// signature, one per screen. Green is reserved for the customer's "Join" and
// the engineer's WhatsApp share. Disabled is opacity, never a colour swap.
const btnStyles = {
  flame: "bg-white text-on-light",
  copper: "bg-white text-on-light", // legacy alias → primary
  green: "bg-ok text-[#052614]",
  ghost: "bg-transparent text-white border-[1.5px] border-white/55",
  dangerghost: "bg-transparent text-danger border-[1.5px] border-danger",
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
    <span className="font-mono font-semibold text-ok">
      {pounds}
      {suffix}
    </span>
  );
}

// Handover 1.4 — the industry's failure mode is a customer who thinks the plan
// covers breakdowns. Stated plainly wherever the plan is presented.
export function NotIncluded() {
  return (
    <div className="bg-warn-tint border border-warn-tint rounded-xl px-4 py-3">
      <p className="font-mono text-[10px] tracking-[0.1em] uppercase text-warn mb-1">
        What&apos;s not included
      </p>
      <p className="text-xs text-warn leading-relaxed">
        <b>Breakdown repairs.</b> If something breaks, your engineer prioritises you and repair
        work is chargeable at your plan discount. This plan is a maintenance &amp; priority
        agreement, not an insurance policy.
      </p>
    </div>
  );
}
