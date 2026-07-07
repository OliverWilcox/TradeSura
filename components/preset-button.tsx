"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btnClass } from "@/components/ui";

export function PresetButton({ blank = false }: { blank?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    const res = await fetch("/api/tiers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preset: !blank }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <button onClick={create} disabled={busy} className={btnClass(blank ? "ghost" : "flame")}>
      {busy
        ? "Creating…"
        : blank
          ? "＋ New plan"
          : "Start with the 3 recommended tiers — Essential £9 / Plus £15 / Complete £22"}
    </button>
  );
}
