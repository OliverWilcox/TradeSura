"use client";

import { useState } from "react";
import { btnClass } from "@/components/ui";

export type Resolved =
  | { valid: true; personalised: boolean; firstName?: string; businessName?: string }
  | { valid: false }
  | null;

// C5 — the letter's landing strip. Type the code → personalised welcome →
// hand off to the app with the code attached, so the letter-cell attribution
// rides through signup onto the account. A QR deep-link (?code=) is resolved
// server-side and passed in as `initialResolved`.
export function ClaimForm({
  initialCode,
  initialResolved = null,
}: {
  initialCode?: string;
  initialResolved?: Resolved;
}) {
  const [code, setCode] = useState(initialCode ?? "");
  const [resolved, setResolved] = useState<Resolved>(initialResolved);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(initialResolved != null);

  async function resolve(c: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/claim/resolve?code=${encodeURIComponent(c)}`);
      setResolved(await res.json());
    } catch {
      setResolved({ valid: false });
    } finally {
      setBusy(false);
      setChecked(true);
    }
  }

  const appHref = (c?: string) =>
    c ? `tradesura://sign-up?code=${encodeURIComponent(c)}` : "tradesura://sign-up";

  return (
    <div className="flex flex-col gap-3">
      <input
        value={code}
        onChange={(e) => {
          setCode(e.target.value);
          setChecked(false);
          setResolved(null);
        }}
        placeholder="TS-00000"
        className="w-full text-center text-xl font-mono font-bold tracking-[0.12em] uppercase rounded-[10px] border-[1.5px] border-line bg-paper px-3 py-3.5"
      />

      {!checked && (
        <button
          onClick={() => resolve(code)}
          disabled={busy || code.trim().length < 4}
          className={btnClass()}
        >
          {busy ? "Checking…" : "Check my code"}
        </button>
      )}

      {checked && resolved?.valid && resolved.personalised && (
        <>
          <div className="rounded-[12px] bg-ok-tint border border-ok-tint p-3.5 text-left">
            <p className="font-semibold">Welcome, {resolved.firstName} 👋</p>
            <p className="text-xs text-muted mt-0.5">
              Your free TradeSura account is reserved for <b>{resolved.businessName}</b>. Founding
              member pricing — you keep 80% of every plan.
            </p>
          </div>
          <a href={appHref(code)} className={btnClass()}>
            Claim my free account
          </a>
          <p className="text-[11px] text-faint text-center">
            Opens the TradeSura app. Not installed?{" "}
            <a href="https://apps.apple.com/app/tradesura" className="underline">
              App&nbsp;Store
            </a>{" "}
            ·{" "}
            <a href="https://play.google.com/store/apps/details?id=com.tradesura.engineer" className="underline">
              Google&nbsp;Play
            </a>
          </p>
        </>
      )}

      {checked && resolved?.valid && !resolved.personalised && (
        <>
          <p className="text-sm text-muted">
            Your code is recognised. Create your free account to get started.
          </p>
          <a href={appHref(code)} className={btnClass()}>
            Create my free account
          </a>
        </>
      )}

      {checked && resolved && !resolved.valid && (
        <>
          <p className="text-sm text-muted">
            That code isn&apos;t recognised — check the letter, or just create your free account.
          </p>
          <a href={appHref()} className={btnClass()}>
            Create my free account
          </a>
        </>
      )}
    </div>
  );
}
