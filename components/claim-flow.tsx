"use client";

import { useEffect, useRef, useState } from "react";
import { btnClass } from "@/components/ui";

type Address = { line1: string; town: string; postcode: string };
type Found = Address & { line2?: string };
const EMPTY: Address = { line1: "", town: "", postcode: "" };

// 30 Oct update §1 — the claim page's three animated ticks, about 4 seconds.
const TICK_MS = 1300;

// §8 — Trustpilot stars and the founder line go here once there are reviews.
// Kept off until then, so the slot is ready but nothing fake ever shows.
const SHOW_TRUST_STRIP = false;

function logStep(code: string, step: string) {
  // Fire and forget: the funnel log must never slow the page or block a step.
  fetch(`/api/claim/${encodeURIComponent(code)}/step`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ step }),
    keepalive: true,
  }).catch(() => {});
}

function Tick({ done }: { done: boolean }) {
  return (
    <span
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[13px] font-bold transition-colors ${
        done ? "border-flame bg-flame text-[#0B1A2E]" : "border-line text-transparent"
      }`}
      aria-hidden="true"
    >
      ✓
    </span>
  );
}

function AddressFields({
  code,
  legend,
  value,
  onChange,
}: {
  code: string;
  legend: string;
  value: Address;
  onChange: (a: Address) => void;
}) {
  const [found, setFound] = useState<Found[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [manual, setManual] = useState(false);

  async function lookup() {
    setBusy(true);
    setNote("");
    setFound([]);
    try {
      const res = await fetch("/api/address/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postcode: value.postcode, claimCode: code }),
      });
      const data = await res.json();
      if (!res.ok || !data.configured) throw new Error();
      setFound(data.addresses);
      if (!data.addresses.length) {
        setNote("No addresses found for that postcode. Type your address below.");
        setManual(true);
      }
    } catch {
      setNote("We couldn't look that postcode up. Type your address below.");
      setManual(true);
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded-[10px] border border-line bg-paper px-3 py-3 text-base text-ink";
  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="mb-1.5 text-sm font-semibold">{legend}</legend>
      <div className="flex items-end gap-2">
        <label className="min-w-0 flex-1 text-xs text-muted">
          Postcode
          <input
            className={`${input} mt-1 uppercase`}
            autoComplete="postal-code"
            value={value.postcode}
            onChange={(e) => {
              onChange({ ...value, postcode: e.target.value.toUpperCase() });
              setFound([]);
            }}
          />
        </label>
        <button
          type="button"
          onClick={lookup}
          disabled={busy || value.postcode.trim().length < 5}
          className="shrink-0 rounded-[10px] border border-line px-3 py-3 text-sm disabled:opacity-50"
        >
          {busy ? "Finding…" : "Find address"}
        </button>
      </div>
      {note && <p className="text-xs text-muted">{note}</p>}
      {found.length > 0 && (
        <label className="text-xs text-muted">
          Pick your address
          <select
            className={`${input} mt-1`}
            defaultValue=""
            onChange={(e) => {
              const a = found[Number(e.target.value)];
              onChange({ line1: [a.line1, a.line2].filter(Boolean).join(", "), town: a.town, postcode: a.postcode });
              setFound([]);
              setManual(true);
            }}
          >
            <option value="" disabled>
              {found.length} addresses found
            </option>
            {found.map((a, i) => (
              <option key={i} value={i}>
                {[a.line1, a.line2, a.town].filter(Boolean).join(", ")}
              </option>
            ))}
          </select>
        </label>
      )}
      {manual || value.line1 ? (
        <>
          <label className="text-xs text-muted">
            Address
            <input
              className={`${input} mt-1`}
              autoComplete="address-line1"
              maxLength={160}
              value={value.line1}
              onChange={(e) => onChange({ ...value, line1: e.target.value })}
            />
          </label>
          <label className="text-xs text-muted">
            Town
            <input
              className={`${input} mt-1`}
              autoComplete="address-level2"
              maxLength={80}
              value={value.town}
              onChange={(e) => onChange({ ...value, town: e.target.value })}
            />
          </label>
        </>
      ) : (
        <button type="button" onClick={() => setManual(true)} className="self-start text-xs text-flame underline">
          Type my address instead
        </button>
      )}
    </fieldset>
  );
}

export function ClaimFlow({
  code,
  businessName,
  town,
  foundingLine,
  reservationOpen,
  alreadyClaimed,
  hasAccount,
  platform,
  storeUrl,
  qrDataUrl,
}: {
  code: string;
  businessName: string | null;
  town: string | null;
  foundingLine: string | null;
  reservationOpen: boolean;
  alreadyClaimed: boolean;
  hasAccount: boolean;
  platform: "ios" | "android" | "desktop";
  storeUrl: string | null;
  qrDataUrl: string | null;
}) {
  const [ticks, setTicks] = useState(hasAccount ? 3 : 0);
  const [trading, setTrading] = useState<Address>(EMPTY);
  const [postElsewhere, setPostElsewhere] = useState(false);
  const [post, setPost] = useState<Address>(EMPTY);
  const [mobile, setMobile] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<"form" | "sent">(alreadyClaimed ? "sent" : "form");
  const [copied, setCopied] = useState(false);
  const [stuck, setStuck] = useState(false);
  const jumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lines = [
    "Setting up your account…",
    "Reserving your business name…",
    reservationOpen && town ? `Your Founding spot in ${town} is reserved` : "Your free account is ready",
  ];

  useEffect(() => {
    if (hasAccount) return;
    const timers = [1, 2, 3].map((n) => setTimeout(() => setTicks(n), n * TICK_MS));
    const seen = setTimeout(() => logStep(code, "ticks_seen"), 3 * TICK_MS);
    if (platform === "desktop") logStep(code, "desktop_shown");
    return () => [...timers, seen].forEach(clearTimeout);
  }, [code, hasAccount, platform]);

  useEffect(() => () => {
    if (jumpTimer.current) clearTimeout(jumpTimer.current);
  }, []);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      logStep(code, "code_copied");
    } catch {
      // Clipboard can be blocked (older browsers, in-app viewers): the code
      // is in the text and on screen, so this is never a dead end.
    }
  }

  // §1.5 — the store opens by itself; "Tap here if nothing happens" only
  // appears if the jump was blocked (we're still on the page).
  function openStore() {
    if (!storeUrl) return;
    logStep(code, "store_opened");
    window.location.href = storeUrl;
    jumpTimer.current = setTimeout(() => {
      if (document.visibilityState === "visible") setStuck(true);
    }, 2500);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/claim/${encodeURIComponent(code)}/details`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trading,
          postElsewhere,
          correspondence: postElsewhere ? post : undefined,
          mobile,
          consent,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't save that. Check your details and try again.");
        return;
      }
      await sendCode();
    } catch {
      setError("Couldn't save that. Check your signal and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function sendCode() {
    // Copy first: it needs the tap that's happening right now.
    await copyCode();
    const res = await fetch(`/api/claim/${encodeURIComponent(code)}/send-code`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Couldn't send the text. Try again in a minute.");
      return;
    }
    setStage("sent");
    if (platform !== "desktop") openStore();
  }

  if (hasAccount) {
    return (
      <>
        <h1 className="font-sans font-bold text-xl">Your account is ready</h1>
        <p className="text-sm text-muted">This code already has a TradeSura account. Open the app and sign in.</p>
        <OpenAppButton deepLink="tradesura://welcome" />
      </>
    );
  }

  return (
    <>
      <ul className="flex flex-col gap-2.5" aria-live="polite">
        {lines.map((l, i) => (
          <li key={i} className={`flex items-center gap-2.5 text-[15px] transition-opacity ${ticks >= i ? "opacity-100" : "opacity-40"}`}>
            <Tick done={ticks > i} />
            <span className={i === 2 && ticks > 2 ? "font-semibold" : ""}>{l}</span>
          </li>
        ))}
      </ul>

      {(businessName || town) && (
        <div className="rounded-xl border border-line bg-paper p-4">
          {businessName && <p className="font-sans text-lg font-bold leading-tight">{businessName}</p>}
          {town && <p className="text-sm text-muted">{town}</p>}
        </div>
      )}

      {foundingLine && (
        <p className="rounded-xl border border-flame/40 bg-flame-tint px-4 py-3 text-sm font-semibold text-flame">
          {foundingLine}
        </p>
      )}

      {SHOW_TRUST_STRIP && <div data-slot="trustpilot-and-founder-line" />}

      {qrDataUrl && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-line bg-paper p-4 text-center">
          <p className="font-semibold">Scan this with your phone</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- inline data URL, generated server-side */}
          <img src={qrDataUrl} alt="QR code for this page" width={180} height={180} className="rounded-lg bg-white p-2" />
          <p className="text-xs text-muted">The TradeSura app is for your phone. Scan to carry on there.</p>
        </div>
      )}

      {stage === "form" && ticks >= 3 && (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <h2 className="font-sans text-lg font-bold">Confirm your details to secure your spot</h2>
            <p className="text-sm text-muted">
              A quick security step so your spot and business name stay yours.
            </p>
          </div>

          <AddressFields code={code} legend="Trading address" value={trading} onChange={setTrading} />

          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={postElsewhere}
              onChange={(e) => setPostElsewhere(e.target.checked)}
              className="mt-0.5 h-5 w-5 accent-[#5FA3F0]"
            />
            <span>
              Send my post somewhere else
              <span className="block text-xs text-muted">Your member pack and all post go to your trading address unless you change it here.</span>
            </span>
          </label>
          {postElsewhere && <AddressFields code={code} legend="Postal address" value={post} onChange={setPost} />}

          <label className="text-xs text-muted">
            Mobile number
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              className="mt-1 w-full rounded-[10px] border border-line bg-paper px-3 py-3 text-base text-ink"
              placeholder="07…"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
            />
          </label>
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-5 w-5 accent-[#5FA3F0]"
            />
            <span>TradeSura can text me to help me finish setting up.</span>
          </label>

          {error && <p className="text-sm text-danger">{error}</p>}
          <button type="submit" disabled={busy} className={btnClass()}>
            {busy ? "One moment…" : "Send my code"}
          </button>
        </form>
      )}

      {stage === "sent" && (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-line bg-paper p-4">
            <p className="text-xs uppercase tracking-[0.12em] text-muted">Your claim code</p>
            <p className="font-mono text-2xl font-bold tracking-[0.08em]">{code}</p>
            <p className="mt-1 text-sm text-muted">
              {copied ? "Copied. " : ""}
              We&apos;ve texted it to you with a link. Once the app&apos;s installed, tap the link and everything&apos;s loaded.
            </p>
          </div>
          {platform === "desktop" ? (
            <p className="text-sm text-muted">Install TradeSura on your phone, then tap the link in the text.</p>
          ) : (
            (stuck || alreadyClaimed) && (
              <a
                href={storeUrl ?? "#"}
                onClick={() => logStep(code, "store_fallback_tapped")}
                className={btnClass()}
              >
                {alreadyClaimed && !stuck ? "Get the TradeSura app" : "Tap here if nothing happens"}
              </a>
            )
          )}
          {alreadyClaimed && (
            <button type="button" onClick={sendCode} className="text-sm text-flame underline">
              Text me my code again
            </button>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      )}
    </>
  );
}

export function OpenAppButton({ deepLink }: { deepLink: string }) {
  useEffect(() => {
    window.location.href = deepLink;
  }, [deepLink]);
  return (
    <a href={deepLink} className={btnClass()}>
      Open TradeSura
    </a>
  );
}
