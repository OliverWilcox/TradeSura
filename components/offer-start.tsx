"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Micro, btnClass } from "@/components/ui";

type Customer = { id: string; firstName: string; lastName: string; phone: string };

const inputCls = "w-full border border-line rounded-[10px] px-3 py-2.5 text-sm bg-paper";

export function OfferStart({ customers }: { customers: Customer[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"new" | "existing">(customers.length ? "existing" : "new");
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    addressLine1: "",
    town: "",
    postcode: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setError(null);
    const body = mode === "existing" ? { customerId } : form;
    const res = await fetch("/api/offer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Could not send the link.");
      return;
    }
    router.push(`/offer/${data.planId}`);
  }

  return (
    <Card>
      <h2 className="text-sm font-semibold mb-2">Send signup link</h2>
      {customers.length > 0 && (
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setMode("existing")}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full ${mode === "existing" ? "bg-flame-tint text-flame-deep" : "bg-panel text-faint border border-line"}`}
          >
            From my book
          </button>
          <button
            onClick={() => setMode("new")}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full ${mode === "new" ? "bg-flame-tint text-flame-deep" : "bg-panel text-faint border border-line"}`}
          >
            New customer
          </button>
        </div>
      )}
      {mode === "existing" ? (
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={inputCls}>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.firstName} {c.lastName} · {c.phone}
            </option>
          ))}
        </select>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              placeholder="First name"
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              className={inputCls}
            />
            <input
              placeholder="Last name"
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              className={inputCls}
            />
          </div>
          <input
            placeholder="Mobile (07…)"
            inputMode="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className={inputCls}
          />
          <input
            placeholder="Email (for the plan document)"
            inputMode="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className={inputCls}
          />
          <div className="flex gap-2">
            <input
              placeholder="Address line 1"
              value={form.addressLine1}
              onChange={(e) => setForm({ ...form, addressLine1: e.target.value })}
              className={inputCls}
            />
            <input
              placeholder="Postcode"
              value={form.postcode}
              onChange={(e) => setForm({ ...form, postcode: e.target.value })}
              className={`${inputCls} max-w-28`}
            />
          </div>
        </div>
      )}
      {error && <p className="text-sm text-danger mt-2">{error}</p>}
      <button onClick={send} disabled={busy} className={`${btnClass()} mt-3`}>
        {busy ? "Sending…" : "Text the link now"}
      </button>
      <Micro className="text-center mt-2">A QR code is on the next screen too</Micro>
    </Card>
  );
}
