import { useEffect, useRef } from "react";
import { View } from "react-native";
import { loadConnectAndInitialize } from "@stripe/connect-js";

// Stripe's onboarding form in the Get paid screen (Matt, 12 Nov: the engineer
// never sees Stripe). Only for accounts TradeSura collects details for, where
// Stripe's sign-in step is off (app/api/stripe/onboarding-session). Themed to
// the app's navy so it reads as one of our screens.
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
  const host = useRef<View>(null);
  const exit = useRef(onExit);
  useEffect(() => {
    exit.current = onExit;
  }, [onExit]);

  useEffect(() => {
    const el = host.current as unknown as HTMLElement | null;
    if (!el) return;
    const connect = loadConnectAndInitialize({
      publishableKey,
      fetchClientSecret: async () => clientSecret,
      locale: "en-GB",
      appearance: {
        overlays: "dialog",
        variables: {
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
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
    });
    const form = connect.create("account-onboarding");
    form.setOnExit(() => exit.current());
    el.appendChild(form);
    return () => {
      form.remove();
      connect.logout().catch(() => {});
    };
  }, [clientSecret, publishableKey]);

  return <View ref={host} style={{ minHeight: 420 }} />;
}
