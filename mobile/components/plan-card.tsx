import { View, Text } from "react-native";
import { Tick, Button } from "@/components/ui";

// Build Guide v2 Part 8 Step 4 / Part 9.1 / Part 15.1 — "the exact
// customer-facing card... same card component as wizard Step 4 and the
// public page." This is that component: title, £X/month in money-green, the
// included lines with white ticks (green is money only — Part 2.1 LAW), and
// an optional white "Choose this plan" action. No engineer chrome, ever.
export function CustomerPlanCard({
  name,
  priceMonthlyPence,
  lines,
  cta,
}: {
  name: string;
  priceMonthlyPence: number;
  lines: string[];
  /** Renders the white primary button under the card when present. */
  cta?: { label: string; onPress: () => void; disabled?: boolean };
}) {
  return (
    <View className="rounded-2xl border border-line bg-paper p-4">
      <View className="flex-row items-baseline justify-between">
        <Text className="font-bold text-lg text-ink">{name}</Text>
        <Text className="font-mono font-extrabold text-ok">
          £{(priceMonthlyPence / 100).toFixed(2).replace(/\.00$/, "")}
          <Text className="text-xs font-bold text-muted">/month</Text>
        </Text>
      </View>
      <View className="mt-2.5 gap-1.5">
        {lines.map((line) => (
          <View key={line} className="flex-row items-start gap-2">
            <Tick size={13} />
            <Text className="flex-1 text-[13px] text-ink">{line}</Text>
          </View>
        ))}
      </View>
      {cta && (
        <Button className="mt-3.5" onPress={cta.onPress} disabled={cta.disabled}>
          {cta.label}
        </Button>
      )}
    </View>
  );
}
