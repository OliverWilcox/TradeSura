# The hero ring — real SVG draw animation, and an icon audit

Follow-up to the Part 6/12 work. Root + mobile typecheck / lint green;
137/139 tests (2 pre-existing DB-dependent failures, unrelated); `expo
export --platform ios` bundles clean with the new dependency. 2026-09-16.

## Icon audit — the nav is already clean

Checked every screen for emoji standing in for a real icon (Part 2.4 LAW).
The tab bar and dashboard quick actions already use `components/icon.tsx`
(SF Symbols / Material Symbols via `expo-symbols`) from the earlier
brand-kit slice — not emoji. Found and fixed one real leftover: Messages'
gas-emergency banner rendered a literal "⚠" character; it's now
`<Icon name="warning">` in a proper row layout. If your device still shows
emoji anywhere, that's an old build, not current code.

## The ring — now a real SVG draw animation

You asked me to try it — done. **This is a deliberate, explicit exception
to Part 2.2's LAW** ("never redraw the ring as a plain circle"), made on
your direct instruction rather than assumed; noted in the component's own
comment so it's a visible decision, not a silent override. Every *other*
place the ring appears (masthead lockup, avatar mark, app icon) still uses
the real, untouched asset — this is only the payout-progress context Part
6.3's text is actually describing.

**New dependency**: `react-native-svg` (added via `npx expo install`, so
it's the SDK-57-correct version — `15.15.4`). **This needs a native
rebuild before it'll actually render** — same as this codebase's own
earlier notes about `expo-linear-gradient`/`expo-sharing` showing
"Unimplemented component" on a binary built before they were linked in.
`expo export` proves the JS bundles cleanly; it can't prove the native
module is linked into whatever's currently on your phone.

**`components/ring-progress.tsx`** — `RingProgress`: a blue base circle
(`react-native-svg`'s `Circle`) plus a green progress circle animated via
`strokeDasharray`/`strokeDashoffset` (the standard SVG "draw" technique),
rotated to start at 12 o'clock and sweep clockwise, `strokeLinecap="round"`
to match the brand ring's soft segment ends. `Animated.timing` draws it in
over ~900ms whenever progress changes — a real animation, not a static
reveal. `payoutWeekProgress()` returns 0 (Monday) → 1 (Friday, fully
closed), holding closed over the weekend. Replaces the static ring +
separate dot-row I'd built last round in both the Dashboard and Payouts
heroes.

## Testing without Xcode — what I can actually do here, and what you should run

I have no simulator, device, or way to see a rendered screen myself in this
environment — I can only prove the JS compiles and bundles (`expo export`),
not that it looks right. Here's the real path, cheapest first:

**1. Expo Go on your phone — should work for this app.** I checked: nothing
in `mobile/package.json` requires a custom dev client to *run* (no native
Stripe SDK — checkout goes through a `WebView`; everything else is
standard Expo-bundled packages, `react-native-svg` included). Run, from
`mobile/`:
```
npx expo start
```
Scan the QR code it prints with Expo Go (same Wi-Fi as this Mac). The app
already points at your deployed API (`.env`'s `EXPO_PUBLIC_API_URL` is the
Vercel URL, not localhost), so your phone doesn't need to reach this
machine for anything except the JS bundle itself.

**One real uncertainty**: Expo Go bundles one fixed native-module set per
SDK version, and this project is on SDK 57 — if the public Expo Go app
hasn't caught up to 57 yet, it'll refuse to open the project and tell you
so plainly. If that happens, that's Expo Go's limit, not something to
debug around.

**2. If Expo Go won't take SDK 57 — EAS Build, not Xcode.** `eas build
--profile development --platform ios` builds your actual dev-client binary
in Expo's cloud — no Xcode, no local disk beyond the repo itself. It hands
you an install link for your phone. This is also what you'd eventually
need to test the pieces that only work in a real dev client (Contacts
import, the Gas Safe ID photo capture) — Expo Go can't do those either way.

**3. Web** isn't viable for this specific app — `expo-symbols` (the icon
system) has no web implementation, so most screens would fail to render
there. Not worth attempting.

I started `npx expo start` here to confirm it boots (Metro came up clean on
`192.168.0.212:8081`) then stopped it — better for you to run it yourself
so you get the live, interactive QR code and reload controls rather than a
backgrounded process you can't see.

## Walk it (once you're on a device)

1. Skipped-setup dashboard: ring outline dim, no green.
2. Make a plan live: the ring draws in — the green arc animates from
   nothing to today's position over about a second.
3. Compare Monday vs. Friday (or fudge your phone's clock forward): the
   arc should read further round the circle, fully closed by Friday, and
   stay closed over the weekend.
4. Payouts tab: same ring, its own hero — it had none before this.
5. Trigger the gas-emergency interlock, open Messages: a real icon, not ⚠.
