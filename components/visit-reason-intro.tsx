import type { ReasonContent } from "@/lib/visit-reasons";

// 30 Oct update §6 — the top of the customer's page when the installer
// hands over the phone: written for why they were there (Matt's admin
// content, lib/visit-reasons.ts). The page's own sections follow it.
export function VisitReasonIntro({ content, engineerFirstName }: { content: ReasonContent; engineerFirstName: string }) {
  return (
    <section className="bg-paper border border-line rounded-xl p-4" data-visit-reason={content.reason} data-variant={content.variant}>
      <h2 className="font-sans font-semibold text-lg leading-snug">{content.headline}</h2>
      {content.worries.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {content.worries.map((w) => (
            <li key={w} className="text-[13px] text-muted italic">
              &ldquo;{w}&rdquo;
            </li>
          ))}
        </ul>
      )}
      <ul className="mt-3 space-y-2">
        {content.messages.map((m) => (
          <li key={m} className="flex gap-2 text-[13.5px]">
            <span className="text-flame font-bold" aria-hidden>
              ✓
            </span>
            <span>{m}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12.5px] text-muted">The engineer you already know, {engineerFirstName}, not a call centre.</p>
    </section>
  );
}
