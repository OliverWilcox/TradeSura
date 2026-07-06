"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, Micro, btnClass } from "@/components/ui";

type Verified = { regNo: string; name: string; company: string; categories: string };

export function OnboardingForm(props: {
  verified: boolean;
  gcConnected: boolean;
  gcStatus: string | null;
  initial: {
    regNo: string;
    name: string | null;
    company: string | null;
    categories: string | null;
    tradingName: string;
  };
}) {
  const router = useRouter();
  const [regNo, setRegNo] = useState(props.initial.regNo);
  const [match, setMatch] = useState<Verified | null>(
    props.verified && props.initial.name
      ? {
          regNo: props.initial.regNo,
          name: props.initial.name,
          company: props.initial.company ?? "",
          categories: props.initial.categories ?? "",
        }
      : null,
  );
  const [tradingName, setTradingName] = useState(props.initial.tradingName);
  const [saved, setSaved] = useState(props.verified);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regNo }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMatch(null);
      setError(data.error);
      return;
    }
    setMatch(data);
    // Lookup autofills — the engineer confirms rather than types.
    if (!tradingName) setTradingName(data.company);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regNo, tradingName }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  const progress = props.gcConnected ? 100 : saved ? 80 : 45;

  return (
    <div className="flex-1 flex flex-col gap-2.5 pb-6">
      <div className="h-2 bg-line-soft rounded-full overflow-hidden">
        <div className="h-full bg-flame rounded-full transition-all" style={{ width: `${progress}%` }} />
      </div>

      <Card>
        <h2 className="text-sm font-semibold mb-1">Verify your Gas Safe registration</h2>
        <p className="text-xs text-muted mb-2.5">
          Customers see this badge on every plan you sell. It&apos;s your biggest closer.
        </p>
        <div className="flex justify-between items-center border border-line rounded-[10px] px-3 py-2 gap-2">
          <Micro>Gas Safe no.</Micro>
          <input
            value={regNo}
            onChange={(e) => setRegNo(e.target.value)}
            placeholder="584 123"
            className="font-mono font-semibold text-right bg-transparent outline-none w-32"
          />
        </div>
        {match ? (
          <div className="mt-2.5 bg-ok-tint border border-[#BCE6CF] rounded-[10px] px-3 py-2.5 text-xs">
            <b className="text-ok">✓ Verified against the register</b>
            <br />
            <span className="text-muted">
              {match.name} · {match.company} · {match.categories}
            </span>
          </div>
        ) : (
          <button onClick={verify} disabled={busy || !regNo} className={`${btnClass("ghost")} mt-2.5`}>
            {busy ? "Checking…" : "Check the register"}
          </button>
        )}
      </Card>

      <Card>
        <h2 className="text-sm font-semibold mb-1">Your business, front and centre</h2>
        <label className="text-xs text-muted">Trading name</label>
        <input
          value={tradingName}
          onChange={(e) => setTradingName(e.target.value)}
          placeholder="Smith Heating"
          className="w-full border border-line rounded-[10px] px-3 py-2.5 text-sm bg-paper mt-1"
        />
        {tradingName && (
          <p className="text-xs text-muted mt-2">
            Plan brand preview: <b>&ldquo;{tradingName} Care Plans&rdquo;</b>
          </p>
        )}
        {!saved && (
          <button
            onClick={save}
            disabled={busy || !match || tradingName.length < 2}
            className={`${btnClass()} mt-3`}
          >
            Save and continue
          </button>
        )}
      </Card>

      {saved && (
        <Card>
          <h2 className="text-sm font-semibold mb-1">Connect GoCardless — step 3</h2>
          <p className="text-xs text-muted mb-2.5">
            Customers pay you by Direct Debit. GoCardless pays out to your bank — Planlock never
            holds your money.
          </p>
          {props.gcConnected ? (
            <div className="bg-ok-tint border border-[#BCE6CF] rounded-[10px] px-3 py-2.5 text-xs">
              <b className="text-ok">✓ GoCardless connected (sandbox)</b>
            </div>
          ) : (
            <>
              {props.gcStatus === "missing_creds" && (
                <p className="text-xs text-danger mb-2">
                  GoCardless sandbox credentials aren&apos;t configured in .env yet — a human task
                  before this step works.
                </p>
              )}
              {props.gcStatus && props.gcStatus !== "missing_creds" && props.gcStatus !== "connected" && (
                <p className="text-xs text-danger mb-2">
                  Connection didn&apos;t complete ({props.gcStatus}). Try again.
                </p>
              )}
              <a href="/api/gc/connect" className={btnClass()}>
                Connect GoCardless (sandbox)
              </a>
            </>
          )}
        </Card>
      )}

      {error && <p className="text-sm text-danger px-1">{error}</p>}
      <div className="flex-1" />
      {saved && (
        <Link href="/plans" className={btnClass()}>
          Continue — build my first plan
        </Link>
      )}
      <p className="font-mono text-[10px] text-faint text-center pt-1">
        Payouts by GoCardless · Verification refreshed monthly
      </p>
    </div>
  );
}
