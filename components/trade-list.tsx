"use client";

import { useState } from "react";
import { Card, Micro, Pill } from "@/components/ui";

type Pack = {
  code: string;
  name: string;
  anchor: string;
  live: boolean;
  registered: boolean;
};

export function TradeList({ packs }: { packs: Pack[] }) {
  const [done, setDone] = useState<Set<string>>(
    new Set(packs.filter((p) => p.registered).map((p) => p.code)),
  );
  const [busy, setBusy] = useState<string | null>(null);

  async function register(code: string) {
    setBusy(code);
    const res = await fetch("/api/trades/interest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    setBusy(null);
    if (res.ok) setDone(new Set([...done, code]));
  }

  return (
    <Card>
      {packs.map((p) => (
        <div
          key={p.code}
          className="flex justify-between items-center gap-2 py-2.5 border-b border-line-soft last:border-b-0"
        >
          <div>
            <b className="text-sm">{p.name}</b>
            <br />
            <Micro>{p.anchor}</Micro>
          </div>
          {p.live ? (
            <Pill tone="ok">LIVE</Pill>
          ) : done.has(p.code) ? (
            <Pill tone="info">INTEREST REGISTERED</Pill>
          ) : (
            <button
              onClick={() => register(p.code)}
              disabled={busy === p.code}
              className="text-flame-deep font-semibold text-xs whitespace-nowrap disabled:text-faint"
            >
              {busy === p.code ? "…" : "Register interest →"}
            </button>
          )}
        </div>
      ))}
    </Card>
  );
}
