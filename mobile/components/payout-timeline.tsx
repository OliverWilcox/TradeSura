import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { api } from "@/lib/api";
import { Micro } from "@/components/ui";

type Timeline = {
  joinedAt: string;
  coolingOffEndsAt: string;
  firstCollectionAt: string;
  clearsAt: string;
  payoutAt: string;
};
type View_ = { basis: "customer" | "example"; customerFirstName: string | null; timeline: Timeline };

// "Fri 27 Nov" — the dates are whole UK days (lib/payout-timeline.ts).
function day(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

// Matt, 30 Oct §9.3 — joins › 14-day cooling-off › first collection › about
// 3 working days for Bacs › Friday payout, with real dates. On the payment
// screen and the Payouts tab. Renders nothing until the dates arrive.
export function PayoutTimeline({ refreshKey }: { refreshKey?: unknown }) {
  const [data, setData] = useState<View_ | null>(null);

  useEffect(() => {
    api<View_>("/api/payouts/timeline")
      .then(setData)
      .catch(() => {});
  }, [refreshKey]);

  if (!data) return null;
  const t = data.timeline;
  const who = data.customerFirstName;
  const steps: [string, string][] = [
    [who ? `${who} joined` : "A customer joins today", day(t.joinedAt)],
    ["14-day cooling-off ends", day(t.coolingOffEndsAt)],
    ["First payment taken by Direct Debit", day(t.firstCollectionAt)],
    ["Payment clears (about 3 working days)", day(t.clearsAt)],
    [who ? "Your first payout" : "Paid to your bank", day(t.payoutAt)],
  ];

  return (
    <View className="rounded-2xl border border-line-strong p-4">
      <Micro className="mb-2">{who ? "When you get paid" : "How the money reaches you"}</Micro>
      {steps.map(([label, date], i) => (
        <View key={label} className="flex-row items-center gap-3 py-1.5">
          <View className="items-center" style={{ width: 22 }}>
            <View
              className={i === steps.length - 1 ? "h-3 w-3 rounded-full bg-flame" : "h-2.5 w-2.5 rounded-full border-2 border-flame"}
            />
          </View>
          <Text className="flex-1 text-[14.5px] text-ink">{label}</Text>
          <Text className={i === steps.length - 1 ? "text-[14.5px] font-bold text-ink" : "text-[14.5px] text-muted"}>
            {date}
          </Text>
        </View>
      ))}
      <Text className="mt-2 text-[12px] leading-[17px] text-muted">
        Paid every Friday. Stripe holds a new account&apos;s first payout for about 7 days, so the first one takes a
        little longer; after that, each payment reaches you the Friday after it clears.
      </Text>
    </View>
  );
}
