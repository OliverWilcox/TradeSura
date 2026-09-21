# Handoff — audit Build Guide v2 against the current build

Paste this into a new chat. The ask for that session: **read
`app/assets/TradeSura_Build_Guide_v2.html` part by part, and for each part,
actually check the current code — don't trust this document's claims, verify
them.** This file is a map of what a previous session believes it did, not
proof. Where a demo doc's "walk it" section can be turned into a real check
against the files (not just a description), do that.

## State of the repo — read this first

**Nothing in this list is committed.** It's all sitting in the working tree.
`git status` shows ~40 modified files, a dozen renamed mobile screens (the
`(tabs)/(home)/` and `(tabs)/(customers)/` route groups), and ~35 new
untracked files (new API routes, new mobile screens/components, three Prisma
migrations, and the `docs/demo-*-v2.md` files this list points to). Confirm
this is still true before doing anything — another session or the user may
have committed or changed things since.

**A native dependency was added and is unverified on-device.**
`react-native-svg` (for the animated payout ring) was added via `expo
install` inside `mobile/`. It bundles clean (`expo export --platform ios`
passed repeatedly) but **has never been run on a real device or simulator**
— no Xcode is available in this environment, and the Chrome browser-control
skill (`claude-in-chrome`) is listed as available but does not actually work
in this session type (verified twice — `Skill()` call and direct
`ToolSearch` for its MCP tools both come back empty). The closest verification
achieved: fetching the compiled web bundle directly via `curl` returned
HTTP 200 at ~4.9MB with no build errors — proves the JS compiles, proves
nothing about how it renders. **A visual check on a real device/simulator,
or `npx expo start` + Expo Go, is still outstanding.**

## What to actually verify, part by part

The guide is `app/assets/TradeSura_Build_Guide_v2.html` (20 parts + a
table of exact strings in Part 18). Cross-reference each part against:

| Part | Claimed status | Where the claim lives |
|---|---|---|
| 1 — the three P0s | Done | `docs/demo-plan-versioning.md`, and 1.3 below |
| 2 — brand kit | Done (earlier session) | `docs/demo-brand-kit.md` |
| 3 — app layout | Done (earlier session) | `docs/demo-app-map.md` |
| 4 — onboarding | Mostly pre-existing; one link added | `mobile/app/onboarding.tsx`, `sign-up.tsx` — **not freshly audited this pass** |
| 5 — Getting Started hub | Done | Wired in `onboarding.tsx`; no dedicated demo doc — verify the 4 steps + "How TradeSura works" link actually route correctly |
| 6 — Home dashboard | Done | `docs/demo-dashboard-v2.md` |
| 7 + 8 — plan system & wizard | Done | `docs/demo-plan-system-v2.md` |
| 9 — Add-customer sheet | Done | `docs/demo-add-customer-sheet-v2.md` |
| 9.2 — plan-picker on offer | Done (found mid-Part-15 work) | `docs/demo-personal-offer-links-v2.md` |
| 10 — Customers book | Done | `docs/demo-customers-book-v2.md` |
| 11 — Reminders | Done, one gap flagged | `docs/demo-reminders-v2.md` — push notifications explicitly NOT built (no `expo-notifications` dependency exists at all) |
| 12 — Payouts | Partial | Banner + hero ring done (`docs/demo-account-payouts-v2.md`, `docs/demo-ring-and-icons-v2.md`); the penny-reconciling transparency card was **not** re-audited against Part 18's exact requirement |
| 13 — Account | Done | `docs/demo-account-payouts-v2.md` |
| 14 — Invite/How it works/Shop | Done | `docs/demo-invite-how-it-works-shop-v2.md` |
| 15 — Customer's side | Partial | Trust line + ring header + personal-link pinning done (`docs/demo-personal-offer-links-v2.md`); the rest of the public-page/checkout copy was **not** swept against Part 18 |
| 16 — no-picture screens | Covered incidentally | No dedicated audit — these were built as side effects of other parts, never checked as a list |
| 17 — plumbing | Partial | PAF lookup mechanism built (no real provider key — needs Matt's choice + an API key); Stripe ephemeral-session popup fix **not attempted**; Stripe org / store enrolment are human tasks, not code |
| 18 — exact words | Partial | Applied wherever a screen was touched; **no systematic string-by-string sweep was ever done** — this is probably the highest-value thing for a fresh session to do, since it's mechanical and I likely missed some |
| 19 — configurable opens | Respected where encountered (quick-start toggle, option-library required flags) | Not separately audited |
| 20 — finish line walk | Not executable without a device + live Stripe test | Logic paths reasoned through, never actually run end-to-end |

## Still open, not done

- **Part 1.3 — the phantom customer.** Never resolved. The SQL to run is in
  `docs/demo-plan-versioning.md`; it needs to run against whatever
  environment Matt actually saw "Rohan Work" on, which this session never
  had access to. The code-level finding stands: every customer query is
  correctly scoped by `engineerId`, so it's very unlikely to be scenario
  (b) (a real data leak) — but that's inference, not the SQL result.
- **Push notifications (Part 11)** — no dependency, no permission flow, no
  send path. Flagged as needing a real native-infra decision, not started.
- **Real PAF address provider** — mechanism exists
  (`app/api/address/lookup`), no key, no provider chosen.
- **Stripe ephemeral-session popup fix (Part 17.1)** — not attempted.

## Judgment calls made without asking — worth a second look

- `POST /api/customers/[id]/pause` (engineer-side collection pause) was
  removed from the UI as a violation of Part 10's "no engineer-side cancel
  button" LAW, but the API route itself was left in the codebase, unused.
  Delete it outright, or keep as a support-tool escape hatch?
- The public plan page's trust line ("Gas Safe verified · Backed by
  TradeSura") only renders when the engineer is actually verified — the
  guide's string is unconditional. Chose accuracy over verbatim-match.
- Slugs stay hyphenated (`smith-heating`) rather than switching to the
  guide's illustrative unhyphenated example (`mattwood`) — the underlying
  bug (slugs keying off the email address) is fixed either way; this is
  just a formatting choice.
- The hero ring is now a hand-drawn SVG animation, which is an explicit,
  intentional violation of Part 2.2's LAW ("never redraw the ring") — done
  on direct user instruction mid-session, not a default I'd have chosen.
  Confirm this is actually wanted before it ships anywhere real.

## Testing options for whoever picks this up

No Xcode, limited disk. In priority order:
1. `cd mobile && npx expo start` → scan the QR with Expo Go on a phone on
   the same Wi-Fi. `.env`'s `EXPO_PUBLIC_API_URL` already points at the
   deployed Vercel backend, not localhost, so the phone doesn't need to
   reach the dev machine for API calls. Real uncertainty: whether the
   public Expo Go app has caught up to this project's SDK 57 yet.
2. If Expo Go refuses the SDK: `eas build --profile development --platform
   ios` — cloud-built dev client, no local Xcode/disk, install link sent
   to the phone. Also the only way to test Contacts import and the Gas
   Safe ID photo capture, which Expo Go can't do regardless.
3. `npx expo start --web` — partial only. `expo-symbols` (all icons) has no
   web implementation, so icons render blank; everything else (layout, the
   new SVG ring, colours, text) should render for a rough check.
