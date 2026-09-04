"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, btnClass } from "@/components/ui";
import { EmergencyStop } from "@/components/emergency-stop";

export function ReportForm({ token }: { token: string }) {
  const [message, setMessage] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [showStop, setShowStop] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(withAck: boolean) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/portal/${token}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, acknowledged: withAck }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.status === 409 && data.emergency) {
      // Server detected emergency wording and logged the trigger.
      setShowStop(true);
      return;
    }
    if (!res.ok) {
      setError(data.error ?? "Could not send your report.");
      return;
    }
    setDone(true);
  }

  if (showStop) {
    return (
      <EmergencyStop
        onAcknowledged={() => {
          setShowStop(false);
          setAcknowledged(true);
          submit(true);
        }}
      />
    );
  }

  if (done) {
    return (
      <>
        <Card className="bg-ok-tint border-ok-tint text-center py-6">
          <div className="text-2xl">✓</div>
          <p className="font-semibold mt-1">Report sent</p>
          <p className="text-xs text-muted mt-1">
            Your engineer has been notified and will be in touch.
          </p>
        </Card>
        <Link href={`/portal/${token}`} className={btnClass("ghost")}>
          Back to my plan
        </Link>
      </>
    );
  }

  return (
    <Card>
      <h2 className="text-sm font-semibold mb-2">What&apos;s the problem?</h2>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={5}
        placeholder="e.g. Radiators cold downstairs since yesterday…"
        className="w-full border border-line rounded-[10px] px-3 py-2.5 text-sm bg-paper"
      />
      {error && <p className="text-sm text-danger mt-2">{error}</p>}
      <button
        onClick={() => submit(acknowledged)}
        disabled={busy || message.trim().length < 5}
        className={`${btnClass()} mt-3`}
      >
        {busy ? "Sending…" : "Send report"}
      </button>
    </Card>
  );
}
