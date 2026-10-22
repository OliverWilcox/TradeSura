import { useEffect, useState } from "react";
import { View, Text, ScrollView, Animated, Easing, AccessibilityInfo } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/ui";
import { Icon, type IconName } from "@/components/icon";
import { RingMark } from "@/components/ring-mark";
import { StripeBadge } from "@/components/stripe-badge";

// Build Review 3, section 4 — the celebration after Stripe set-up finishes
// and payments are switched on (get-paid.tsx sends people here only when
// /api/me says stripeState is "ready"). Same look as plan-live.tsx: the ring,
// a big headline, then what happens next.

const POINTS: { icon: IconName; text: string }[] = [
  { icon: "verified", text: "Customers can join your plans by Direct Debit" },
  { icon: "pound", text: "You keep 80% of every payment" },
  { icon: "bank", text: "Paid into your bank every Friday" },
];

export default function PaymentsReady() {
  const [reduceMotion, setReduceMotion] = useState(true);
  const [pop] = useState(() => new Animated.Value(0));

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => setReduceMotion(true));
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      pop.setValue(1);
      return;
    }
    Animated.timing(pop, {
      toValue: 1,
      duration: 650,
      easing: Easing.out(Easing.back(1.6)),
      useNativeDriver: true,
    }).start();
  }, [pop, reduceMotion]);

  return (
    <View className="flex-1 bg-bg">
      <SafeAreaView edges={["top", "bottom"]} className="flex-1">
        <ScrollView contentContainerClassName="px-4 pb-6">
          <View className="items-center pb-4 pt-10">
            <Animated.View
              style={{
                opacity: pop,
                transform: [
                  { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
                  { rotate: pop.interpolate({ inputRange: [0, 1], outputRange: ["-90deg", "0deg"] }) },
                ],
              }}
            >
              <RingMark size={150} />
            </Animated.View>
          </View>
          <Text className="text-center text-[30px] font-extrabold leading-[36px] text-ink">
            You&apos;re set up to get paid
          </Text>
          <Text className="mt-2 text-center text-[15px] text-muted">
            Stripe has everything it needs. Payments are on.
          </Text>

          <View className="mt-5 rounded-2xl border border-line-strong px-4 py-1.5">
            {POINTS.map((p, i) => (
              <View
                key={p.text}
                className={`flex-row items-center gap-3.5 py-3 ${i < POINTS.length - 1 ? "border-b border-line-strong" : ""}`}
              >
                <Icon name={p.icon} size={22} color="#5fa3f0" />
                <Text className="flex-1 text-[15.5px] text-ink">{p.text}</Text>
              </View>
            ))}
          </View>

          <View className="items-center pt-5">
            <StripeBadge />
          </View>

          <View className="mt-6">
            <Button onPress={() => router.navigate("/onboarding")}>Back to setup</Button>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
