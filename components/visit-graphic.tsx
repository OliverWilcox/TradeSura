const GRAPHICS: Record<string, React.ReactNode> = {
  "new-boiler": (
    <>
      <rect x="5" y="2.5" width="14" height="14.5" rx="2" />
      <rect x="8" y="5.5" width="8" height="3" rx="0.75" />
      <circle cx="12" cy="12.75" r="1.5" />
      <path d="M9 17v4.5M15 17v4.5" />
    </>
  ),
  repair: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  ),
  service: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
      <path d="m9 15.5 2 2 4-4" />
    </>
  ),
  landlord: (
    <>
      <path d="M3 11 12 4l9 7" />
      <path d="M5 9.5V20h14V9.5" />
      <circle cx="9.5" cy="15" r="2" />
      <path d="M11.5 15H16M14.5 15v2" />
    </>
  ),
  general: (
    <>
      <path d="M3 11 12 4l9 7" />
      <path d="M5 9.5V20h14V9.5" />
      <path d="M12 18c-1.66 0-3-1.2-3-2.8 0-1.5 1-2.3 1.6-3.2.3 1 .9 1.4 1.4 1.4 0-1.4.6-2.6 1.6-3.4.2 1.6 1.4 2.4 1.4 4.6 0 1.9-1.34 3.4-3 3.4z" />
    </>
  ),
};

export const hasGraphic = (key: string) => Object.hasOwn(GRAPHICS, key);

export function VisitGraphic({ graphicKey }: { graphicKey: string | null }) {
  const art = graphicKey && hasGraphic(graphicKey) ? GRAPHICS[graphicKey] : undefined;
  if (!art) return null;
  return (
    <span className="grid size-11 shrink-0 place-items-center rounded-full bg-flame-tint text-flame" data-graphic={graphicKey} aria-hidden>
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        {art}
      </svg>
    </span>
  );
}
