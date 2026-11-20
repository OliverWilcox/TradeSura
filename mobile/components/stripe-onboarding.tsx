import { useState } from "react";
import { ConnectAccountOnboarding, ConnectComponentsProvider, loadConnectAndInitialize } from "@stripe/stripe-react-native";

// Stripe's onboarding form inside the app on the phone (Matt, 12 Nov: the
// engineer never sees Stripe). Opens as a full-screen sheet over Get paid;
// only for accounts TradeSura collects details for, where Stripe's sign-in
// step is off (app/api/stripe/onboarding-session). The web build has its own
// version (stripe-onboarding.web.tsx).
export const embeddedOnboardingAvailable = true;

export function StripeOnboarding({
  clientSecret,
  publishableKey,
  onExit,
}: {
  clientSecret: string;
  publishableKey: string;
  onExit: () => void;
}) {
  const [connect] = useState(() =>
    loadConnectAndInitialize({
      publishableKey,
      fetchClientSecret: async () => clientSecret,
      locale: "en-GB",
      appearance: {
        variables: {
          colorPrimary: "#5FA3F0",
          colorBackground: "#0B1A2E",
          colorText: "#FFFFFF",
          colorSecondaryText: "#9FB6D0",
          colorBorder: "rgba(255,255,255,0.18)",
          colorDanger: "#FF6B6B",
          buttonPrimaryColorBackground: "#FFFFFF",
          buttonPrimaryColorText: "#0B1A2E",
          buttonPrimaryColorBorder: "#FFFFFF",
          buttonSecondaryColorBackground: "#193150",
          buttonSecondaryColorText: "#FFFFFF",
          formBackgroundColor: "#122540",
          offsetBackgroundColor: "#122540",
          borderRadius: "12px",
        },
      },
    }),
  );
  return (
    <ConnectComponentsProvider connectInstance={connect}>
      <ConnectAccountOnboarding title="Set up payments" onExit={onExit} />
    </ConnectComponentsProvider>
  );
}
