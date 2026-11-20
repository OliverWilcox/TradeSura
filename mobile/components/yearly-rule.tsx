import { View, Text } from "react-native";

// Matt, 13 Nov — shown before the engineer offers a plan: customers can pay
// yearly, and if one cancels, their refund comes out of the engineer's share
// while TradeSura keeps its 20% (server: lib/plan-billing.ts refundPayment).
export function YearlyRule() {
  return (
    <View className="rounded-2xl border border-line-strong p-4">
      <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-flame">Customers can pay yearly</Text>
      <Text className="mt-1.5 text-[14px] leading-[20px] text-ink">
        12 months for the price of 11, taken in one payment after their cooling-off period.
      </Text>
      <Text className="mt-1.5 text-[14px] leading-[20px] text-ink">
        If a yearly customer cancels, they get back the whole months they haven&apos;t used. That refund comes out of
        your share, and TradeSura keeps its 20%.
      </Text>
    </View>
  );
}
