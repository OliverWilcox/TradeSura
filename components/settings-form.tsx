"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btnClass } from "@/components/ui";

const inputCls = "w-full border border-line rounded-[10px] px-3 py-2.5 text-sm bg-paper";

export function SettingsForm(props: { tradingName: string; logoUrl: string; slug: string }) {
  const router = useRouter();
  const [tradingName, setTradingName] = useState(props.tradingName);
  const [logoUrl, setLogoUrl] = useState(props.logoUrl);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dirty = tradingName !== props.tradingName || logoUrl !== props.logoUrl;

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tradingName, logoUrl }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Could not save.");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="space-y-2 mt-1">
      <label className="text-xs text-muted">Trading name</label>
      <input value={tradingName} onChange={(e) => { setTradingName(e.target.value); setSaved(false); }} className={inputCls} />
      <label className="text-xs text-muted">Logo URL (optional)</label>
      <input value={logoUrl} onChange={(e) => { setLogoUrl(e.target.value); setSaved(false); }} placeholder="https://…" className={inputCls} />
      <p className="text-[11px] text-faint">
        Customer pages: /p/{props.slug}/… — the address updates if you rename.
      </p>
      {error && <p className="text-sm text-danger">{error}</p>}
      {dirty && (
        <button onClick={save} disabled={busy || tradingName.length < 2} className={btnClass("ghost")}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      )}
      {saved && !dirty && <p className="text-xs text-ok font-semibold">✓ Saved</p>}
    </div>
  );
}
