# Demo — Build Guide v2 Part 3: how the app is laid out

Source: `app/assets/TradeSura_Build_Guide_v2.html`, Part 3 (with the gating
LAW it points at in 6.5 and the Part 18 strings).

## What changed

**The map is five tabs + one hero + one avatar**
- Tab bar: Home · Customers · **Add customer** (white circle, person-plus
  symbol, label beneath — the bar's only filled element) · Reminders · Payouts.
  Blue tint on the active tab only, labels kept. No Plans tab, no More tab.
- **Reminders badge** — red count on the bell only when services are overdue
  or due within 7 days. New endpoint `app/api/jobs/badge/route.ts`; the tab
  bar polls it on every navigation change and on app foreground. Zero = no
  badge, never "0".
- **Pushed pages keep the tab bar, parent tab lit.** Routes moved into nested
  stacks: `mobile/app/(tabs)/(home)/` holds Home, My plans, the plan editor,
  Account, Invite, Membership Shop, Messages and the coming-soon stub;
  `mobile/app/(tabs)/(customers)/` holds the book, customer detail, CSV /
  contacts import and the offer campaign. Inside My plans, Home is lit and
  tapping Home pops back to the dashboard. Full-screen flows stay outside the
  tabs on purpose: welcome / sign-in / sign-up, the Getting Started hub,
  the offer flow (Part 9 rebuilds it as a sheet), the demo hand-over, and the
  first-payout celebration.
- **Avatar → Account** on every tab screen (from Part 2). The room itself is
  Part 13.

**Rooms are never locked; actions are**
- New `GateSheet` in `mobile/components/ui.tsx` — the soft-gate pattern: the
  gated thing stays visible, muted and tappable; the tap opens a short sheet
  with the reason and the route back.
- First use: the Add customer hero. With no live plan it drops to 40%
  opacity with a muted label, still the centrepiece, and a tap shows
  "Add customers once your first plan is live — Continue setup →" routing to
  the hub. It wakes with the first live plan.
- Payouts sub-line with no plans now reads the Part 18 string: "Payouts start
  when your first plan goes live — paid every Friday."

## Run it

```
cd mobile && npm run typecheck && npm run lint
npx expo export --platform ios   # proves the new route tree bundles
npx expo start                   # regenerates .expo/types/router.d.ts
```

## Walk (on a device)

1. Sign in with a fresh account (no plan). The Add customer hero is dim; tap
   it — the gate sheet explains and "Continue setup" opens the hub.
2. Create a plan. Back on Home the hero is bright; tap it — the offer flow.
3. Home → My plans → a plan → the tab bar is still there and Home is blue.
   Tap Home: you're back on the dashboard in one tap.
4. Tap the avatar from the Payouts tab — Account opens under the Home tab,
   Home lights up. Back chevron returns to Account's parent.
5. Customers → a customer → the tab bar stays, Customers is blue.
6. With a customer whose service is overdue, the Reminders bell shows a red
   count. Mark the service done, switch tabs — the badge disappears.

## Not in this slice (later parts)

- 6.5 quick-action gates (My plans, Membership Shop) and the two-leg
  plan + badge gate on offers — `GateSheet` is ready for them.
- 6.6 dashboard cards and state-aware greeting.
- Part 9's Add customer sheet behind the hero, and Part 13's Account rebuild.
