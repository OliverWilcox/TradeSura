import { useEffect, useState } from "react";
import { View, Text, Pressable, Animated, AccessibilityInfo, Share } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";

function pounds(pence: number) {
  return pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`;
}

// E11b — new screen, not in the original build. The one celebration moment
// in the app: shown once, ever, the first time a real payout lands. Single
// haptic success pattern, count-up on the figure, screenshot-friendly.
export default function FirstPayout() {
  const { amountPence, plans, monthlyPence, bankLast4 } = useLocalSearchParams<{
    amountPence: string;
    plans: string;
    monthlyPence: string;
    bankLast4?: string;
  }>();

  const amount = Number(amountPence) || 0;
  const planCount = Number(plans) || 0;
  const monthly = Number(monthlyPence) || 0;
  const yearly = monthly * 12;

  const [display, setDisplay] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [countAnim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      setReduceMotion(v);
      if (v) {
        setDisplay(amount);
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      const id = countAnim.addListener(({ value }) => setDisplay(Math.round(value)));
      Animated.timing(countAnim, { toValue: amount, duration: 700, useNativeDriver: false }).start();
      return () => countAnim.removeListener(id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount]);

  async function share() {
    await Share.share({
      message: `Just had my first TradeSura payout — ${pounds(amount)} landed, ${planCount} plan${planCount === 1 ? "" : "s"} live. This is what recurring income feels like.`,
    }).catch(() => {});
  }

  return (
    <View className="flex-1 bg-bg">
      <SafeAreaView edges={["top", "bottom"]} className="flex-1 justify-center px-6">
        <View className="items-center">
          <Text className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-copper">
            Your first payout
          </Text>
          <Text
            className="mt-2.5 font-mono text-[56px] font-extrabold leading-none text-copper"
            style={reduceMotion ? undefined : { fontVariant: ["tabular-nums"] }}
          >
            {pounds(display)}
          </Text>
          <Text className="mt-3 text-center text-lg font-extrabold text-white">
            This is what recurring income feels like.
          </Text>
          <Text className="mt-2.5 text-center text-sm text-night-muted">
            {bankLast4 ? `Landed in your bank account ···${bankLast4}. ` : "Landed in your bank account. "}
            Next one&apos;s Friday.
          </Text>

          <View className="mt-6 w-full flex-row gap-2">
            {[
              [String(planCount), "plans live"],
              [pounds(monthly), "/month"],
              [pounds(yearly), "/year"],
            ].map(([big, small]) => (
              <View
                key={small}
                className="flex-1 items-center rounded-[10px] border border-line bg-white/[0.06] py-2.5"
              >
                <Text className="text-[15px] font-bold text-white">{big}</Text>
                <Text className="font-mono text-[9px] uppercase tracking-wide text-night-muted">
                  {small}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View className="mt-10 gap-2.5">
          <Pressable
            onPress={share}
            className="min-h-[56px] items-center justify-center rounded-2xl bg-white"
          >
            <Text className="text-base font-extrabold text-night-text">Share this</Text>
          </Pressable>
          <Pressable
            onPress={() => router.replace("/(tabs)")}
            className="min-h-11 items-center justify-center rounded-2xl border-[1.5px] border-white/55 py-3.5"
          >
            <Text className="font-semibold text-white">Back to dashboard</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
