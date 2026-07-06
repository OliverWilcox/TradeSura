"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btnClass } from "@/components/ui";

export function CsvImport() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/customers/import", { method: "POST", body: form });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Import failed.");
      return;
    }
    setResult(
      `${data.imported} imported, ${data.updated} updated, ${data.skipped} skipped${data.skipped ? " (bad phone numbers)" : ""}.`,
    );
    router.refresh();
  }

  return (
    <Card className="bg-flame-tint border-[#BBDCF4]">
      <h2 className="text-sm font-semibold text-flame-deep">Import your book in 60 seconds</h2>
      <p className="text-xs text-muted mt-1 mb-2.5">
        CSV with columns: first_name, last_name, phone, email, address_line1, town, postcode,
        appliance_make, appliance_model, last_serviced. We de-dupe on phone number automatically.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
      />
      <button onClick={() => fileRef.current?.click()} disabled={busy} className={btnClass()}>
        {busy ? "Importing…" : "Upload CSV"}
      </button>
      {result && <p className="text-xs text-ok font-semibold mt-2">✓ {result}</p>}
      {error && <p className="text-xs text-danger mt-2">{error}</p>}
    </Card>
  );
}
