# TradeSura — 4 October notes review, 7 October 2026

Review performed against the working tree, including pre-existing uncommitted changes. The PDF is an acceptance checklist, not authority to send messages or change production authentication. Oliver requested a local React Native Web review, a replacement GoAddress key, four-digit email codes and Resend tests to his specified inbox.

## Confirmed this session

- React Native Web rendered at a 390 × 844 viewport in a separate Chrome session: welcome, sign-in, How it works, signup step 1, support sheet and free-to-join FAQ.
- Welcome copy includes the calculated £1,152 yearly example, import line, free CTA, no-card line, white tagline and Gas Safe footer.
- How it works uses the shortened illustrated cards, import tick and free wording. Dragging the slider to its end was verified to show 200 customers, £1,920/month and £23,040/year. Keyboard interaction in the web preview did not change its value.
- Support sheet opens and shows email support; mobile sign-in is absent.
- Replacement GoAddress key saved locally and in Vercel Preview and Production settings. Direct provider request returned HTTP 200 and two addresses for BN1 1AA. Provider reported a daily limit of 99; this alone does not establish its pricing tier.
- Local address route returned two mapped addresses using a synthetic, short-lived signup token. An unauthenticated request returned 401. No real signup was created for this test.
- Email sign-in now generates and accepts exactly four digits; app input, auto-submit, placeholder and server validation agree. Existing SMS signup verification remains six digits.
- Ten new isolated authentication tests pass: format, hashing and email payload, successful verification, expiry, single use, fifth-attempt block and resend delay. Root/mobile typecheck and lint pass. Existing suite: 144 pass, two Gas Safe database integration tests fail with the local database unavailable.

## Open findings

| Notes | Finding | Evidence / limitation |
|---|---|---|
| 1 | Actual account creation not proven | No real signup submitted; duplicate-phone checks and final error handling exist in source. |
| 2 | Live account sign-in not proven; Resend delivery passes | Branded test from info@tradesura.com to the requested inbox was reported delivered by Resend. Local Resend key now configured. Database-backed login remains untested. |
| 2 | Authentication configuration needs verification before pilots | SIGNIN_CODES=off can bypass codes; missing email configuration exposes a devCode without a production-only guard. Production values not inspected. No bypass enabled in this review. |
| 2 | Concurrent wrong attempts can undercount | Verify reads attempts, then writes attempts + 1 without an atomic increment. Sequential lockout test passes; concurrent lockout is not proven. |
| 2 | Face ID requires native-device verification | Web explicitly skips biometric checks. |
| 3 | Welcome visual target not met in web preview | Proof chips stack vertically; photo remains visible behind headline/body. Missing native symbol icons in web also prevent full visual parity. |
| 4 | Apple flow requires native-device verification | Source routes new Apple users into prefilled signup; not exercised on web. |
| 5 | Signed-in footer passes isolated UI checks | With synthetic account responses, no plan shows Build my first plan; an existing plan hides the button. Target real account not accessed. |
| 6 | Shared address lookup missing at customer checkout | Found in native signup and Add customer; not customer web checkout. |
| Additional user request | Separate signup email verification absent | Signup checks email availability; four-digit verification currently applies to email sign-in. The 4 October PDF itself does not explicitly require a separate signup email code. |
| 6 | Signup steps 2–3 partially verified | Synthetic saved drafts render the ID defer copy and partnership form. Live Companies House returns TradeSura and its registered office; live GoAddress results appear in the signup screen. Company selection/prefill and final account creation are not end-to-end verified. |
| 7 | SMS provider readiness not established | Twilio integration exists; configuration and delivery not tested. |

## Release status

No deployment or TestFlight build made. Saved Vercel environment changes apply to subsequent deployments. Account oliverbrodywilcox@gmail.com has not been accessed. No authentication bypass was introduced or enabled. Database access remains necessary to finish the real account login and signup checks. Resend delivery has now passed; Vercel sender configuration exists but its sensitive value is not readable, so the branded sender was tested directly using the address supplied in this conversation.

Screenshots captured under /tmp/tradesura-review/ (temporary local artifacts).

## Follow-up acceptance checklist

| Requirement | Result |
|---|---|
| 1: duplicate mobile caught on step 1 | Source checks on blur and before OTP issuance; actual duplicate record not exercised. |
| 1: actionable signup errors | Duplicate constraints and create failures handled; event logging after account creation is awaited outside the catch. An event-write failure can still fail the response after creating the account. |
| 2: email codes | Four-digit generation/input/validation implemented per Oliver’s override. Isolated tests pass; no real account session completed. |
| 2: expiry, single use, five wrong attempts, resend delay | Sequential tests pass; concurrent attempt counting remains a defect. |
| 2: stay signed in / Face ID | Persistent token storage and 180-day sessions in source. Face ID is native-only and untested. |
| 3.1–3.2: larger green headline / white tagline | Present; web renders 32px green vs 28px headline, proportionally similar to the target but not its literal 54px/48px measurements. |
| 3.3: clean navy behind text | Does not match target in web screenshot. |
| 3.4–3.6: earnings, old line removed, import copy | Present; earnings comes from shared configuration. Native import icon is absent in web preview. |
| 3.7: outlined How it works button | Present; native info icon is absent in web preview. |
| 3.8–3.11: free wording, sub-line, Stripe text, footer | Present. Proof-chip layout stacks in web, unlike the target. |
| 4.1: unknown email explanation and create-account action | Source present; real database lookup untested. |
| 4.2: Apple signup prefill | Source present; needs iPhone test. |
| 4.3–4.4: help sheet / Welcome back | Web verified. Mobile recovery remains hidden; SMS readiness not verified. |
| 5.1–5.4: free wording, shorter cards, 200 slider, import tick | Web verified. |
| 5.5: signed-in footer | Verified with isolated synthetic account responses, not the real account. |
| 6 step 1: truthful mobile state / sub-line | Source hides verified tick unless texted; sub-line rendered. Real SMS flow untested. |
| 6 step 2: skip reassurance / offer gate / missing-photo reminder | Reassurance rendered; server gate and dashboard reminder present in source. |
| 6 step 3.1: correspondence address | Partnership form and real lookup results rendered; registered-office prefill logic present. |
| 6 step 3.2: shared lookup everywhere | Incomplete: customer web checkout lacks it. |
| 6 step 3.3: title casing | Executed function confirms J&D Heating Ltd, O'Neill Gas Ltd and Smith's Plumbing Ltd. |
| 6 step 3.4: legal links | Public /terms and /privacy both return HTTP 200 holding pages marked pending solicitor review. |
| 6 step 3.5: partnership | Rendered without Companies House lookup, as requested. |
| 7: providers | GoAddress tested; Twilio sending integration exists but SMS delivery/readiness untested. No message sent to Matt. |
| 8: next review | Wizard/dashboard/plan-builder review is future scope in this PDF, not evidence that those screens pass. |

No application code changed during this follow-up review. Earlier test results remain applicable; no full suite rerun was needed for this documentation-only update.
