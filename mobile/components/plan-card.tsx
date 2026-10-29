import { View, Text, Pressable } from "react-native";
import { Button, businessInitials } from "@/components/ui";
import { Icon } from "@/components/icon";

export type PlanLine = string | { title: string; note?: string | null };

function pounds(pence: number) {
  return `£${(pence / 100).toFixed(2).replace(/\.00$/, "")}`;
}

// The customer's view of a plan, as the 2026 Build Guide targets draw it on
// the builder's steps 2–4: a white card, navy text, blue ticks, a green
// "Cancel anytime" chip and the customer's blue Join. (2026 guide wins over
// Build Guide v2's colour rules — see CLAUDE.md.)
const NAVY = "#0B1A2E";
const JOIN_BLUE = "#1F5FC4";
const TICK_BLUE = "#1F5FC4";

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
  const initials = businessInitials(engineer?.tradingName);
  return (
    <View>
      <View className="rounded-2xl bg-white p-4">
        {engineer && (
          <View className="mb-3 flex-row flex-wrap items-center gap-2.5">
            <View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: JOIN_BLUE }}>
              <Text className="text-[14px] font-bold text-white">{initials}</Text>
            </View>
            <Text className="text-[16px] font-bold" style={{ color: NAVY }}>
              {engineer.tradingName}
            </Text>
            {/* Never claimed for an engineer who isn't actually verified. */}
            {engineer.verified && (
              <View className="flex-row items-center gap-1.5 rounded-full border border-[#D5DDE8] px-2.5 py-1">
                <Icon name="verified" size={14} color={JOIN_BLUE} />
                <Text className="text-[12.5px]" style={{ color: NAVY }}>
                  Gas Safe verified
                </Text>
              </View>
            )}
          </View>
        )}
        <Text className="text-[24px] font-bold" style={{ color: NAVY }}>
          {name}
        </Text>
        <Text className="mt-0.5 text-[16px]" style={{ color: NAVY }}>
          {pounds(priceMonthlyPence)} a month
        </Text>
        {cancelChip && (
          <Text className="mt-2.5 self-start overflow-hidden rounded-full bg-[#E3EEFB] px-3 py-1 text-[13px] text-[#1F4E8C]">
            Cancel anytime
          </Text>
        )}
        <View className="mt-2.5 gap-2">
          {lines.map((line) => {
            const l = typeof line === "string" ? { title: line } : line;
            return (
              <View key={l.title} className="flex-row items-start gap-2.5">
                <View className="pt-0.5">
                  <Icon name="check" size={15} color={TICK_BLUE} weight="bold" />
                </View>
                <View className="flex-1">
                  <Text className="text-[15px]" style={{ color: NAVY }}>
                    {l.title}
                  </Text>
                  {l.note && <Text className="text-[13px] text-[#5B6B82]">{l.note}</Text>}
                </View>
              </View>
            );
          })}
          {/* Retention spec — every plan comes with the home's passport. */}
          {cancelChip && (
            <View className="flex-row items-start gap-2.5">
              <View className="pt-0.5">
                <Icon name="check" size={15} color={TICK_BLUE} weight="bold" />
              </View>
              <Text className="flex-1 text-[15px]" style={{ color: NAVY }}>
                Your Home Passport
              </Text>
            </View>
          )}
        </View>
        {cancelChip && (
          <Text className="mt-2.5 text-[13px] text-[#5B6B82]">First payment after your 14-day cooling-off period.</Text>
        )}
        {showJoin && (
          <View className="mt-4 items-center rounded-xl py-3" style={{ backgroundColor: JOIN_BLUE }}>
            <Text className="text-[16px] font-semibold text-white">Join</Text>
          </View>
        )}
      </View>
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
    <Pressable onPress={onPress} disabled={!onPress} className="rounded-xl bg-white p-3.5">
      <Text className="text-[14px]" style={{ color: NAVY }} numberOfLines={1}>
        <Text className="font-bold">{tradingName}</Text> · {name} · {pounds(priceMonthlyPence)} a month
      </Text>
      <View className="mt-2 gap-1">
        {shown.map((t) => (
          <View key={t} className="flex-row items-center gap-2">
            <Icon name="check" size={13} color={NAVY} weight="bold" />
            <Text className="flex-1 text-[13.5px]" style={{ color: NAVY }} numberOfLines={1}>
              {t}
            </Text>
          </View>
        ))}
        {lines.length > max && (
          <Text className="pl-5 text-[12.5px] text-[#5B6B82]">+ {lines.length - max} more</Text>
        )}
      </View>
      <View className="mt-2.5 self-start rounded-md px-5 py-1.5" style={{ backgroundColor: JOIN_BLUE }}>
        <Text className="text-[14px] text-white">Join</Text>
      </View>
    </Pressable>
  );
}
