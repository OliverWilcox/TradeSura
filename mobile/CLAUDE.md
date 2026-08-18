# TradeSura engineer app (Expo)

This is the engineer-facing surface of TradeSura, rebuilt as a native app.
Read `../CLAUDE.md` first — it's the source of truth for product scope,
compliance rules, and working conventions. This file only covers what's
specific to this Expo project.

## What lives here vs. in `../`

- This app is the **engineer surface only** (dashboard, plan builder,
  doorstep flow, customer book, jobs, more/settings).
- The customer surface (signup, portal) is a hard product/compliance
  requirement to stay plain web with no accounts and no app — it stays in
  `../app/p/**` and `../app/portal/**`, untouched by this project.
- `../` (the Next.js app) is this app's JSON API backend. Point
  `EXPO_PUBLIC_API_URL` (see `.env.example`) at it.
- Sibling folder, not a monorepo: two independent `package.json`s, no
  workspaces/turborepo. Don't add workspace tooling without checking with
  the human first — that was an explicit choice, not an oversight.

## Stack decisions made when this was set up

- **NativeWind v4.2.6 (stable), not v5.** v5 targets Tailwind v4 and matches
  the web app's `@theme` tokens more closely, but as of this setup it only
  ships as `5.0.0-preview.*` with a `react-native-css@0.0.0-nightly.*`
  dependency — not production-ready. `tailwind.config.js` here duplicates
  the hex values from `../app/globals.css`'s `@theme` block by hand; if you
  change a colour/font token in the web app, update both places. Revisit
  NativeWind v5 once it has a stable release.
- **Auth is bearer-token, not cookies.** The engineer signs in via the same
  magic-link email as before, but the link points at
  `../app/api/auth/mobile-callback` instead of `../app/api/auth/callback`
  (selected via `client: "mobile"` in the `POST /api/auth/request` body).
  That route mints a JWT and redirects to the app's custom scheme
  (`tradesura://auth-callback?token=...`) instead of setting a cookie.
  `lib/auth.ts` here stores it in `expo-secure-store`; `lib/api.ts`'s `api()`
  wrapper attaches it as `Authorization: Bearer <token>` on every call.
  On the backend, `getEngineerId()` (`../lib/auth.ts`) checks the bearer
  header first and falls back to the session cookie — one function, both
  clients, no route-by-route auth changes needed.
- **The plan-wording blocklist (`../lib/compliance/blocklist.ts`) is never
  duplicated here.** It's pure TS with no server-only imports, so it *could*
  be copy-pasted client-side for instant feedback like the web app does —
  don't. CLAUDE.md calls this compliance path non-negotiable, and two copies
  of a regex list drift. `app/api/tiers/check-wording` is a small
  bearer-authed endpoint the plan builder calls instead; it costs a network
  round-trip on each custom label, which is the right trade here. Small,
  non-compliance display constants (`CATEGORY_ORDER`, the suggested-price
  base, the 20% fee rate — see `app/tier/[tierId].tsx`) are duplicated by
  hand, same as the Tailwind tokens above; that's a fine trade for numbers
  that don't carry legal risk.
- **Fonts are static per-weight files**, not one variable font + CSS
  `font-weight` (RN can't do that). Each weight the web design actually uses
  is its own `@expo-google-fonts/*` import, loaded in `app/_layout.tsx` and
  exposed as separate Tailwind `fontFamily` keys (`font-sans-semibold`,
  `font-disp-bold`, `font-mono-medium`, etc.) — see `tailwind.config.js`.
  Don't reach for a variable-font trick; add the specific weight you need.

## Gotchas hit during setup (don't redo this work)

- `babel-preset-expo` and `@expo/metro-runtime` are real dependencies of
  `expo-router`/`expo` but aren't hoisted to the top of `node_modules` by
  npm in this project — they must be listed as **direct** dependencies here
  or Babel/Metro fail to resolve them. If a similar "Cannot find module"
  error shows up for a package you didn't install yourself, check whether
  it's nested under another package's `node_modules` and add it directly
  rather than assuming something is broken.
- `metro.config.js` sets `watchFolders: [__dirname]` on purpose — this repo
  isn't a monorepo, so without it Metro's file watcher can reach up into the
  Next.js app's `node_modules` next door. Don't set
  `resolver.disableHierarchicalLookup` to try to fix version-duplicate
  warnings from `expo-doctor` — that breaks normal resolution of hoisted
  deps within this project's own `node_modules` (tried it, broke
  `@expo/metro-runtime` resolution, reverted).
- `react-native-css-interop` (NativeWind's runtime) pulls in
  `react-native-reanimated`, which needs `react-native-reanimated/plugin` as
  the last entry in `babel.config.js`'s `plugins` array — without it, any
  screen touched by NativeWind's native className interop fails to bundle.
- `npx expo-doctor` reports a "duplicate dependencies" warning for `react`
  (this app's `react@19.2.x` vs. the Next.js app's `react@19.2.x` one level
  up). That's `expo-doctor` statically walking the filesystem past this
  project's own `node_modules` into the sibling repo's — it isn't a real
  double-bundled React. Confirmed by exporting both platforms
  (`npx expo export --platform ios|android`) after `watchFolders` was scoped
  to this directory: both bundle clean with one copy of React. Expected
  given the deliberate no-workspace sibling-folder layout; don't try to
  "fix" it by touching resolver internals (see the `disableHierarchicalLookup`
  note above).
- Expo SDK versions here move fast (this was set up on SDK 57, Aug 2026).
  The scaffolded `AGENTS.md` in this folder is right: check
  `docs.expo.dev/versions/v<sdk>` for the SDK actually installed before
  assuming an API from training data — several of the setup steps above
  came from checking current docs rather than what an LLM would "remember"
  about Expo/NativeWind.

## Running this app

```
cd mobile
cp .env.example .env   # point EXPO_PUBLIC_API_URL at the Next.js dev server
npm install
npx expo start
```

`npm run typecheck` and `npm run lint` (`expo lint`) are wired up the same
way as the root project's — run both before considering a change done.
