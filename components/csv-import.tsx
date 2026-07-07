"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btnClass } from "@/components/ui";

type ContactsNavigator = Navigator & {
  contacts?: {
    select: (
      props: string[],
      opts: { multiple: boolean },
    ) => Promise<{ name?: string[]; tel?: string[]; email?: string[] }[]>;
  };
};

export function CsvImport() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function report(res: Response, data: { imported?: number; updated?: number; skipped?: number; error?: string }) {
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Import failed.");
      return;
    }
    setResult(`${data.imported} imported, ${data.updated} updated, ${data.skipped} skipped.`);
    router.refresh();
  }

  async function uploadCsv(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/customers/import", { method: "POST", body: form });
    report(res, await res.json());
  }

  async function pickContacts() {
    const nav = navigator as ContactsNavigator;
    if (!nav.contacts?.select) {
      setError("Phone-book import needs Chrome on Android (and HTTPS). Use CSV on this device.");
      return;
    }
    setError(null);
    setResult(null);
    try {
      const picked = await nav.contacts.select(["name", "tel", "email"], { multiple: true });
      const contacts = picked
        .map((c) => ({ name: c.name?.[0] ?? "", phone: c.tel?.[0] ?? "", email: c.email?.[0] }))
        .filter((c) => c.name && c.phone);
      if (contacts.length === 0) return;
      setBusy(true);
      const res = await fetch("/api/customers/import-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacts }),
      });
      report(res, await res.json());
    } catch {
      // user dismissed the picker — not an error
    }
  }

  return (
    <Card className="bg-flame-tint border-[#BBDCF4]">
      <h2 className="text-sm font-semibold text-flame-deep">Import your book in 60 seconds</h2>
      <p className="text-xs text-muted mt-1 mb-3">
        From your phone book, or a CSV (first_name, last_name, phone, email, address_line1, town,
        postcode, appliance_make, appliance_model, last_serviced). We de-dupe on phone number
        automatically.
      </p>
      <button onClick={pickContacts} disabled={busy} className={btnClass()}>
        Import from phone contacts
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && uploadCsv(e.target.files[0])}
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className={`${btnClass("ghost")} mt-2`}
      >
        {busy ? "Importing…" : "Upload CSV"}
      </button>
      {result && <p className="text-xs text-ok font-semibold mt-2">✓ {result}</p>}
      {error && <p className="text-xs text-danger mt-2">{error}</p>}
    </Card>
  );
}
