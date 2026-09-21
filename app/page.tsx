"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import CursorGlow from "@/components/cursor-glow";

// Same language law as the mobile app's welcome screen (app/assets/TradeSura_Welcome_Screen_W0.html
// §1): never "insurance", "cover", "protection", "warranty", "doorstep" in customer-facing copy.
// This page is public-facing, so it follows the same rule.

const STEPS = [
  {
    n: "01",
    title: "Build your plan",
    body: "Pick your services and set a price. Templates get you live in minutes, or build your own from scratch.",
  },
  {
    n: "02",
    title: "Offer it at the end of the job",
    body: "Send a link. Your customer picks a tier and signs up in under two minutes, on their own phone.",
  },
  {
    n: "03",
    title: "Get paid every month",
    body: "We collect the Direct Debit and pay you out every week. No chasing, no invoices.",
  },
];

const VALUE_PROPS = [
  {
    title: "Recurring income you can see",
    body: "One dashboard showing exactly what's coming in, every month, from every customer on a plan.",
  },
  {
    title: "Gas Safe verified, on every plan",
    body: "Your registration is checked once and shown to every customer before they sign up.",
  },
  {
    title: "Plan wording you don't have to think about",
    body: "Every plan is built from pre-approved service descriptions, so what you sell stays clear and consistent.",
  },
  {
    title: "Cancel anytime, both ways",
    body: "Customers can leave in two taps, and so can you. No lock-in, no small print.",
  },
];

function StoreBadge({ label, sub, icon }: { label: string; sub: string; icon: React.ReactNode }) {
  return (
    <span
      aria-disabled="true"
      title="Coming soon"
      className="reveal flex cursor-not-allowed items-center gap-3 rounded-xl border border-line-strong bg-paper px-5 py-2.5 opacity-50"
    >
      {icon}
      <span className="text-left leading-tight">
        <span className="block text-[10px] uppercase tracking-wide text-faint">{sub}</span>
        <span className="block text-sm font-semibold text-ink">{label}</span>
      </span>
    </span>
  );
}

export default function HomePage() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const mm = gsap.matchMedia();

    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const ctx = gsap.context(() => {
        gsap.fromTo(
          ".hero-fade",
          { y: 16, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.7, ease: "power2.out", stagger: 0.09, delay: 0.1 },
        );

        gsap.utils.toArray<HTMLElement>(".reveal").forEach((el) => {
          gsap.fromTo(
            el,
            { y: 28, opacity: 0 },
            {
              y: 0,
              opacity: 1,
              duration: 0.6,
              ease: "power2.out",
              scrollTrigger: { trigger: el, start: "top 88%" },
            },
          );
        });
      }, root);

      return () => ctx.revert();
    });

    return () => mm.revert();
  }, []);

  return (
    <div ref={root} className="flex min-h-full flex-col bg-black text-ink">
      <CursorGlow />
      <main className="flex-1">
        {/* Hero */}
        <section className="relative flex min-h-[92vh] flex-col items-center justify-center overflow-hidden px-6 py-24 text-center">
          <div className="relative flex flex-col items-center gap-6">
            <Image
              src="/brand/lockup.png"
              alt="TradeSura"
              width={340}
              height={72}
              priority
              className="hero-fade h-auto w-[240px] sm:w-[320px]"
            />
            <p className="hero-fade text-lg font-semibold text-flame sm:text-xl">Your trade. On plan.</p>
            <h1 className="hero-fade max-w-2xl text-3xl font-bold leading-tight sm:text-5xl">
              Your customers, paying you <span className="text-ok">every month.</span>
            </h1>
            <p className="hero-fade max-w-md text-sm text-muted sm:text-base">
              Build your own care plans, offer them at the end of the job, and get paid by
              Direct Debit — automatically, every month.
            </p>

            <div className="hero-fade mt-2 flex gap-3 rounded-2xl border border-line bg-panel/40 px-2 py-2 text-xs sm:text-sm">
              <div className="px-4 py-1 text-center">
                <span className="block font-mono text-lg font-semibold text-ink">Free</span>
                <span className="block text-[11px] uppercase tracking-wide text-faint">account</span>
              </div>
              <div className="w-px bg-line" />
              <div className="px-4 py-1 text-center">
                <span className="block font-mono text-lg font-semibold text-ok">80%</span>
                <span className="block text-[11px] uppercase tracking-wide text-faint">you keep</span>
              </div>
              <div className="w-px bg-line" />
              <div className="px-4 py-1 text-center">
                <span className="block font-mono text-lg font-semibold text-ink">Weekly</span>
                <span className="block text-[11px] uppercase tracking-wide text-faint">payouts</span>
              </div>
            </div>

            <div className="hero-fade mt-4 flex flex-col items-center gap-3 sm:flex-row">
              <StoreBadge
                label="App Store"
                sub="Download on the"
                icon={
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" className="text-ink">
                    <path d="M16.365 1.43c0 1.14-.462 2.238-1.213 3.05-.83.897-2.18 1.583-3.29 1.494-.14-1.1.42-2.26 1.19-3.02.85-.86 2.29-1.5 3.31-1.524zM20.5 17.02c-.53 1.22-.78 1.76-1.46 2.83-.95 1.49-2.29 3.35-3.95 3.36-1.47.02-1.85-.96-3.84-.95-1.99.01-2.41.97-3.88.95-1.66-.02-2.93-1.69-3.88-3.18C1 16.68.6 12.5 2.14 9.98c1.02-1.68 2.63-2.67 4.13-2.67 1.53 0 2.5.97 3.77.97 1.24 0 1.99-.97 3.77-.97 1.31 0 2.7.72 3.7 1.95-3.24 1.78-2.72 6.42.99 7.76z" />
                  </svg>
                }
              />
              <StoreBadge
                label="Google Play"
                sub="Get it on"
                icon={
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-ink">
                    <path d="M3.6 2.3c-.4.3-.6.8-.6 1.4v16.6c0 .6.2 1.1.6 1.4l.1.1L13.4 12 3.7 2.2l-.1.1z" fill="#5FA3F0" />
                    <path d="M16.7 15.3l-3.3-3.3 3.3-3.3 4 2.3c.7.4.7 1.6 0 2l-4 2.3z" fill="#3DD68C" />
                    <path d="M13.4 12 3.7 21.8c.4.4 1.1.5 1.8.1l11.2-6.3-3.3-3.6z" fill="#F2B84B" />
                    <path d="M13.4 12l3.3-3.6L5.5 2.1c-.7-.4-1.4-.3-1.8.1L13.4 12z" fill="#FF6B6B" />
                  </svg>
                }
              />
            </div>
            <p className="hero-fade text-[11px] uppercase tracking-wide text-faint">
              Gas Safe verified members · No card required
            </p>
          </div>
        </section>

        {/* How it works */}
        <section className="border-t border-line px-6 py-24">
          <div className="mx-auto max-w-5xl">
            <p className="reveal text-center text-xs font-semibold uppercase tracking-widest text-flame">
              How it works
            </p>
            <h2 className="reveal mt-3 text-center text-2xl font-bold sm:text-3xl">
              From service call to standing order
            </h2>
            <div className="mt-14 grid gap-8 sm:grid-cols-3">
              {STEPS.map((s) => (
                <div key={s.n} className="reveal rounded-2xl border border-line bg-panel/40 p-6">
                  <span className="font-mono text-sm text-faint">{s.n}</span>
                  <h3 className="mt-3 text-lg font-semibold text-ink">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Value props */}
        <section className="border-t border-line px-6 py-24">
          <div className="mx-auto max-w-5xl">
            <p className="reveal text-center text-xs font-semibold uppercase tracking-widest text-flame">
              Why engineers use it
            </p>
            <h2 className="reveal mt-3 text-center text-2xl font-bold sm:text-3xl">
              Built around the job, not a spreadsheet
            </h2>
            <div className="mt-14 grid gap-6 sm:grid-cols-2">
              {VALUE_PROPS.map((v) => (
                <div key={v.title} className="reveal rounded-2xl border border-line bg-panel/40 p-6">
                  <h3 className="text-base font-semibold text-ink">{v.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{v.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Founder */}
        <section className="border-t border-line px-6 py-24 text-center">
          <div className="reveal mx-auto max-w-lg">
            <p className="text-sm text-muted">
              Founded by <span className="font-semibold text-ink">Matt Wood</span> — 13 years in
              the UK boiler and heating industry.
            </p>
          </div>
        </section>

        {/* Final CTA */}
        <section className="border-t border-line px-6 py-24 text-center">
          <div className="reveal mx-auto flex max-w-lg flex-col items-center gap-6">
            <span className="rounded-full border border-line-strong px-6 py-3 text-xs font-semibold tracking-wide text-ink">
              LAUNCHING SOON
            </span>
            <p className="text-sm text-muted">
              The care-plan platform for UK trade engineers. We&apos;re building something for
              the trades — and the homes they look after.
            </p>
          </div>
        </section>
      </main>

      <footer className="relative border-t border-line px-6 py-4 text-xs text-faint">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-ink">TradeSura.com</span>
          <span>© 2026 TradeSura Ltd · info@tradesura.com</span>
        </div>
        <p className="mt-2 text-center text-[11px] text-faint/80 sm:text-left">
          TradeSura Ltd · Registered in England &amp; Wales, Company No. 17325346 · Registered
          office: Unit A3, Gateway Tower, 32 Western Gateway, London E16 1YL
        </p>
      </footer>
    </div>
  );
}
