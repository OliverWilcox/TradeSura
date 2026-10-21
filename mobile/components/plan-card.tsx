import { View, Text, Pressable } from "react-native";
import { Tick, Button } from "@/components/ui";
import { Icon } from "@/components/icon";

export type PlanLine = string | { title: string; note?: string | null };

function pounds(pence: number) {
  return `£${(pence / 100).toFixed(2).replace(/\.00$/, "")}`;
}

// Build Guide v2 Part 8 Step 4 / Part 9.1 / Part 15.1 — "the exact
// customer-facing card... same card component as wizard Step 4 and the
// public page." Title, £X a month in money-green, the included lines with
// white ticks (green is money only — Part 2.1 LAW). With `engineer` it adds
// the public page's header (initials, trading name, Gas Safe badge) and the
// customer's green Join, the one green button CLAUDE.md allows.
export function CustomerPlanCard({
  name,
  priceMonthlyPence,
  lines,
  cta,
  engineer,
  showJoin = false,
  cancelChip = false,
}: {
  name: string;
  priceMonthlyPence: number;
  lines: PlanLine[];
  /** Renders the white primary button under the card when present. */
  cta?: { label: string; onPress: () => void; disabled?: boolean };
  engineer?: { tradingName: string; verified: boolean };
  /** A non-interactive preview of the customer's Join button. */
  showJoin?: boolean;
  cancelChip?: boolean;
}) {
  const initials = (engineer?.tradingName ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <View className="rounded-2xl border border-line-strong bg-paper p-4">
      {engineer && (
        <View className="mb-3 flex-row flex-wrap items-center gap-2">
          <View className="h-9 w-9 items-center justify-center rounded-full bg-flame-deep">
            <Text className="text-[13px] font-bold text-white">{initials}</Text>
          </View>
          <Text className="text-[15px] font-semibold text-ink">{engineer.tradingName}</Text>
          {/* Never claimed for an engineer who isn't actually verified. */}
          {engineer.verified && (
            <View className="flex-row items-center gap-1 rounded-full border border-line-strong px-2 py-0.5">
              <Tick credential size={11} />
              <Text className="text-[11px] text-ink">Gas Safe verified</Text>
            </View>
          )}
        </View>
      )}
      {engineer ? (
        <>
          <Text className="text-[22px] font-bold text-ink">{name}</Text>
          <Text className="mt-0.5 text-[15px] text-ink">
            <Text className="font-bold text-ok">{pounds(priceMonthlyPence)}</Text> a month
          </Text>
        </>
      ) : (
        <View className="flex-row items-baseline justify-between">
          <Text className="font-bold text-lg text-ink">{name}</Text>
          <Text className="font-mono font-extrabold text-ok">
            {pounds(priceMonthlyPence)}
            <Text className="text-xs font-bold text-muted">/month</Text>
          </Text>
        </View>
      )}
      {cancelChip && (
        <Text className="mt-2.5 self-start overflow-hidden rounded-full bg-flame-tint px-2.5 py-1 text-[12px] font-semibold text-flame">
          Cancel anytime
        </Text>
      )}
      <View className="mt-2.5 gap-1.5">
        {lines.map((line) => {
          const l = typeof line === "string" ? { title: line } : line;
          return (
            <View key={l.title} className="flex-row items-start gap-2">
              <View className="pt-0.5">
                <Tick size={13} />
              </View>
              <View className="flex-1">
                <Text className="text-[13.5px] text-ink">{l.title}</Text>
                {l.note && <Text className="text-[12px] text-muted">{l.note}</Text>}
              </View>
            </View>
          );
        })}
      </View>
      {showJoin && (
        <View className="mt-3.5 items-center rounded-xl bg-ok py-3">
          <Text className="text-sm font-bold text-on-light">Join</Text>
        </View>
      )}
      {cta && (
        <Button className="mt-3.5" onPress={cta.onPress} disabled={cta.disabled}>
          {cta.label}
        </Button>
      )}
    </View>
  );
}

// "WHAT YOUR CUSTOMER SEES" — the small preview on the price step.
export function CustomerPlanPeek({
  tradingName,
  name,
  priceMonthlyPence,
  lines,
  max = 3,
  onPress,
}: {
  tradingName: string;
  name: string;
  priceMonthlyPence: number;
  lines: PlanLine[];
  max?: number;
  onPress?: () => void;
}) {
  const shown = lines.slice(0, max).map((l) => (typeof l === "string" ? l : l.title));
  return (
    <Pressable onPress={onPress} disabled={!onPress} className="rounded-xl border border-line-strong bg-paper-2 p-3.5">
      <Text className="text-[13.5px] text-ink" numberOfLines={1}>
        <Text className="font-bold">{tradingName}</Text> · {name} ·{" "}
        <Text className="font-bold text-ok">{pounds(priceMonthlyPence)}</Text> a month
      </Text>
      <View className="mt-2 gap-1">
        {shown.map((t) => (
          <View key={t} className="flex-row items-center gap-2">
            <Icon name="check" size={12} weight="bold" />
            <Text className="flex-1 text-[12.5px] text-ink" numberOfLines={1}>
              {t}
            </Text>
          </View>
        ))}
        {lines.length > max && (
          <Text className="pl-5 text-[12px] text-muted">+ {lines.length - max} more</Text>
        )}
      </View>
      <View className="mt-2.5 self-start rounded-lg bg-ok px-4 py-1.5">
        <Text className="text-[13px] font-bold text-on-light">Join</Text>
      </View>
    </Pressable>
  );
}
