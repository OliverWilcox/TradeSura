"use client";

import { useState } from "react";
import { btnClass } from "@/components/ui";
import { EmergencyStop } from "@/components/emergency-stop";

type Source = "profile" | "town" | "widget";

// Section 6 — Call and Message on the public profile. A call tap is logged
// (sendBeacon survives the page handing off to the dialler) before the phone
// rings; a message runs the gas-emergency interlock server-side.
export function ProfileContact({
  slug,
  firstName,
  brand,
  tel,
  showCall,
  showMessage,
  source = "profile",
}: {
  slug: string;
  firstName: string;
  brand: string;
  tel: string | null;
  showCall: boolean;
  showMessage: boolean;
  source?: Source;
}) {
  // When the form was opened — the spam guard rejects instant submits.
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const callable = showCall && tel;
  if (!callable && !showMessage) return null;

  function logCall() {
    const body = JSON.stringify({ slug, source });
    try {
      if (!navigator.sendBeacon?.("/api/enquiries/call", new Blob([body], { type: "application/json" }))) {
        void fetch("/api/enquiries/call", { method: "POST", body, keepalive: true });
      }
    } catch {
      // Logging must never stop the call.
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex gap-2.5">
        {callable && (
          <a href={`tel:${tel}`} onClick={logCall} className={`${btnClass()} flex-1`}>
            Call {firstName}
          </a>
        )}
        {showMessage && (
          <button
            type="button"
            onClick={() => setOpenedAt((t) => (t ? null : Date.now()))}
            className={`${btnClass("ghost")} flex-1`}
          >
            Message
          </button>
        )}
      </div>
      {openedAt && showMessage && <MessageForm slug={slug} brand={brand} source={source} startedAt={openedAt} />}
    </div>
  );
}

function MessageForm({
  slug,
  brand,
  source,
  startedAt,
}: {
  slug: string;
  brand: string;
  source: Source;
  startedAt: number;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [showStop, setShowStop] = useState(false);

  async function submit(acknowledged: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/enquiries/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, source, name, phone, email, message, website, startedAt, acknowledged }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.emergency) {
        setShowStop(true);
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Couldn't send your message — try again.");
        return;
      }
      setSent(true);
    } catch {
      setError("Couldn't send your message — check your connection.");
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
      <div className="bg-paper border border-line rounded-xl p-4 text-center">
        <p className="font-semibold">Message sent</p>
        <p className="text-xs text-muted mt-1">{brand} has been told and will get back to you.</p>
      </div>
    );
  }

  const field = "w-full rounded-[10px] border border-line-strong bg-bg px-3 py-2.5 text-sm text-ink";
  return (
    <form
      className="bg-paper border border-line rounded-xl p-4 flex flex-col gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
    >
      <p className="text-sm font-semibold">Message {brand}</p>
      <input className={field} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} required />
      <input className={field} placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" maxLength={30} />
      <input className={field} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" maxLength={200} />
      <p className="text-[11px] text-faint -mt-1">A phone number or email, so they can reply.</p>
      <textarea
        className={`${field} min-h-[110px]`}
        placeholder="What do you need? e.g. a boiler service in March"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={2000}
        required
      />
      {/* Honeypot — hidden from people, filled by bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} name="website" />
        </label>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <button type="submit" disabled={busy} className={btnClass()}>
        {busy ? "Sending…" : "Send message"}
      </button>
      <p className="text-[11px] text-faint">
        Smell gas? Don&apos;t message — call the National Gas Emergency line free on 0800 111 999.
      </p>
    </form>
  );
}
