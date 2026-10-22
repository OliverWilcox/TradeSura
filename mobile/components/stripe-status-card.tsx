import { View, Text, Pressable } from "react-native";
import { router } from "expo-router";
import type { StripeState } from "@/lib/auth-context";
import { Icon } from "@/components/icon";

// Build Review 3 — payment setup that stopped part-way (an accidental "Return
// to TradeSura", or Stripe wanting one more document) is shown as progress,
// never as a reset. Amber card, one tap back into /get-paid, which reopens
// the same Stripe account where they left off. Renders nothing for
// "none" and "ready" (the setup step / nothing to do covers those).

const COPY: Partial<Record<StripeState, { title: string; body: string; cta?: string }>> = {
  half: {
    title: "Payments half set up",
    body: "About 1 minute left with Stripe. We saved your progress.",
    cta: "Continue",
  },
  needs_more: {
    title: "Stripe needs one more thing",
    body: "Stripe wants one more detail before you can be paid.",
    cta: "Go back to Stripe",
  },
  checking: {
    title: "Stripe is checking your details",
    body: "Nothing to do. We'll let you know when payments are on.",
  },
};

export function StripeStatusCard({
  state,
  onPress,
  className = "",
}: {
  // From me.stripeState.
  state: StripeState | null | undefined;
  // Defaults to opening the Get paid screen.
  onPress?: () => void;
  className?: string;
}) {
  const copy = state ? COPY[state] : undefined;
  if (!copy) return null;
  const open = onPress ?? (() => router.push("/get-paid"));
  const body = (
    <View className={`flex-row items-center gap-3 rounded-2xl border border-warn/50 bg-warn-tint p-4 ${className}`}>
      <Icon name={copy.cta ? "warning" : "clock"} size={22} color="#F2B84B" />
      <View className="flex-1">
        <Text className="text-[15.5px] font-bold text-warn">{copy.title}</Text>
        <Text className="mt-0.5 text-[13.5px] leading-[19px] text-ink">{copy.body}</Text>
      </View>
      {copy.cta && (
        <View className="flex-row items-center gap-1">
          <Text className="text-[14px] font-semibold text-warn">{copy.cta}</Text>
          <Icon name="chevron" size={13} color="#F2B84B" weight="semibold" />
        </View>
      )}
    </View>
  );
  if (!copy.cta) return body;
  return (
    <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`${copy.title}. ${copy.cta}`}>
      {body}
    </Pressable>
  );
}
