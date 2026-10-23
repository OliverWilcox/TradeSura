import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { brandName } from "@/lib/engineer";
import { RECORD_KIND_LABEL, loadPassportView } from "@/lib/passport";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Home Passport records", robots: { index: false } };

const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });

// Section 4 — "Download my records": a plain printable page (Save as PDF
// from the browser's print dialog). Works the same LIVE or FROZEN — the
// history is never withheld.
export default async function PassportRecordsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await loadPassportView({ viewToken: token });
  if (!view) notFound();
  const { passport, state, boiler, lookedAfterBy, nextDueAt } = view;
  const address = [passport.addressLine1, passport.town, passport.postcode].filter(Boolean).join(", ");

  return (
    <div style={{ background: "#fff", color: "#0B1A2E", minHeight: "100vh" }} className="flex-1">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-5 text-sm">
        <PrintButton />
        <header>
          <h1 className="text-2xl font-bold">Home Passport</h1>
          <p className="mt-1">{address}</p>
          <p style={{ color: "#5B6B82" }} className="mt-1">
            {state === "LIVE" ? "Live" : "Frozen — no active plan"} · printed {fmt(new Date())}
          </p>
        </header>

        <section>
          <h2 className="font-bold text-base border-b pb-1" style={{ borderColor: "#E3E8EF" }}>
            Boiler
          </h2>
          <p className="mt-2">
            {[boiler?.make, boiler?.model].filter(Boolean).join(" ") || boiler?.type || "Not recorded"}
          </p>
          {boiler?.installedAt && <p>Fitted {fmt(boiler.installedAt)}</p>}
          {lookedAfterBy.length > 0 && <p>Looked after by {lookedAfterBy.map((e) => brandName(e)).join(" and ")}</p>}
          {nextDueAt && <p>Next service due {fmt(nextDueAt)}</p>}
        </section>

        <section>
          <h2 className="font-bold text-base border-b pb-1" style={{ borderColor: "#E3E8EF" }}>
            Records ({passport.records.length})
          </h2>
          {passport.records.length === 0 && <p className="mt-2">No records yet.</p>}
          {passport.records.map((r) => (
            <article key={r.id} className="py-3 border-b" style={{ borderColor: "#E3E8EF", breakInside: "avoid" }}>
              <p className="font-semibold">
                {RECORD_KIND_LABEL[r.kind] ?? r.kind} · {fmt(r.doneAt)}
              </p>
              <p style={{ color: "#5B6B82" }}>By {brandName(r.engineer)}</p>
              {r.notes && <p className="mt-1 whitespace-pre-line">{r.notes}</p>}
              {r.nextDueAt && <p className="mt-1">Next due {fmt(r.nextDueAt)}</p>}
              {r.photoUrls.length > 0 && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  {r.photoUrls.map((u) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={u} src={u} alt="Service photo" style={{ width: 140, height: 105, objectFit: "cover" }} />
                  ))}
                </div>
              )}
            </article>
          ))}
        </section>

        <p style={{ color: "#5B6B82" }}>
          Your home&apos;s history stays with it when you sell. Kept by TradeSura on behalf of the
          engineers who looked after this home.
        </p>
      </div>
    </div>
  );
}
