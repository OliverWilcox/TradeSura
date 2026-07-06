"use client";

import { useState } from "react";
import { EMERGENCY_LINE } from "@/lib/compliance/interlock";
import { btnClass } from "@/components/ui";

// CLAUDE.md §Compliance 4 — full-screen stop page with required
// acknowledgement before the form can continue.
export function EmergencyStop({ onAcknowledged }: { onAcknowledged: () => void }) {
  const [ticked, setTicked] = useState(false);

  return (
    <div className="fixed inset-0 z-50 bg-danger text-white flex flex-col justify-center px-6 py-10 overflow-y-auto">
      <div className="max-w-md mx-auto space-y-4">
        <div className="text-4xl">⚠</div>
        <h1 className="font-disp text-3xl uppercase leading-tight">
          If you can smell gas or suspect carbon monoxide, act now
        </h1>
        <ul className="text-sm space-y-2 list-disc pl-5">
          <li>
            <b>Do not</b> use light switches, plugs or naked flames.
          </li>
          <li>Open windows and doors.</li>
          <li>Turn the gas off at the meter if you can do so safely.</li>
          <li>Get everyone out if you feel unwell.</li>
        </ul>
        <a
          href="tel:0800111999"
          className="block text-center bg-white text-danger font-bold rounded-[10px] px-4 py-4 text-lg"
        >
          Call the National Gas Emergency line
          <br />
          <span className="font-mono text-2xl">{EMERGENCY_LINE}</span>
        </a>
        <p className="text-xs opacity-90">Free, 24 hours a day. Do this before anything else.</p>
        <label className="flex gap-2.5 items-start text-sm bg-white/10 rounded-[10px] p-3">
          <input
            type="checkbox"
            checked={ticked}
            onChange={(e) => setTicked(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            I have called {EMERGENCY_LINE}, or this is not a gas emergency.
          </span>
        </label>
        <button
          onClick={onAcknowledged}
          disabled={!ticked}
          className={`${btnClass("ghost")} !text-white !border-white disabled:opacity-40`}
        >
          Continue with my report
        </button>
      </div>
    </div>
  );
}
