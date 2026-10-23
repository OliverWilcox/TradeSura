"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Micro, btnClass } from "@/components/ui";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const input = "w-full rounded-[10px] border-[1.5px] border-line bg-paper px-3 py-2.5 text-base";

// Phone photos are several MB; shrink to a sensible size before sending so
// the upload stays well under the request limit.
async function shrink(file: File): Promise<{ base64: string; mimeType: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That photo couldn't be opened."));
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    return { base64: dataUrl.slice(dataUrl.indexOf(",") + 1), mimeType: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Retention §9 — "a prompt to set up their Home Passport (boiler photo and
// details)". Only asks for what's missing; nothing the engineer entered is
// shown as editable.
export function PassportSetup({
  token,
  needMake,
  needModel,
  needFitted,
  photoRoom,
}: {
  token: string;
  needMake: boolean;
  needModel: boolean;
  needFitted: boolean;
  photoRoom: number;
}) {
  const router = useRouter();
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const maxPhotos = Math.min(2, photoRoom);
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 50 }, (_, i) => thisYear - i);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!make.trim() && !model.trim() && !year && files.length === 0) {
      setError("Add at least one detail or a photo.");
      return;
    }
    setBusy(true);
    try {
      const photos = await Promise.all(files.slice(0, maxPhotos).map(shrink));
      const res = await fetch(`/api/passport/${token}/boiler`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          make: make.trim() || undefined,
          model: model.trim() || undefined,
          year: year ? Number(year) : null,
          month: month ? Number(month) : null,
          photos,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't save that — please try again.");
        return;
      }
      setDone(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Card>
        <p className="font-semibold">Thanks — your Home Passport is updated.</p>
        <p className="text-xs text-muted mt-1">Your engineer will see these details at your next service.</p>
      </Card>
    );
  }

  return (
    <Card>
      <Micro>Set up your Home Passport</Micro>
      <p className="text-sm mt-1">
        Add your boiler&apos;s details and a photo or two. It helps your engineer come prepared, and it stays with
        your home.
      </p>
      <form onSubmit={save} className="mt-3 space-y-3">
        {needMake && (
          <label className="block text-sm">
            Boiler make
            <input className={input} value={make} onChange={(e) => setMake(e.target.value)} placeholder="For example, Worcester Bosch" maxLength={60} />
          </label>
        )}
        {needModel && (
          <label className="block text-sm">
            Model
            <input className={input} value={model} onChange={(e) => setModel(e.target.value)} placeholder="For example, Greenstar 30i" maxLength={60} />
          </label>
        )}
        {needFitted && (
          <fieldset className="text-sm">
            <legend>Roughly when was it fitted?</legend>
            <div className="mt-1 flex gap-2">
              <select className={input} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month fitted">
                <option value="">Month (not sure)</option>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
              <select className={input} value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year fitted">
                <option value="">Year</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </fieldset>
        )}
        {maxPhotos > 0 && (
          <label className="block text-sm">
            Photo of your boiler {maxPhotos > 1 ? "(one or two)" : ""}
            <input
              type="file"
              accept="image/*"
              multiple={maxPhotos > 1}
              className="mt-1 block w-full text-sm"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, maxPhotos))}
            />
            <span className="text-[11px] text-muted">Include the label with the make and model if you can.</span>
          </label>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <button type="submit" disabled={busy} className={btnClass()}>
          {busy ? "Saving…" : "Save to my Home Passport"}
        </button>
      </form>
    </Card>
  );
}
