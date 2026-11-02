"use client";

import { useState } from "react";
import { orderedServiceReasons } from "@/lib/yearly-service";
import type { ValueSum } from "@/lib/value-sum";

// 30 Oct update §7 — the pieces the customer sign-up pages share: the value
// sum, "Why a yearly service matters", the landlord toggle, the Home
// Passport block with its "Send me the details" capture, and "Text me the
// link" on the Direct Debit step.

const CARD = "bg-paper border border-line rounded-xl p-3.5";
const INPUT = "w-full rounded-[10px] border-[1.5px] border-line bg-paper px-3 py-2.5 text-sm";

export function ValueSumLine({ sum }: { sum: ValueSum | null }) {
  if (!sum) return null;
  return (
    <p className="rounded-xl bg-flame-tint px-3.5 py-2.5 text-[14px] text-ink">
      Worth over <b className="text-ok">£{sum.overPounds}</b> a year… just <b className="text-ok">{sum.perWeek}</b> a week.
    </p>
  );
}

export function WhyYearlyService({ order }: { order?: string[] | null }) {
  return (
    <div className={CARD}>
      <h2 className="font-sans font-semibold text-sm mb-1.5">Why a yearly service matters</h2>
      <ul className="space-y-1.5">
        {orderedServiceReasons(order).map((r) => (
          <li key={r.key} className="flex gap-2.5 text-[13px]">
            <span aria-hidden className="text-flame font-bold">✓</span>
            <span>
              <b>{r.title}:</b> <span className="text-muted">{r.line}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LandlordToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-semibold">Are you a landlord?</span>
      <div role="radiogroup" aria-label="Are you a landlord?" className="grid grid-cols-2 gap-1.5">
        {[
          { v: false, label: "No" },
          { v: true, label: "Yes" },
        ].map((o) => (
          <button
            key={o.label}
            type="button"
            role="radio"
            aria-checked={value === o.v}
            onClick={() => onChange(o.v)}
            className={`rounded-full border-[1.5px] px-4 py-1.5 text-sm ${
              value === o.v ? "border-[#1F5FC4] bg-paper font-semibold" : "border-line bg-paper opacity-80"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * §7.7 — Home Passport, "Cover your parents' boiler" and local proof (only
 * once it's real), then the small "Send me the details" capture for a
 * customer who's thinking about it: name, mobile and consent, then the link
 * again at 2 and 7 days.
 */
export function HomePassportBlock({
  brand,
  localProof,
  detailsUrl,
  tierId,
  disabled,
}: {
  brand: string;
  localProof?: string | null;
  /** POST endpoint for the capture; absent where the customer is already known. */
  detailsUrl?: string;
  tierId?: string;
  disabled?: boolean;
}) {
  return (
    <div className={CARD}>
      <h2 className="font-sans font-semibold text-sm mb-1">Your Home Passport</h2>
      <p className="text-[13px] text-muted">
        Every plan comes with your home&apos;s passport: your boiler&apos;s service records and safety checks in one
        place, and it passes to the next owner when you move.
      </p>
      <p className="text-[13px] text-muted mt-2">
        <b className="text-ink">Cover your parents&apos; boiler.</b>{" "}You can join for someone else&apos;s home and pay
        for it yourself: just put their address in at the next step.
      </p>
      {localProof && <p className="text-[13px] text-ink mt-2">{localProof}</p>}
      {detailsUrl && <DetailsCapture url={detailsUrl} brand={brand} tierId={tierId} disabled={disabled} />}
    </div>
  );
}

function DetailsCapture({ url, brand, tierId, disabled }: { url: string; brand: string; tierId?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) return <p className="mt-3 text-[13px] text-ink">Sent. We&apos;ve texted you the link to come back to.</p>;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} disabled={disabled} className="mt-3 text-[13px] text-flame underline">
        Not ready yet? Send me the details
      </button>
    );
  }
  async function send() {
    setBusy(true);
    setError(null);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), phone: phone.trim(), consent, tierId }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}));
      setError(data?.error ?? "Couldn't send that — check your number and try again.");
      return;
    }
    setDone(true);
  }
  return (
    <div className="mt-3 flex flex-col gap-2">
      <input className={INPUT} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      <input
        className={INPUT}
        placeholder="Mobile number"
        inputMode="tel"
        autoComplete="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <label className="flex gap-2 text-xs text-muted items-start">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#5FA3F0]" />
        <span>{`${brand} can text me this plan's details and a reminder or two. Reply STOP any time.`}</span>
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button
        type="button"
        onClick={send}
        disabled={busy || disabled || !consent || name.trim().length < 2 || phone.trim().length < 10}
        className="rounded-[10px] border-[1.5px] border-line bg-paper px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
      >
        {busy ? "Sending…" : "Send me the details"}
      </button>
    </div>
  );
}

/** §7.8 — under the Direct Debit step's main button. */
export function TextMeLink({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");
  async function send() {
    setState("busy");
    const res = await fetch(`/api/signup/${token}/text-link`, { method: "POST" }).catch(() => null);
    setState(res?.ok ? "sent" : "error");
  }
  if (state === "sent") {
    return <p className="text-center text-[12.5px] text-ink">Sent. Open the text on your phone to carry on where you left off.</p>;
  }
  return (
    <p className="text-center text-[12.5px] text-muted">
      Prefer to use your own phone?{" "}
      <button type="button" onClick={send} disabled={state === "busy"} className="text-flame underline">
        Text me the link
      </button>
      {state === "error" && <span className="block text-danger mt-1">Couldn&apos;t send it — try again.</span>}
    </p>
  );
}
