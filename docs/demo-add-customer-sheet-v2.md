# Build Guide v2 Part 9 — the Add-customer sheet and its three routes

Source: `app/assets/TradeSura_Build_Guide_v2.html`, Part 9, plus Part 17.3's
PAF address lookup (route 3's first appearance of it). Root + mobile
typecheck / lint green; 131/133 tests (2 pre-existing `gas-safe.test.ts`
failures need a live DB); `expo export --platform ios` bundles clean.
2026-09-16.

## The sheet

`mobile/components/add-customer-sheet.tsx` — opens over the dimmed
dashboard from the tab-bar hero (a `Modal` + backdrop, same pattern as the
existing `GateSheet`). The hero itself already guarantees the plan leg of
the two-leg gate (it only wakes on a first live plan — Part 6.5's table);
the sheet adds the **badge** leg on top for routes 1 and 2 only:

- **"They're with me — show my plans"** and **"Text them the offer"** are
  greyed and, if tapped before the Gas Safe badge is granted, explain why
  and route to Account instead of opening.
- **"Just save their details"** has neither restriction — it opens as soon
  as the hero is awake, exactly as Part 9 specifies.
- A quiet **"Manage plans"** link sits under all three, into the plans hub.

## Route 1 — already existed, now reachable from the right place

`demo.tsx` ("Show a customer") already **was** Part 9.1 in substance: it
switches the phone into a full customer-mode WebView of the engineer's own
public plan page — no engineer chrome, ✕ top-right hands the phone back,
and it runs through the exact same shared checkout every other signup path
uses. `Customer.source` already tags these as `"doorstep"` (an internal,
never-customer-facing value — distinct from the banned-in-copy word
"doorstep"). The only change: it's now reachable from the sheet, gated on
the badge leg it was missing before.

## Route 2 — unchanged

`/offer` already does "pick the customer, pick the plan, see the exact
text, send" with a live message preview and the 48-hour nudge clock armed
on send. It's now entered from the sheet; its own inline plan/badge gates
stay as a second line of defence for anyone who deep-links to it directly
(e.g. the dashboard's "Send your first offer" button).

## Route 3 — new: `add-customer.tsx`

Name · mobile · address · an optional "Last boiler service" month picker,
with the exact helper line "Powers automatic service reminders." Saving
calls a new endpoint, **`POST /api/customers`**, which is deliberately
plan-free — it only ever touches `Customer`/`Property`/`Appliance`, never
`Plan`, and de-dupes by phone against the existing book (the same key
`/api/offer` already upserts on).

## New: the PAF address lookup mechanism (Part 17.3)

- **`POST /api/address/lookup`** — the one shared contract every future
  caller (signup, pack order, checkout) will use. No provider is wired up
  (no API key exists to wire), so it honestly reports `configured: false`
  and an empty result rather than faking data — Part 17.3 explicitly
  requires a manual fallback to exist regardless, so that's the actual
  behaviour today, not a placeholder standing in for it.
- **`mobile/components/address-lookup.tsx`** — postcode + "Find address",
  a results list when a provider is configured, and always-visible manual
  `line1`/`town` fields underneath. Going live needs one thing: a real key
  in `ADDRESS_LOOKUP_API_KEY` and the provider call in that one route file
  — nothing downstream changes.
- **`mobile/components/month-picker.tsx`** — a minimal month/year stepper
  (no date-picker library is installed); good enough for a month-level date
  that only ever feeds the reminder engine.

## Known gaps in this slice

- No real address-lookup provider is wired up — Matt's call which one
  (getAddress / Ideal Postcodes / Loqate / Postcoder), and it needs an API
  key that doesn't exist yet.
- Route 1's trust block copy ("Gas Safe verified · Backed by TradeSura") is
  the public page's own copy, which hasn't had its Part 15.1 pass yet —
  today it reads slightly differently. Deferred to the Part 15 slice.
- The month picker is a stepper, not a native calendar control.

## Walk it

1. With a live plan but no Gas Safe badge yet: tap the hero → the sheet
   opens → routes 1 and 2 are dimmed; tapping either explains why and
   offers "Check status".
2. Verify the badge → the same two routes light up.
3. "Just save their details" → fill name/mobile, type a postcode and tap
   "Find address" (reports no lookup configured, exactly as designed) →
   type the address manually instead → set "Last boiler service" to two
   months ago → save → the customer appears in the book with no plan and
   that service date feeding Reminders.
4. "They're with me" → the phone switches to customer mode, no engineer
   chrome, ✕ returns instantly.
