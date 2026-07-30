"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Micro, Pill, btnClass } from "@/components/ui";
import { checkWording } from "@/lib/compliance/blocklist";
import { CATEGORY_ORDER, appFeePence, suggestedPricePence } from "@/lib/clauses";

type Template = {
  id: string;
  code: string;
  title: string;
  kind: "CORE" | "ADD";
  category: string;
  upliftPence: number | null;
  pricingLabel: string | null;
  highlight: boolean;
};

function upliftLabel(t: Template) {
  if (t.kind === "CORE") return ""; // the CORE pill already says it
  if (t.pricingLabel) return t.pricingLabel;
  if (t.upliftPence === null) return "";
  if (t.upliftPence === 0) return "no charge";
  return `+£${(t.upliftPence / 100).toFixed(2).replace(/\.00$/, "")}/mo`;
}

export function TierEditor({
  tier,
  templates,
}: {
  tier: {
    id: string;
    name: string;
    priceMonthlyPence: number;
    isRecommended: boolean;
    customLabels: string[];
    clauseIds: string[];
  };
  templates: Template[];
}) {
  const router = useRouter();
  const [name, setName] = useState(tier.name);
  const [pounds, setPounds] = useState((tier.priceMonthlyPence / 100).toFixed(2));
  const [isRecommended, setIsRecommended] = useState(tier.isRecommended);
  const [selected, setSelected] = useState<Set<string>>(new Set(tier.clauseIds));
  const [customLabels, setCustomLabels] = useState<string[]>(tier.customLabels);
  const [draftLabel, setDraftLabel] = useState("");
  const [blocked, setBlocked] = useState<{
    explanation: string;
    suggestion: { title: string };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pricePence = Math.round(parseFloat(pounds || "0") * 100);
  const fee = appFeePence(Math.max(pricePence, 0));

  // Tier pricing self-assembles as benefits are stacked (handover §3).
  const suggestedPence = useMemo(
    () => suggestedPricePence(templates.filter((t) => selected.has(t.id)).map((t) => t.upliftPence)),
    [selected, templates],
  );

  const grouped = useMemo(() => {
    const known = CATEGORY_ORDER as readonly string[];
    const cats = [...new Set(templates.map((t) => t.category))].sort(
      (a, b) => known.indexOf(a) - known.indexOf(b),
    );
    return cats.map((c) => ({ category: c, items: templates.filter((t) => t.category === c) }));
  }, [templates]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function addLabel() {
    const label = draftLabel.trim();
    if (!label) return;
    // Wording blocklist runs as-you-add; the server re-checks on save.
    const check = checkWording(label);
    if (!check.ok) {
      setBlocked({ explanation: check.explanation, suggestion: check.suggestion });
      return;
    }
    setBlocked(null);
    setCustomLabels([...customLabels, label]);
    setDraftLabel("");
  }

  async function save() {
    setBusy(true);
    setError(null);
    const clauseCodes = templates.filter((t) => selected.has(t.id)).map((t) => t.code);
    const res = await fetch(`/api/tiers/${tier.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        priceMonthlyPence: pricePence,
        isRecommended,
        clauseCodes,
        customLabels,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json();
      if (data.error === "blocked_wording") {
        setBlocked({ explanation: data.explanation, suggestion: data.suggestion });
      } else {
        setError(data.error ?? "Could not save.");
      }
      return;
    }
    router.push("/plans");
    router.refresh();
  }

  return (
    <>
      <Card>
        <div className="flex justify-between items-center gap-2 mb-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="font-semibold text-sm bg-transparent outline-none border-b border-line-soft flex-1"
          />
          <label className="flex items-center gap-1.5 text-xs text-muted whitespace-nowrap">
            <input
              type="checkbox"
              checked={isRecommended}
              onChange={(e) => setIsRecommended(e.target.checked)}
            />
            &ldquo;Most chosen&rdquo;
          </label>
        </div>
        <div className="flex justify-between items-center border border-line rounded-[10px] px-3 py-2">
          <span className="text-sm">Monthly price</span>
          <span className="font-mono font-semibold">
            £
            <input
              value={pounds}
              onChange={(e) => setPounds(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              className="w-16 bg-transparent outline-none text-right"
            />
          </span>
        </div>
        <div className="flex justify-between items-center gap-2 mt-2">
          <Micro>Suggested from what you&apos;ve ticked</Micro>
          <button
            onClick={() => setPounds((suggestedPence / 100).toFixed(2))}
            disabled={suggestedPence === pricePence}
            className="font-mono text-xs font-semibold text-flame-deep disabled:text-faint"
          >
            £{(suggestedPence / 100).toFixed(2)}/mo
            {suggestedPence !== pricePence && " — apply"}
          </button>
        </div>
      </Card>

      {grouped.map(({ category, items }) => (
        <Card key={category}>
          <Micro className="mb-1">{category}</Micro>
          {items.map((t) => (
            <button
              key={t.id}
              onClick={() => toggle(t.id)}
              className="w-full flex justify-between items-center gap-2 py-2.5 border-b border-line-soft last:border-b-0 text-sm text-left"
            >
              <span className={selected.has(t.id) ? "" : "text-faint"}>
                <span className={`font-bold mr-1.5 ${selected.has(t.id) ? "text-ok" : "text-line"}`}>
                  {selected.has(t.id) ? "✓" : "○"}
                </span>
                {t.title}
                {t.highlight && (
                  <span className="ml-1.5 align-middle">
                    <Pill tone="info">KEEPS THEM</Pill>
                  </span>
                )}
              </span>
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="font-mono text-[11px] text-muted">{upliftLabel(t)}</span>
                {t.kind === "CORE" && <Pill tone="ok">CORE</Pill>}
              </span>
            </button>
          ))}
        </Card>
      ))}

      <Card>
        <Micro className="mb-1">Your own lines (display only)</Micro>
        {customLabels.map((label, i) => (
          <div
            key={i}
            className="flex justify-between items-center gap-2 py-2 border-b border-line-soft text-sm"
          >
            <span>
              <span className="text-ok font-bold mr-1.5">✓</span>
              {label}
            </span>
            <button
              onClick={() => setCustomLabels(customLabels.filter((_, j) => j !== i))}
              className="text-faint text-xs"
            >
              remove
            </button>
          </div>
        ))}
        <div className="flex gap-2 mt-2">
          <input
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            placeholder="Add your own line (display only)"
            className="flex-1 border border-line rounded-[10px] px-3 py-2 text-sm bg-paper"
          />
          <button onClick={addLabel} className="text-flame-deep font-semibold text-sm px-2">
            Add
          </button>
        </div>
        <p className="text-[11px] text-faint mt-2">
          Shown on your customer page only. Never added to the legal plan document — that
          assembles from approved clauses alone.
        </p>
      </Card>

      {blocked && (
        <Card className="border-danger-tint bg-danger-tint/40">
          <div className="flex justify-between items-start gap-2">
            <p className="text-xs text-[#8F2323]">
              <Pill tone="off">BLOCKED</Pill>
              <span className="block mt-1.5">{blocked.explanation}</span>
              <span className="block mt-1.5">
                Nearest approved clause: <b>{blocked.suggestion.title}</b> — tick it in the list
                above instead.
              </span>
            </p>
          </div>
        </Card>
      )}

      <Card className="bg-flame-tint border-[#BBDCF4]">
        <p className="text-xs text-flame-deep">
          <b>Legal wording locked in.</b> Your plan document assembles only from
          solicitor-approved maintenance-and-priority clauses. Breakdown-repair promises are
          insurance — TradeSura keeps you on the right side of the line automatically.
        </p>
      </Card>

      <Card>
        <div className="flex justify-between items-center py-1.5 text-sm">
          <span>Est. take-home per customer</span>
          <b className="font-mono text-copper">£{((pricePence - fee) / 100).toFixed(2)}/mo</b>
        </div>
        <div className="flex justify-between items-center py-1.5 text-sm border-t border-line-soft">
          <span>TradeSura fee (20%)</span>
          <span className="font-mono">£{(fee / 100).toFixed(2)}/mo</span>
        </div>
        <p className="text-[11px] text-faint mt-1">
          Direct Debit costs are charged by the payment provider on their standard terms.
        </p>
      </Card>

      {error && <p className="text-sm text-danger px-1">{error}</p>}
      <button onClick={save} disabled={busy || selected.size === 0} className={btnClass()}>
        {busy ? "Saving…" : "Save tier"}
      </button>
    </>
  );
}
