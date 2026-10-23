import { useEffect, useState } from "react";
import { View, Text, ScrollView, AccessibilityInfo, Pressable, useWindowDimensions } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";
import { setHasSeenFirstCustomer } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui";
import { RingMark } from "@/components/ring-mark";
import { Confetti } from "@/components/confetti";

function pounds(pence: number) {
  return pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`;
}

// Build Review 3 §3 — celebration moments with the ring: plan live, first
// customer, first payout, Stripe done. This one is the first customer, shown
// once ever (from Home, or the first-activation push).
export default function FirstCustomer() {
  const { me } = useAuth();
  const { name, plan, yearlyPence } = useLocalSearchParams<{
    name: string;
    plan: string;
    yearlyPence: string;
    planId?: string;
  }>();
  const { width } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState(true);
  const yearly = Number(yearlyPence) || 0;

  useEffect(() => {
    setHasSeenFirstCustomer().catch(() => {});
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        setReduceMotion(v);
        if (!v) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      })
      .catch(() => setReduceMotion(true));
  }, []);

  const brand = me?.firstName?.trim() || me?.tradingName?.trim() || "you";

  return (
    <View className="flex-1 bg-bg">
      <SafeAreaView edges={["top", "bottom"]} className="flex-1">
        <ScrollView contentContainerClassName="flex-grow justify-center px-4 pb-6">
          <View className="items-center pb-4 pt-6">
            <Confetti width={width - 32} height={200} reduceMotion={reduceMotion} />
            <RingMark size={150} />
          </View>
          <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-center text-flame">
            Your first customer
          </Text>
          <Text className="mt-2 text-center text-[30px] font-extrabold leading-[36px] text-ink">
            {name || "Your customer"} joined {plan || "your plan"}!
          </Text>
          <Text className="mt-2 text-center text-[15px] text-muted">
            Nice one, {brand}. Their Direct Debit is set up and their first payment follows the 14-day cooling-off
            period.
          </Text>

          {yearly > 0 && (
            <View className="mt-5 items-center rounded-2xl border border-line-strong px-4 py-3.5">
              <Text className="text-center text-[16px] font-semibold text-ok">
                {pounds(yearly)} a year to you, after our fee
              </Text>
            </View>
          )}

          <View className="mt-6 gap-2.5">
            <Button onPress={() => router.replace("/offer")}>Offer it to another customer</Button>
            <Pressable onPress={() => router.replace("/")} className="items-center py-3">
              <Text className="text-[15px] font-semibold text-flame">Back to Home</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
