// The customer's plan card on the web — matched to the 2026 Build Guide
// targets (and the app's "what your customer sees" preview): white card,
// navy text, blue ticks, green "Cancel anytime". The 2026 guide wins over
// older colour rules (CLAUDE.md).

function pounds(pence: number) {
  return pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`;
}

export const JOIN_BTN =
  "block w-full text-center font-semibold rounded-[10px] px-4 py-3 text-[15px] bg-[#1F5FC4] text-white disabled:opacity-50";

export function PlanTierCard({
  name,
  priceMonthlyPence,
  lines,
  selected = false,
  recommended = false,
  compact = false,
}: {
  name: string;
  priceMonthlyPence: number;
  lines: string[];
  selected?: boolean;
  recommended?: boolean;
  /** Name and price only — the summary above checkout. */
  compact?: boolean;
}) {
  return (
    <div
      className={`relative w-full text-left rounded-2xl bg-white p-4 text-[#0B1A2E] ${
        selected ? "ring-[3px] ring-[#5FA3F0]" : ""
      }`}
    >
      {recommended && (
        <span className="absolute -top-2.5 left-4 bg-[#1F5FC4] text-white text-[11px] font-semibold px-2.5 py-0.5 rounded-full">
          Most chosen
        </span>
      )}
      <div className="text-[21px] font-bold leading-tight">{name}</div>
      <div className="text-[15px] mt-0.5">{pounds(priceMonthlyPence)} a month</div>
      {!compact && (
        <>
          <span className="inline-block mt-2.5 rounded-full bg-[#C9F2DA] text-[#14532D] text-[12.5px] px-3 py-0.5">
            Cancel anytime
          </span>
          <ul className="mt-2.5 space-y-1.5">
            {lines.map((l) => {
              const [title, note] = l.split(" — ");
              return (
                <li key={l} className="flex gap-2.5 text-[14px]">
                  <span aria-hidden className="text-[#1F5FC4] font-bold">✓</span>
                  <span>
                    {title}
                    {note && <span className="block text-[12.5px] text-[#5B6B82]">{note}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
