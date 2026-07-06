"use client";

import { useState } from "react";
import { Brandmark } from "@/components/shells";
import { Card, btnClass } from "@/components/ui";

export default function SignInPage() {
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
    <div className="flex-1 flex flex-col max-w-md w-full mx-auto min-h-screen bg-panel px-4">
      <div className="pt-16 pb-8 text-center">
        <Brandmark />
        <p className="text-sm text-muted mt-2">
          Care plans, sold on the doorstep, collected by Direct Debit.
        </p>
      </div>
      <Card>
        {sent ? (
          <div className="space-y-3">
            <h1 className="font-semibold">Check your email</h1>
            <p className="text-sm text-muted">
              We&apos;ve sent a sign-in link to <b>{email}</b>. It&apos;s valid for 15 minutes.
            </p>
            {devLink && (
              <a href={devLink} className={btnClass("ghost")}>
                Dev: open the sign-in link
              </a>
            )}
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <h1 className="font-semibold">Sign in or create your account</h1>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.co.uk"
              className="w-full border border-line rounded-[10px] px-3 py-3 text-sm bg-paper"
            />
            {error && <p className="text-sm text-danger">{error}</p>}
            <button type="submit" disabled={busy} className={btnClass()}>
              {busy ? "Sending…" : "Email me a sign-in link"}
            </button>
          </form>
        )}
      </Card>
    </div>
  );
}
