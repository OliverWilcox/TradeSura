"use client";
import { useState } from "react";

export type AddressValue = { line1: string; town: string; postcode: string };
type Address = AddressValue & { line2?: string };

// Web counterpart of the native address field; both use the same authorised lookup API.
export function AddressLookup({ signupToken, value, onChange }: {
  signupToken: string; value: AddressValue; onChange: (value: AddressValue) => void;
}) {
  const [results, setResults] = useState<Address[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function lookup() {
    setBusy(true); setError(""); setResults([]);
    try {
      const response = await fetch("/api/address/lookup", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postcode: value.postcode, signupToken }) });
      const data = await response.json();
      if (!response.ok || !data.configured) throw new Error("Address lookup is unavailable — enter your address below.");
      setResults(data.addresses);
      if (!data.addresses.length) setError("No addresses found — check the postcode or enter your address below.");
    } catch { setError("We couldn't look up that postcode — enter your address below."); }
    finally { setBusy(false); }
  }
  const input = "w-full rounded-xl border border-line bg-paper p-3 text-base";
  return <fieldset className="flex flex-col gap-3">
    <legend className="mb-2 font-semibold">Your service address</legend>
    <div className="flex items-end gap-2">
      <label className="min-w-0 flex-1">Postcode<input required autoComplete="postal-code" className={input} value={value.postcode}
        onChange={e => { onChange({ ...value, postcode: e.target.value.toUpperCase() }); setResults([]); }} /></label>
      <button type="button" disabled={busy || value.postcode.trim().length < 4} onClick={lookup}
        className="rounded-xl border border-line p-3 disabled:opacity-50">{busy ? "Finding…" : "Find address"}</button>
    </div>
    {error && <p role="status" className="text-sm text-muted">{error}</p>}
    {results.length > 0 && <label>Choose your address<select className={input} defaultValue="" onChange={e => {
      const a = results[Number(e.target.value)];
      onChange({ line1: [a.line1, a.line2].filter(Boolean).join(", "), town: a.town, postcode: a.postcode }); setResults([]);
    }}><option value="" disabled>Select an address</option>{results.map((a, i) => <option key={i} value={i}>{[a.line1, a.line2, a.town].filter(Boolean).join(", ")}</option>)}</select></label>}
    <label>Address<input required autoComplete="address-line1" maxLength={160} className={input} value={value.line1} onChange={e => onChange({ ...value, line1: e.target.value })} /></label>
    <label>Town<input required autoComplete="address-level2" maxLength={80} className={input} value={value.town} onChange={e => onChange({ ...value, town: e.target.value })} /></label>
  </fieldset>;
}
