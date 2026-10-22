import { useCallback, useState } from "react";
import { Text, Pressable } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { api } from "@/lib/api";
import { Card, Micro } from "@/components/ui";
import { Icon } from "@/components/icon";

type Summary = {
  enquiriesThisMonth: number;
  websiteLive: boolean;
  websiteDisabled: boolean;
  websiteSalesThisMonth: number;
};

// Sections 6, 7 and 10 on Home, as one small card: "TradeSura sent you N
// enquiries this month", the "Add TradeSura to your website" nudge until the
// widget is live (then its sales), and the way into Your numbers.
export function GrowthCard() {
  const [s, setS] = useState<Summary | null>(null);

  useFocusEffect(
    useCallback(() => {
      api<Summary>("/api/enquiries/summary").then(setS).catch(() => {});
    }, []),
  );

  if (!s) return null;
  const n = s.enquiriesThisMonth;
  return (
    <Card>
      <Micro className="mb-1">Growth</Micro>
      <Pressable className="flex-row items-center gap-2 py-1.5" onPress={() => router.push("/enquiries")}>
        <Icon name="chat" size={18} color="#9fb6d0" />
        <Text className="flex-1 text-[13px] text-ink">
          TradeSura sent you <Text className="font-bold">{n} enquir{n === 1 ? "y" : "ies"}</Text> this month
        </Text>
        <Icon name="chevron" size={13} color="#9fb6d0" />
      </Pressable>
      {s.websiteLive ? (
        <Pressable className="flex-row items-center gap-2 py-1.5" onPress={() => router.push("/website")}>
          <Icon name="globe" size={18} color="#9fb6d0" />
          <Text className="flex-1 text-[13px] text-ink">
            Your website sold <Text className="font-bold">{s.websiteSalesThisMonth}</Text> plan
            {s.websiteSalesThisMonth === 1 ? "" : "s"} this month
          </Text>
          <Icon name="chevron" size={13} color="#9fb6d0" />
        </Pressable>
      ) : !s.websiteDisabled ? (
        <Pressable className="flex-row items-center gap-2 py-1.5" onPress={() => router.push("/website")}>
          <Icon name="globe" size={18} color="#5fa3f0" />
          <Text className="flex-1 text-[13px] font-semibold text-flame">Add TradeSura to your website</Text>
          <Icon name="chevron" size={13} color="#5fa3f0" />
        </Pressable>
      ) : null}
      <Pressable className="flex-row items-center gap-2 py-1.5" onPress={() => router.push("/your-numbers")}>
        <Icon name="growth" size={18} color="#9fb6d0" />
        <Text className="flex-1 text-[13px] text-ink">Your numbers — ratings, cancellations, enquiries</Text>
        <Icon name="chevron" size={13} color="#9fb6d0" />
      </Pressable>
    </Card>
  );
}
