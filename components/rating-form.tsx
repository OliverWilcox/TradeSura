"use client";

import { useState } from "react";
import { Card, btnClass } from "@/components/ui";
import { EmergencyStop } from "@/components/emergency-stop";

// Section 5 — "How was your service today?" 1–5 stars + optional comment.
// The comment is free text, so the server runs the gas-emergency interlock
// on it; a 409 here shows the stop page before the rating can be sent.
export function RatingForm({ token, brand }: { token: string; brand: string }) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [showStop, setShowStop] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(acknowledged: boolean) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/rate/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stars, comment: comment.trim() || undefined, acknowledged }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (res?.status === 409 && data.emergency) {
      setShowStop(true);
      return;
    }
    if (!res?.ok) {
      setError(data.error ?? "That didn't send — check your signal and try again.");
      return;
    }
    setDone(true);
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

  if (done) {
    return (
      <Card className="text-center py-6">
        <div className="text-2xl text-flame" aria-hidden>
          {"★".repeat(stars)}
        </div>
        <p className="font-semibold mt-2">Thank you</p>
        <p className="text-xs text-muted mt-1">
          Your rating is on {brand}&apos;s page as a verified TradeSura customer.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="text-lg font-semibold text-center">How was your service today?</h1>
      <div className="flex justify-center gap-1.5 mt-3" role="radiogroup" aria-label="Your rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={stars === n}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            onClick={() => setStars(n)}
            className={`text-4xl leading-none px-1 ${n <= stars ? "text-flame" : "text-line-strong"}`}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={3}
        maxLength={1000}
        placeholder="Add a comment (optional)"
        className="w-full mt-4 border border-line rounded-[10px] px-3 py-2.5 text-sm bg-paper"
      />
      {error && <p className="text-sm text-danger mt-2">{error}</p>}
      <button onClick={() => submit(false)} disabled={busy || stars === 0} className={`${btnClass()} mt-3`}>
        {busy ? "Sending…" : "Send rating"}
      </button>
    </Card>
  );
}
