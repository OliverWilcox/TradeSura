# v2 Dark reskin + Build Review 1 + W0 Welcome — plan

Covers the three documents handed over on 3 Sept 2026:

1. **W0 Welcome** — one new mobile screen + states + telemetry
2. **Screen Designs v2 · Full Dark** — replace the design system (light TS‑Blue → navy dark), reskin every screen incl. customer web
3. **Build Review 1** — 23‑item fix list (4×P0, 10×P1, 5×P2, 4×Q)

**Decision taken this session (human, Oliver):** dark v2 supersedes the
2026‑08‑28 "Build Spec v1 §1 light chrome" decision. It becomes the design
system, no light variant. CLAUDE.md's `[DECISION 2026-08-28]` line gets
rewritten as part of Block E.

---

## Where the tree is right now

The working tree has ~101 uncommitted files: the whole **GoCardless → Stripe
Connect migration**, plus most of the Build Review 1 P1 response already done,
plus Block‑2/3 work (referrals, blast, claim, telemetry) from
`build-spec-v1-plan.md`. It typechecks. **Nothing is committed** — Block A
commits it before anything else so we're not building on a 100‑file base.

What's already done in the tree (verified by reading):

| Build Review item | State in tree |
|---|---|
| #1 plan builder reachable | Entry from Getting Started + `(tabs)/plans` list + `POST /api/tiers`; builder screen `tier/[tierId].tsx` exists. **Needs:** "My plans" row in More, resumable wizard check, tappable prompts. |
| #2 Stripe Connect | `lib/stripe.ts` full: Express onboarding, destination‑charge subs, 20% app fee, payout summary, webhooks. **Needs:** sandbox keys (human) + end‑to‑end verify. |
| #3 customer plan page + checkout | `app/p/[slug]/page.tsx`, `/signup/[token]`, `/confirmed`, `app/portal/**` all exist. **Needs:** verify against sandbox, terms version on subscription, mandate‑pending copy audit. |
| #4 profile persistence | `/api/me` returns everything; More renders it. **Needs:** confirm signup writes it all; dashboard greeting already `Hello, {firstName}`. |
| #7 £NaN | `/api/dashboard` is null‑safe (`nextPayoutPence` guarded). **Needs:** sweep other money renders for `/100` on `undefined`. |
| #12 referral field + attribution | Done in `sign-up.tsx` (referral code field, claim resolve, hide chips on claim/referral). **Needs:** verify attribution lands in every path. |
| #6 referral screen | `mobile/app/referral.tsx` + `/api/referral` + `/r/[slug]` + share card + £50 transfer exist. **Needs:** verify "Something went wrong" is gone. |
| Customer web pages | All exist and are token‑based; currently light. |

Still clearly open: **#5 doorstep** (`(tabs)/index.tsx:96`, `signup/choose`,
`customer/[id].tsx`), **#15 logo upload** (still a URL text field in More),
**#17 dev queue panel** (visible in More, no prod guard), **#8 signup timer**,
**#9 customers list status/button labels**, **#10 import consent checkbox**,
**#11 Gas Safe live vs stub**, **#13 duplicate Gas Safe guard**, **#19 empty
states**, and the whole **dark reskin** (tokens are still light) and **W0**
(no `welcome.tsx`, no routing gate for it).

---

## Not mine to do — human‑blocked

| # | Blocker | Impact |
|---|---|---|
| B‑1 | **Stripe sandbox keys.** `.env` has no `sk_test_…`; still GC vars. Needs `vercel integration add stripe` (Marketplace) + `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` + `STRIPE_WEBHOOK_SECRET`. | Blocks all P0 money‑loop **verification**. I can build/wire against the code; I can't prove the fee split or run the loop without keys. |
| B‑2 | **Live Gas Safe Register API** + credentials (#11). | Ships as CSV‑lookup stub with the 3 states (verified / mismatch+manual / register‑down+pending) until wired. |
| B‑3 | **Solicitor terms wording** (#18), targeted 8 Sept. | Checkout terms checkbox needs a versioned doc behind it before the first real customer. I'll build the versioning + placeholder. |
| B‑4 | **W0 background photograph** (2 crops). | Ship the navy gradient + grid placeholder — the spec explicitly allows this. |
| B‑5 | **Device / TestFlight run‑through** for Friday acceptance. | I can't run the Expo app or Stripe sandbox end‑to‑end; you/Matt drive that. |
| B‑6 | **Android / PWA fallback plan** (#23). | Decision only — see Q4. |

---

## Open questions — need your answer (don't block Block A/E)

1. **#20 "Offer campaign"** in More — what is it? `build-spec-v1-plan.md` says
   E8 blast lives under Customers → Import. If "Offer campaign" is that,
   rename + move it there. If it's new, park it. *(My default: it's the E8
   blast, relabel and nest it.)*
2. **#21 "Trades & TradePacks"** — CLAUDE.md 2026‑08‑03 restored this to mobile
   scope, but Review flags it as not‑in‑spec. Keep as‑is, or fold TradePacks
   into wizard step 4 + Settings and drop the standalone screen? *(Default:
   keep, it's a live [DECISION].)*
3. **#22 "Messages & tickets"** — CLAUDE.md keeps this in scope specifically for
   engineer visibility of the gas‑emergency interlock firing. Confirm it stays.
   *(Default: stays.)*
4. **#23 native vs PWA / Android.** App Store reg is done, customer pages are
   web. What's the Android story before pilot — Expo Android build, or PWA
   fallback? Affects nothing in these blocks; needed for pilot.
5. **CLAUDE.md scope drift:** the 2026‑08‑03 line still lists campaigns +
   referrals as out‑of‑scope/stubbed, but `build-spec-v1-plan.md` moved them
   in and the code exists. I'll update the CLAUDE.md scope fence to match
   reality as part of Block A — flag if that's wrong.
6. **W0 copy:** spec says ship variant **A** ("Your customers, paying you every
   month."). Confirm — B/C are A/B‑later.

---

## The blocks

Each block ends with: typecheck + lint + tests green, and a
`docs/demo-*.md` runnable proof. Plan‑before‑code per CLAUDE.md — I'll post
the task list for a block and get your nod before building it.

### Block A — commit WIP + audit  ·  ~0.5 day  ·  no blockers
- Commit the uncommitted migration as logical commits (schema/prisma, Stripe
  lib + routes, GC removal, mobile API swap, Block‑2/3 work).
- Update CLAUDE.md scope fence for the campaigns/referrals drift (Q5).
- Produce `docs/build-review-1-audit.md`: each of the 23 items → done /
  partial / open, with file refs. This is the source of truth for Blocks B–C
  and H.
- **Done means:** clean `git status`, audit table published.

### Block B — Build Review P0: money loop  ·  ~1.5–2 days  ·  needs B‑1
- #1: "My plans" row in More; make Getting Started prompts on Offer / Show‑a‑
  customer tappable; wizard resumable from dashboard until all 4 steps done.
- #2: verify Express onboarding completes in sandbox for sole‑trader **and**
  ltd paths; prove £12 → ~32p Bacs fee → £9.60 to engineer via
  `application_fee_amount` destination charge → Friday payout schedule. Encode
  the assertion in `tests/stripe.test.ts`.
- #3: customer page + checkout against sandbox; record terms version on the
  subscription; audit mandate‑pending copy ("2–3 working days"); C3
  confirmation + welcome SMS/email + engineer ping.
- #4: confirm verified status / trading name / business type / postcode /
  initials all land on the account from signup and drive the dashboard.
- **Done means:** `docs/demo-money-loop.md` — signup → Stripe Express →
  plan live → second phone joins → checkout → dashboard shows 1 plan,
  £12/mo, ON PLAN, no NaN. *(Runs once you supply B‑1; I'll stub‑verify
  everything up to the Stripe network calls.)*

### Block C — Build Review P1: law + spec  ·  ~1.5 days  ·  B‑2/B‑3 partial
- #5 **doorstep** — grep the banned list codebase‑wide
  (`insurance|cover(ed)|protection|warranty|guarantee (of repair)|doorstep`),
  replace with "at the end of the job"; add a lint test asserting the list is
  absent from `mobile/` + `app/` + `components/` + `lib/` user‑facing strings.
- #7 £NaN — null‑safe every money render; empty → "—" / "Nothing yet".
- #8 signup timer — hide until real data; `mm:ss` formatter when shown.
- #9 customers list — status line + `Offer`/`Re-offer` label logic + sort
  (never‑offered → stale >7d → newest).
- #10 import consent — own‑customers checkbox as its own card, blocks send,
  timestamp on the import record (PECR basis).
- #11 Gas Safe — 3 states (verified card / amber mismatch + manual‑review
  escape / register‑down + "verification pending"); live call behind a flag,
  CSV stub as fallback (B‑2).
- #13 duplicate Gas Safe number — "already registered — sign in instead?".
- #6 referral — confirm backend wired, remove any error state.
- #12 — attribution lands on the account in every arrival path (organic /
  claim / claim‑failed / referral); verify silently.
- #10/#18 — terms versioning scaffold + placeholder doc (B‑3).
- **Done means:** `docs/demo-compliance.md` — banned‑word test green, the 3
  Gas Safe states, consent gate, dup‑licence guard all demoed.

### Block D — W0 Welcome screen  ·  ~0.5–1 day  ·  built dark from the start
- `mobile/app/welcome.tsx` + routing gate in `_layout.tsx` /
  `auth-context` (signed‑in → skip to dashboard/wizard; signed‑out → W0;
  signed‑out‑returning → Sign‑in promoted).
- States: organic / claim (`/claim?code=`) / referral (`/r/{slug}`) /
  returning / offline notice / suppressed claim code → generic.
- Attribution carried into signup **losslessly** (letter batch + variant
  cell). Reuse `/api/claim/resolve`.
- Motion: bg 1.00→1.03/8s loop, staggered fade‑rise <500ms, haptic on
  primary, all off under reduced‑motion.
- Telemetry: `welcome_viewed{source}` · `welcome_start_tapped` ·
  `welcome_signin_tapped` · `welcome_dismissed`.
- Copy variant **A** (pending Q6). Gradient placeholder background (B‑4).
- **Done means:** `docs/demo-w0.md` — fresh install → W0 <1.5s no splash;
  signed‑in skips it; claim/referral personalise + carry attribution; both
  buttons ≥44px, primary ≥56px.

### Block E — Dark v2: tokens + shared components  ·  ~1 day  ·  no blockers
- Rewrite `app/globals.css` `@theme` and `mobile/tailwind.config.js` to the
  v2 navy palette (keep them in sync per CLAUDE.md):
  - `bg #0B1A2E` · `bg-deep #081321` · `surface #122540` ·
    `surface-2 #193150` · hero gradient `#1A3A66 → #122540`
  - `money #3DD68C` · `blue #5FA3F0` · `amber #F2B84B` · `red #FF6B6B`
  - `text #F3F7FB` · `muted #9FB6D0` · `dim #6E86A3`
  - lines white 10% / 18%; radius 16 / 14 / 12
  - Map the existing semantic keys onto v2 (`flame`→blue, `copper`/`ok`→
    money, `panel`/`iron`→surfaces) so screens don't all churn at once;
    retire the `night*` alias set.
- Rework `mobile/components/ui.tsx` + `components/ui.tsx`: Card (surface +
  10% line), Button (white primary w/ shadow, ghost outline, green only for
  Join + WhatsApp), frosted chip, hero‑gradient card, dark status bar
  (`app.json` + per‑screen), Money with count‑up, disabled = 40% opacity.
- Rewrite the CLAUDE.md `[DECISION 2026-08-28]` line to v2.
- **Done means:** `docs/demo-reskin.md` updated; the shared components render
  dark; app boots with dark status bar.

### Block F — Dark v2: engineer app screens  ·  ~1.5 days  ·  after B/C/D/E
Screen‑by‑screen against the v2 mockups (E1–E12, E11b):
sign‑up, sign‑in, onboarding/getting‑started, dashboard (hero gradient money
card + amber missed‑money + white FAB), send‑offer, demo mode (in‑app full
screen + ribbon, #16), plan builder (earnings preview = hero), customers +
customer detail, import & blast, reminders, referrals (hero £50 + white QR
card), payouts (hero next‑payout + breakdown), **first‑payout celebration
(E11b, new)**, settings ("My plans" first). Motion: fade+8px rise 220ms,
count‑up money, haptics, reduced‑motion off.
- **Done means:** every engineer screen matches the v2 mockup; screenshots in
  `docs/screenshots/`.

### Block G — Dark v2: customer web  ·  ~0.5 day  ·  after E
- `app/p/[slug]/page.tsx`, `/signup/[token]`, `/confirmed`, `app/portal/**`,
  `app/claim/page.tsx`, `app/r/[slug]/page.tsx` → dark (C1–C5 mockups).
- Green Join / Confirm is the only green button; DD Guarantee in blue‑tint;
  inputs one step lighter than cards; not‑insurance + DD Guarantee + Powered
  by TradeSura footer; emergency line in footer of every customer page.
- **Done means:** customer flow renders dark end‑to‑end; interlock + footer
  intact.

### Block H — P2 + Q resolutions + telemetry  ·  ~1 day
- #15 logo **upload** (image picker → stored our side, served from us) —
  replaces the URL field.
- #16 demo mode in‑app full‑screen + ✕ ribbon (done visually in F; wire here).
- #17 hide dev message‑queue panel in production builds.
- #14 Plumbing trade tile (SOON).
- #19 empty states (E3: "£0/month — your first plan changes this"; missed‑
  money only ≥5 non‑plan contacts).
- #18 terms doc — drop in solicitor wording when it lands (B‑3).
- Q20/Q21/Q22 — apply your answers.
- Telemetry sweep: the `build-spec-v1-plan.md` S4 event taxonomy +
  `welcome_*` — assert every flow fires its event.
- **Done means:** all 23 items closed or explicitly parked with reason.

### Block I — close‑out  ·  ~0.5 day
- Full typecheck + lint + `vitest` green, both packages.
- `docs/demo-full-build.md` refreshed to the v2 + money‑loop reality.
- Friday‑acceptance checklist from Build Review §5 walked (as far as
  no‑device allows), gaps listed for you/Matt.

---

## Rough total

~8–9 working days of build. Blocks A, C, D, E, H, I need nothing from anyone.
Blocks B, F, G and the Friday acceptance need B‑1 (Stripe keys) and a device.
If B‑1 is slow, order is **A → C → D → E → F → G → H**, with B slotted in the
moment keys land, and I stub‑verify the money loop meanwhile.

## Risks

- **The uncommitted base.** One bad rebase loses a lot. Block A first, no
  exceptions.
- **Reskin churn vs. fixes.** Doing F before C would mean restyling screens
  whose structure then changes. Fixes (B/C) before paint (F/G) — the v2 doc
  agrees ("logic and flows unchanged").
- **Two token files drift** (`globals.css` / `tailwind.config.js`). Block E
  changes both together; add a check.
- **Money‑loop verification is the real deliverable** and it's gated on B‑1.
  Everything else can look done and the loop still be broken — same trap
  Build Review 1 called out.
