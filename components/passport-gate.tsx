"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btnClass } from "@/components/ui";

const input = "w-full rounded-[10px] border-[1.5px] border-line bg-paper px-3 py-2.5 text-base tracking-[0.3em] text-center";

// Matt, 4 Nov — what a passport link opens before the homeowner proves it's
// them: nothing personal, just a code texted to the mobile on their plan.
// An expired (or old, unsigned) link offers a fresh one by text instead,
// sent to the number on file, never to whoever is holding the link.
export function PassportGate({
  token,
  e,
  s,
  expired,
  mobiles,
}: {
  token: string;
  e?: string;
  s?: string;
  expired: boolean;
  /** "mobile ending 23" for each number on file; empty when there's none. */
  mobiles: string[];
}) {
  const router = useRouter();
  const [choice, setChoice] = useState(0);
  const [requestToken, setRequestToken] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkSent, setLinkSent] = useState<string[] | null>(null);

  async function post(path: string, body: unknown) {
    const res = await fetch(`/api/passport/${token}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { res, data: await res.json().catch(() => ({})) };
  }

  async function textCode() {
    setBusy(true);
    setError(null);
    const { res, data } = await post("code", { e, s, choice });
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "That didn't work. Please try again.");
    setRequestToken(data.requestToken);
    setSentTo(data.sentTo);
    if (data.devCode) setCode(data.devCode);
  }

  async function verify() {
    setBusy(true);
    setError(null);
    const { res, data } = await post("verify", { requestToken, code });
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "That code doesn't match. Try again.");
    router.refresh();
  }

  async function newLink() {
    setBusy(true);
    setError(null);
    const { res, data } = await post("new-link", {});
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "That didn't work. Please try again.");
    setLinkSent(data.sentTo ?? []);
  }

  if (expired) {
    return (
      <Card className="space-y-3">
        <p className="font-semibold text-lg">This link has expired</p>
        <p className="text-sm text-muted">
          Home Passport links last 30 days. We can text a new one to the mobile on the plan.
        </p>
        {linkSent ? (
          <p className="text-sm">Sent. Check the text on your {linkSent.join(" or ")}.</p>
        ) : (
          <button type="button" onClick={newLink} disabled={busy || mobiles.length === 0} className={btnClass()}>
            {busy ? "Sending…" : "Text me a new link"}
          </button>
        )}
        {mobiles.length === 0 && <p className="text-sm text-muted">Ask your engineer to send you a new link.</p>}
        {error && <p className="text-sm text-danger">{error}</p>}
      </Card>
    );
  }

  return (
    <Card className="space-y-3">
      <p className="font-semibold text-lg">Your Home Passport</p>
      <p className="text-sm text-muted">
        Your home&apos;s service history, manual and reminders. To keep it private, we&apos;ll text a code to the
        mobile on your plan before showing anything.
      </p>
      {mobiles.length === 0 ? (
        <p className="text-sm">We don&apos;t have a mobile for this home. Ask your engineer to send you a new link.</p>
      ) : !requestToken ? (
        <>
          {mobiles.length > 1 && (
            <div className="space-y-1.5">
              {mobiles.map((m, i) => (
                <label key={m + i} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="mobile" checked={choice === i} onChange={() => setChoice(i)} />
                  Text my {m}
                </label>
              ))}
            </div>
          )}
          <button type="button" onClick={textCode} disabled={busy} className={btnClass()}>
            {busy ? "Sending…" : mobiles.length === 1 ? `Text a code to my ${mobiles[0]}` : "Text me a code"}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm">We&apos;ve texted a code to your {sentTo}.</p>
          <input
            className={input}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={4}
            value={code}
            onChange={(ev) => setCode(ev.target.value.replace(/\D/g, ""))}
            aria-label="Code"
          />
          <button type="button" onClick={verify} disabled={busy || code.length !== 4} className={btnClass()}>
            {busy ? "Checking…" : "Open my Home Passport"}
          </button>
          <button type="button" onClick={textCode} disabled={busy} className="text-sm text-muted underline">
            Send another code
          </button>
        </>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </Card>
  );
}
