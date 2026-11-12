// Stripe's onboarding form inside the app (Matt, 12 Nov). The web build
// renders it (stripe-onboarding.web.tsx); the phone app still opens Stripe's
// hosted form until the native version is in, which on a Custom account
// needs no Stripe sign-in either.
export const embeddedOnboardingAvailable = false;

export function StripeOnboarding(_props: {
  clientSecret: string;
  publishableKey: string;
  onExit: () => void;
}) {
  return null;
}
