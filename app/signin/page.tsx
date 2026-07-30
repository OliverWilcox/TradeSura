"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

// Auth surface is dark so the brand logo sits on a dark ground, never in a
// black box on white (handover 1.6). Swap to the light-variant asset and a
// light page here if/when that artwork lands.
function SignInInner() {
  const isNew = useSearchParams().get("new") === "1";
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      return;
    }
    setSent(true);
    setDevLink(data.devLink ?? null);
  }

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-night text-night-text">
      <div className="flex-1 flex flex-col justify-center max-w-md w-full mx-auto px-6 py-10 gap-6">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
        <img src="/logo-mark.svg" alt="TradeSura" className="h-10 w-auto self-start" />

        <div className="bg-night-card border border-[#22303F] rounded-[16px] p-5">
          {sent ? (
            <div className="space-y-3">
              <h1 className="font-semibold">Check your email</h1>
              <p className="text-sm text-night-muted">
                We&apos;ve sent a sign-in link to <b className="text-night-text">{email}</b>.
                It&apos;s valid for 15 minutes.
              </p>
              {devLink && (
                <a
                  href={devLink}
                  className="block text-center border-[1.5px] border-brand-blue text-brand-blue-lift font-semibold rounded-[10px] px-4 py-3"
                >
                  Dev: open the sign-in link
                </a>
              )}
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <h1 className="font-semibold">
                {isNew ? "Create your account" : "Sign in or create your account"}
              </h1>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.co.uk"
                className="w-full border border-[#2A3A4C] rounded-[10px] px-3 py-3 text-sm bg-night text-night-text placeholder:text-night-muted"
              />
              {error && <p className="text-sm text-danger">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="block w-full text-center bg-brand-blue text-white font-semibold rounded-[10px] px-4 py-3.5 disabled:opacity-50"
              >
                {busy ? "Sending…" : "Email me a sign-in link"}
              </button>
            </form>
          )}
        </div>

        <p className="text-xs text-night-muted text-center">
          Care plans your customers sign at the end of the job, collected by Direct Debit.
        </p>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInInner />
    </Suspense>
  );
}
