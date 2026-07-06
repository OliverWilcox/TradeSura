"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btnClass } from "@/components/ui";

export function FlushSmsButton() {
  const router = useRouter();
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function flush() {
    setBusy(true);
    const res = await fetch("/api/jobs/flush-sms", { method: "POST" });
    const data = await res.json();
    setBusy(false);
    setResult(`${data.sent} sent, ${data.remindersQueued} reminders queued`);
    router.refresh();
  }

  return (
    <div className="mt-2">
      <button onClick={flush} disabled={busy} className={btnClass("ghost")}>
        {busy ? "Flushing…" : "Run queue now"}
      </button>
      {result && <p className="text-xs text-ok font-semibold mt-1.5">✓ {result}</p>}
    </div>
  );
}

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch("/api/auth/signout", { method: "POST" });
        router.push("/signin");
      }}
      className={btnClass("dangerghost")}
    >
      Sign out
    </button>
  );
}
