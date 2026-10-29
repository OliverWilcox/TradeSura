import { router } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { inSetup } from "@/lib/setup-steps";

// Review 4 — screens reached from the Getting Started hub leave back to the
// hub while setup is under way, never to Home or the tab bar. Afterwards
// they behave as before (`otherwise`).
export function useSetupExit() {
  const { me, stripeSkipped } = useAuth();
  const setup = inSetup(me, stripeSkipped);
  return {
    inSetup: setup,
    exit(otherwise: () => void = () => router.back()) {
      if (setup) router.navigate("/onboarding");
      else otherwise();
    },
  };
}
