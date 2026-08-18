# TradeSura

Care-plan platform for UK gas engineers. See `CLAUDE.md` for full project
context, scope, and compliance requirements.

This repo has two apps:

- **Root (`/`)** — Next.js (App Router). The JSON API backend for the
  engineer app below, plus the customer web surface (plan signup, customer
  portal) at `app/p/**` / `app/portal/**`.
- **`mobile/`** — the engineer-facing app, built with Expo/React Native. See
  `mobile/CLAUDE.md` for its own setup and conventions.

## Backend + customer web (this directory)

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL, SESSION_SECRET, etc.
npx prisma migrate dev
npm run dev
```

Runs at [http://localhost:3000](http://localhost:3000) — the customer-facing
pages (`/p/[slug]/signup/[token]`, `/portal/[token]`) are viewable directly
in a browser; everything else under `app/api/**` is consumed by the mobile
app.

```bash
npm run typecheck
npm run lint
npm run test
```

## Engineer app

```bash
cd mobile
cp .env.example .env   # EXPO_PUBLIC_API_URL → this Next.js server
npm install
npx expo start
```
