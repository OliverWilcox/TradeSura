"use client";

import { useEffect, useState, type RefObject } from "react";
import { JOIN_BTN } from "@/components/plan-tier-card";

// Matt 16 Nov — the plan page is a long scroll on a phone, so a "Join for
// £15 a month" bar sits at the bottom until the real Join section is on
// screen. It never joins by itself: it takes the customer to the same Join
// step (form, Pay monthly / yearly choice, the price-restating Join button),
// so the price is always seen before the mandate. Phones only (md:hidden).
export function StickyJoin({
  label,
  target,
  focus,
}: {
  label: string;
  /** The Join section it scrolls to; the bar hides while that's in view. */
  target: RefObject<HTMLElement | null>;
  /** Optional field to focus once there (e.g. first name). */
  focus?: RefObject<HTMLInputElement | null>;
}) {
  const [targetVisible, setTargetVisible] = useState(false);

  useEffect(() => {
    const el = target.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setTargetVisible(entry.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, [target]);

  function go() {
    target.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    // preventScroll so the focus doesn't cut the smooth scroll short.
    focus?.current?.focus({ preventScroll: true });
  }

  // Room at the very bottom of the page so the bar never hides the footer's gas
  // emergency line. A spacer div here sat mid-page, under Home Passport, as an
  // empty gap (QA 26 Nov), so the room goes on the body instead.
  useEffect(() => {
    const cls = ["pb-16", "md:pb-0"];
    document.body.classList.add(...cls);
    return () => document.body.classList.remove(...cls);
  }, []);

  return (
    <>
      <div
        className={`fixed inset-x-0 bottom-0 z-40 md:hidden transition-transform duration-200 ${
          targetVisible ? "translate-y-full" : "translate-y-0"
        }`}
        aria-hidden={targetVisible}
      >
        <div className="mx-auto max-w-md bg-panel/95 px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-line-soft backdrop-blur">
          <button type="button" onClick={go} tabIndex={targetVisible ? -1 : 0} className={JOIN_BTN}>
            {label}
          </button>
        </div>
      </div>
    </>
  );
}

