"use client";

import { useState } from "react";
import { btnClass } from "@/components/ui";
import { EmergencyStop } from "@/components/emergency-stop";

// 30 Oct update §10 — "Find a gas engineer near you" on a town page. The
// request isn't addressed to anyone: Founding Members in the town get first
// pick, then every engineer listed here.
export function TownLeadForm({ town, townName }: { town: string; townName: string }) {
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  return (
    <div className="bg-paper border border-line rounded-xl p-3.5">
      <h2 className="font-sans font-semibold text-sm text-ink">Need a gas engineer in {townName}?</h2>
      <p className="text-[13px] text-muted mt-1">
        Not sure who to pick? Tell us what you need and one local Gas Safe engineer will get back to you.
      </p>
      {openedAt ? (
        <LeadForm town={town} startedAt={openedAt} />
      ) : (
        <button type="button" onClick={() => setOpenedAt(Date.now())} className={`${btnClass("ghost")} mt-3 w-full`}>
          Find me an engineer
        </button>
      )}
    </div>
  );
}

function LeadForm({ town, startedAt }: { town: string; startedAt: number }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [postcode, setPostcode] = useState("");
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState(""); // honeypot
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [showStop, setShowStop] = useState(false);

  async function submit(acknowledged: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/town-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ town, name, phone, email, postcode, message, consent, website, startedAt, acknowledged }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.emergency) {
        setShowStop(true);
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Couldn't send your request — try again.");
        return;
      }
      setSent(true);
    } catch {
      setError("Couldn't send your request — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  if (showStop) {
    return (
      <EmergencyStop
        onAcknowledged={() => {
          setShowStop(false);
          submit(true);
        }}
      />
    );
  }

  if (sent) {
    return (
      <div className="mt-3 rounded-xl border border-line p-4 text-center">
        <p className="font-semibold text-ink">Request sent</p>
        <p className="text-xs text-muted mt-1">
          A local engineer will pick it up and get back to you. We&apos;ll text or email you to say who.
        </p>
      </div>
    );
  }

  const field = "w-full rounded-[10px] border border-line-strong bg-bg px-3 py-2.5 text-sm text-ink";
  return (
    <form
      className="mt-3 flex flex-col gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
    >
      <input className={field} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} required />
      <input className={field} placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" maxLength={30} />
      <input className={field} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" autoCapitalize="none" autoCorrect="off" maxLength={200} />
      <p className="text-[11px] text-faint -mt-1">A phone number or email, so they can get back to you.</p>
      <input className={field} placeholder="Postcode" value={postcode} onChange={(e) => setPostcode(e.target.value)} autoComplete="postal-code" autoCapitalize="characters" maxLength={10} required />
      <textarea
        className={`${field} min-h-[100px]`}
        placeholder="What do you need? e.g. a boiler service before winter"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={2000}
        required
      />
      <label className="flex gap-2 text-xs text-muted items-start">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#5FA3F0]" />
        <span>Pass my details to one local engineer on TradeSura so they can get back to me.</span>
      </label>
      {/* Honeypot — hidden from people, filled by bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} name="website" />
        </label>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <button type="submit" disabled={busy || !consent} className={btnClass()}>
        {busy ? "Sending…" : "Send my request"}
      </button>
      <p className="text-[11px] text-faint">
        Smell gas? Don&apos;t use this form — call the National Gas Emergency line free on 0800 111 999.
      </p>
    </form>
  );
}
