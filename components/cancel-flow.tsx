"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { JOIN_BTN } from "@/components/plan-tier-card";
import { perMonth } from "@/lib/engineer";
import { CANCEL_REASONS, offerForReason, pounds, type BeforeYouGo, type CancelReason } from "@/lib/retention";

// Retention spec, section 2 — three short screens from the manage link:
// 1. why are you leaving, 2. one tailored offer, 3. "Before you go". The
// rule that matters most: "Cancel anyway" is on every screen and goes
// straight through. Two taps from the portal ("Manage or cancel plan",
// then "Cancel anyway"), never blocked or delayed.

const CARD = "rounded-2xl bg-white p-4 text-[#0B1A2E]";
const MUTED = "text-[#5B6B82]";
const SECONDARY =
  "block w-full text-center font-semibold rounded-[10px] px-4 py-3 text-[15px] bg-white text-[#1F5FC4] border-[1.5px] border-[#1F5FC4] disabled:opacity-50";
const CANCEL_BTN =
  "block w-full text-center font-semibold rounded-[10px] px-4 py-3 text-[15px] bg-transparent text-white border-[1.5px] border-white/55 disabled:opacity-50";

type Cheaper = { id: string; name: string; priceMonthlyPence: number; savingPence: number; lines?: string[] };

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

function Ticks({ lines }: { lines: string[] }) {
  return (
    <ul className="mt-2 space-y-1.5">
      {lines.map((l) => (
        <li key={l} className="flex gap-2.5 text-[14px]">
          <span aria-hidden className="text-[#1F5FC4] font-bold">
            ✓
          </span>
          <span>{l}</span>
        </li>
      ))}
    </ul>
  );
}

function Step({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <div>
      <p className="font-mono text-[10px] tracking-[0.1em] uppercase text-faint">Step {n} of 3</p>
      <h1 className="text-[22px] font-bold leading-tight mt-1">{title}</h1>
      {children}
    </div>
  );
}

export function CancelFlow(props: {
  token: string;
  status: string;
  brand: string;
  firstName: string;
  tierName: string;
  priceMonthlyPence: number;
  vatRegistered?: boolean;
  endingOn: string | null;
  pausedUntil: string | null;
  includes: string[];
  serviceDue: string | null;
  cheaper: Cheaper | null;
  switchOffer: boolean;
  figures: BeforeYouGo;
  passportLine: string | null;
  warrantyLine: string;
}) {
  type View = "reason" | "offer" | "before" | "ended" | "ending" | "kept" | "paused" | "switched" | "switch";
  const initial: View =
    props.status === "CANCELLED"
      ? "ended"
      : props.switchOffer && props.cheaper
        ? "switch"
        : props.endingOn
          ? "ending"
          : "reason";
  const [view, setView] = useState<View>(initial);
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [endingOn, setEndingOn] = useState<string | null>(props.endingOn);
  const [pausedUntil, setPausedUntil] = useState<string | null>(props.pausedUntil);
  const [moveDate, setMoveDate] = useState("");
  const [postcode, setPostcode] = useState("");
  const [passportConsent, setPassportConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const offer = reason
    ? offerForReason(reason, {
        currentPricePence: props.priceMonthlyPence,
        currentTierId: null,
        liveTiers: props.cheaper ? [props.cheaper] : [],
      })
    : null;
  const offerCode =
    offer?.kind === "cheaper_plan" ? "cheaper_plan" : offer?.kind === "move_plan" ? "move_plan" : offer?.kind ?? null;

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/${props.token}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Try again.");
        return null;
      }
      return data as { effectiveAt?: string; resumesAt?: string; endedNow?: boolean };
    } catch {
      setError("Couldn't reach us. Check your connection and try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function cancelAnyway() {
    const data = await post({
      action: "cancel",
      reason: reason ?? "other",
      offer: offerCode,
      ...(reason === "moving" && moveDate ? { moveDate } : {}),
      ...(reason === "moving" ? { passportConsent } : {}),
    });
    if (data) {
      setEndingOn(data.effectiveAt ?? null);
      setView(data.endedNow ? "ended" : "ending");
    }
  }

  async function keep() {
    if (await post({ action: "keep", reason: reason ?? undefined, offer: offerCode })) setView("kept");
  }

  async function pause(months: 1 | 2) {
    const data = await post({ action: "pause", reason: reason ?? undefined, months });
    if (data) {
      setPausedUntil(data.resumesAt ?? null);
      setView("paused");
    }
  }

  async function switchTier() {
    if (!props.cheaper) return;
    if (await post({ action: "switch", reason: reason ?? undefined, tierId: props.cheaper.id })) setView("switched");
  }

  async function move() {
    const data = await post({
      action: "move",
      postcode,
      ...(moveDate ? { moveDate } : {}),
      passportConsent,
    });
    if (data) setView("kept");
  }

  async function undo() {
    if (await post({ action: "undo" })) {
      setEndingOn(null);
      setView("kept");
    }
  }

  // Always on screen, never behind another page.
  const cancelAnywayBtn = (
    <button onClick={cancelAnyway} disabled={busy} className={CANCEL_BTN}>
      {busy ? "Please wait…" : "Cancel anyway"}
    </button>
  );
  const errorLine = error && <p className="text-sm text-danger text-center">{error}</p>;
  const price = (p: number) => perMonth(pounds(p), props.vatRegistered);
  const backToPlan = (
    <Link href={`/portal/${props.token}`} className={SECONDARY}>
      Back to my plan
    </Link>
  );

  if (view === "ended") {
    return (
      <>
        <div className={`${CARD} text-center`}>
          <p className="font-semibold">This plan has ended</p>
          <p className={`text-[13px] mt-1 ${MUTED}`}>
            No more payments will be taken. We&apos;ve emailed you to confirm. Changed your mind? Ask {props.brand} to
            send you a new signup link.
          </p>
        </div>
        {backToPlan}
      </>
    );
  }

  if (view === "ending" && endingOn) {
    return (
      <>
        <div className={`${CARD} text-center`}>
          <p className="font-semibold text-[17px]">Your plan ends on {longDate(endingOn)}</p>
          <p className={`text-[13px] mt-1.5 ${MUTED}`}>
            That&apos;s the end of the month you&apos;ve paid for. Everything carries on as normal until then, and no more
            payments are taken after it. We&apos;ve emailed you to confirm.
          </p>
        </div>
        {errorLine}
        <button onClick={undo} disabled={busy} className={JOIN_BTN}>
          Changed your mind? Keep my plan
        </button>
        {backToPlan}
      </>
    );
  }

  if (view === "kept" || view === "paused" || view === "switched") {
    return (
      <>
        <div className={`${CARD} text-center`}>
          <p className="font-semibold text-[17px]">
            {view === "paused" && pausedUntil
              ? `Paused until ${longDate(pausedUntil)}`
              : view === "switched" && props.cheaper
                ? `You're now on ${props.cheaper.name}`
                : "Your plan carries on"}
          </p>
          <p className={`text-[13px] mt-1.5 ${MUTED}`}>
            {view === "paused"
              ? "No payments are taken and plan benefits are on hold while it's paused. It restarts on its own on that date."
              : view === "switched" && props.cheaper
                ? `${price(props.cheaper.priceMonthlyPence)} from your next payment.`
                : `Thanks for staying with ${props.brand}.`}
          </p>
        </div>
        {backToPlan}
      </>
    );
  }

  // The engineer's "cheaper plan" text lands here.
  if (view === "switch" && props.cheaper) {
    return (
      <>
        <div className={CARD}>
          <h1 className="text-[20px] font-bold leading-tight">{props.brand} has a cheaper plan for you</h1>
          <p className="text-[21px] font-bold mt-3">{props.cheaper.name}</p>
          <p className="text-[15px]">{price(props.cheaper.priceMonthlyPence)}</p>
          {(props.cheaper.lines ?? []).length > 0 && (
                <ul className="mt-2 space-y-1">
                  {(props.cheaper.lines ?? []).map((l) => {
                    const [title, note] = l.split(" — ");
                    return (
                      <li key={l} className="flex gap-2 text-[14px]">
                        <span aria-hidden className="text-[#1F5FC4] font-bold">✓</span>
                        <span>
                          {title}
                          {note && <span className="block text-[12.5px] text-[#5B6B82]">{note}</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
          <p className={`text-[13px] mt-2 ${MUTED}`}>
            Save {pounds(props.cheaper.savingPence)} a month compared with your {props.tierName} plan.
          </p>
        </div>
        {errorLine}
        <button onClick={switchTier} disabled={busy} className={JOIN_BTN}>
          Switch to {pounds(props.cheaper.priceMonthlyPence)} a month
        </button>
        <Link href={`/portal/${props.token}`} className={SECONDARY}>
          {endingOn ? "No thanks" : "Keep my current plan"}
        </Link>
      </>
    );
  }

  if (view === "reason") {
    return (
      <>
        {pausedUntil && (
          <div className={`${CARD} text-center`}>
            <p className="font-semibold">Paused until {longDate(pausedUntil)}</p>
            <p className={`text-[13px] mt-1 ${MUTED}`}>No payments until then. It restarts on its own.</p>
          </div>
        )}
        <div className={CARD}>
          <Step n={1} title="Why are you leaving?" />
          <div className="mt-3 flex flex-col gap-2" role="radiogroup">
            {CANCEL_REASONS.map((r) => (
              <button
                key={r.code}
                role="radio"
                aria-checked={reason === r.code}
                onClick={() => setReason(r.code)}
                className={`text-left rounded-xl border-[1.5px] px-3.5 py-3 text-[15px] ${
                  reason === r.code ? "border-[#1F5FC4] bg-[#EAF2FD]" : "border-[#D5DDE8]"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        {errorLine}
        <button onClick={() => setView("offer")} disabled={!reason || busy} className={JOIN_BTN}>
          Continue
        </button>
        <Link href={`/portal/${props.token}`} className={SECONDARY}>
          Keep my plan
        </Link>
        {cancelAnywayBtn}
      </>
    );
  }

  if (view === "offer" && offer) {
    return (
      <>
        <div className={CARD}>
          {offer.kind === "cheaper_plan" && (
            <Step n={2} title={`${props.brand} has a cheaper plan for you`}>
              <p className="text-[21px] font-bold mt-3">{offer.tier.name}</p>
              <p className="text-[15px]">{price(offer.tier.priceMonthlyPence)}</p>
              {(offer.tier.lines ?? []).length > 0 && (
                <ul className="mt-2 space-y-1">
                  {(offer.tier.lines ?? []).map((l) => {
                    const [title, note] = l.split(" — ");
                    return (
                      <li key={l} className="flex gap-2 text-[14px]">
                        <span aria-hidden className="text-[#1F5FC4] font-bold">✓</span>
                        <span>
                          {title}
                          {note && <span className="block text-[12.5px] text-[#5B6B82]">{note}</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className={`text-[13px] mt-2 ${MUTED}`}>Save {pounds(offer.savingPence)} a month and stay with {props.brand}.</p>
            </Step>
          )}
          {offer.kind === "pause" && (
            <Step n={2} title="Take a break instead?">
              <p className={`text-[14px] mt-2 ${MUTED}`}>
                Pause your plan for 1 or 2 months. No payments are taken while it&apos;s paused, plan benefits are on hold,
                and it restarts on its own.
              </p>
            </Step>
          )}
          {offer.kind === "show_value" && (
            <Step n={2} title="Here's what's on your plan">
              <Ticks lines={props.includes} />
              {props.serviceDue && <p className={`text-[13px] mt-3 ${MUTED}`}>{props.serviceDue}</p>}
            </Step>
          )}
          {offer.kind === "move_plan" && (
            <Step n={2} title="Moving house?">
              <p className={`text-[14px] mt-2 ${MUTED}`}>
                If your new home is in {props.brand}&apos;s area, your plan can move with you.
              </p>
              <label className="block mt-3 text-[13px] font-semibold">
                When are you moving?
                <input
                  type="date"
                  value={moveDate}
                  onChange={(e) => setMoveDate(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-[#D5DDE8] px-3 py-2 text-[15px]"
                />
              </label>
              <label className="block mt-3 text-[13px] font-semibold">
                New postcode
                <input
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value)}
                  autoComplete="postal-code"
                  className="mt-1 block w-full rounded-lg border border-[#D5DDE8] px-3 py-2 text-[15px] uppercase"
                />
              </label>
              <p className={`text-[12px] mt-1 ${MUTED}`}>
                We check it against the postcodes {props.brand} covers.
              </p>
              {props.passportLine && (
                <label className="flex gap-2.5 items-start mt-3 text-[13px]">
                  <input
                    type="checkbox"
                    checked={passportConsent}
                    onChange={(e) => setPassportConsent(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>Pass this home&apos;s Home Passport (its service history) on to the next owner.</span>
                </label>
              )}
            </Step>
          )}
        </div>
        {errorLine}
        {offer.kind === "cheaper_plan" && (
          <>
            <button onClick={switchTier} disabled={busy} className={JOIN_BTN}>
              Switch to {pounds(offer.tier.priceMonthlyPence)} a month
            </button>
            <button onClick={() => pause(2)} disabled={busy} className={SECONDARY}>
              Pause for 2 months instead
            </button>
          </>
        )}
        {offer.kind === "pause" && (
          <>
            <button onClick={() => pause(1)} disabled={busy} className={JOIN_BTN}>
              Pause for 1 month
            </button>
            <button onClick={() => pause(2)} disabled={busy} className={SECONDARY}>
              Pause for 2 months
            </button>
          </>
        )}
        {offer.kind === "show_value" && (
          <button onClick={keep} disabled={busy} className={JOIN_BTN}>
            Keep my plan
          </button>
        )}
        {offer.kind === "move_plan" && (
          <button onClick={move} disabled={busy || postcode.trim().length < 5} className={JOIN_BTN}>
            Move my plan to my new home
          </button>
        )}
        <button onClick={() => setView("before")} disabled={busy} className={SECONDARY}>
          No thanks, continue
        </button>
        {cancelAnywayBtn}
      </>
    );
  }

  // Step 3 — Before you go.
  const f = props.figures;
  return (
    <>
      <div className={CARD}>
        <Step n={3} title={`Before you go, ${props.firstName}`}>
          <p className="text-[14px] mt-2">{f.paidLine}</p>
          {f.serviceLine && <p className="text-[14px] mt-2">{f.serviceLine}</p>}
          {f.loseLines.length > 0 && (
            <>
              <p className="text-[14px] font-semibold mt-3">You&apos;ll also lose:</p>
              <Ticks lines={f.loseLines} />
            </>
          )}
          {props.passportLine && <p className="text-[13px] mt-3">{props.passportLine}</p>}
          <p className={`text-[13px] mt-3 ${MUTED}`}>{props.warrantyLine}</p>
        </Step>
      </div>
      {errorLine}
      <button onClick={keep} disabled={busy} className={JOIN_BTN}>
        Keep my plan
      </button>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => pause(2)} disabled={busy} className={SECONDARY}>
          Pause 2 months
        </button>
        {props.cheaper ? (
          <button onClick={switchTier} disabled={busy} className={SECONDARY}>
            Cheaper plan
          </button>
        ) : (
          <button onClick={() => pause(1)} disabled={busy} className={SECONDARY}>
            Pause 1 month
          </button>
        )}
      </div>
      {cancelAnywayBtn}
      <p className="font-mono text-[10px] text-faint text-center">
        Your plan ends at the end of the month you&apos;ve paid for, and we email you to confirm.
      </p>
    </>
  );
}
