import { View, Text, Pressable, Image } from "react-native";
import { Button, businessInitials } from "@/components/ui";
import { Icon } from "@/components/icon";

export type PlanLine = string | { title: string; note?: string | null };

function pounds(pence: number) {
  return `£${(pence / 100).toFixed(2).replace(/\.00$/, "")}`;
}
// 30 Oct update §5 — a draft's price starts blank (0).
function priceText(pence: number) {
  return pence > 0 ? `${pounds(pence)} a month` : "Price not set yet";
}

// The customer's view of a plan, as the 2026 Build Guide targets draw it on
// the builder's steps 2–4: a white card, navy text, blue ticks, a green
// "Cancel anytime" chip and the customer's blue Join. (2026 guide wins over
// Build Guide v2's colour rules — see CLAUDE.md.)
const NAVY = "#0B1A2E";
const JOIN_BLUE = "#1F5FC4";
const TICK_BLUE = "#1F5FC4";
const BADGE = require("../assets/brand/verified-member-badge.png");

// Review 4 — the supplied Verified Member badge artwork (never redrawn), only
// for an engineer whose Gas Safe check is done.
function VerifiedChip({ small = false }: { small?: boolean }) {
  return (
    <View className="flex-row items-center gap-1.5 self-start rounded-full border border-[#D5DDE8] py-0.5 pl-0.5 pr-2.5">
      <Image source={BADGE} style={{ width: small ? 18 : 22, height: small ? 18 : 22 }} accessibilityLabel="TradeSura Verified Member badge" />
      <Text className={small ? "text-[11.5px]" : "text-[12.5px]"} style={{ color: NAVY }}>
        Verified Member · Gas Safe verified
      </Text>
    </View>
  );
}

// Before the check is done the preview says where the badge will go,
// rather than claiming it.
function BadgeHint() {
  return <Text className="text-[12px] text-[#5B6B82]">Your badge appears once your Gas Safe check is done</Text>;
}

export function CustomerPlanCard({
  name,
  priceMonthlyPence,
  lines,
  cta,
  engineer,
  showJoin = false,
  cancelChip = false,
  badgeHint = false,
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
  /** Builder previews: say where the badge will appear before verification. */
  badgeHint?: boolean;
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
            {engineer.verified && <VerifiedChip />}
          </View>
        )}
        {engineer && !engineer.verified && badgeHint && (
          <View className="-mt-1.5 mb-3">
            <BadgeHint />
          </View>
        )}
        <Text className="text-[24px] font-bold" style={{ color: NAVY }}>
          {name}
        </Text>
        <Text className="mt-0.5 text-[16px]" style={{ color: NAVY }}>
          {priceText(priceMonthlyPence)}
        </Text>
        {cancelChip && (
          <Text className="mt-2.5 self-start overflow-hidden rounded-full bg-[#E3EEFB] px-3 py-1 text-[13px] text-[#1F4E8C]">
            Cancel any time. No contract.
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
  verified,
}: {
  tradingName: string;
  name: string;
  priceMonthlyPence: number;
  lines: PlanLine[];
  max?: number;
  onPress?: () => void;
  /** When given, the peek shows the badge (or where it will go) like the real page. */
  verified?: boolean;
}) {
  const shown = lines.slice(0, max).map((l) => (typeof l === "string" ? { title: l, note: null } : l));
  return (
    <Pressable onPress={onPress} disabled={!onPress} className="rounded-xl bg-white p-3.5">
      <Text className="text-[14px]" style={{ color: NAVY }} numberOfLines={1}>
        <Text className="font-bold">{tradingName}</Text> · {name} · {priceText(priceMonthlyPence)}
      </Text>
      {verified !== undefined && <View className="mt-2">{verified ? <VerifiedChip small /> : <BadgeHint />}</View>}
      <Text className="mt-2 self-start overflow-hidden rounded-full bg-[#E3EEFB] px-2.5 py-0.5 text-[12px] text-[#1F4E8C]">
        Cancel any time. No contract.
      </Text>
      <View className="mt-2 gap-1">
        {shown.map((t) => (
          <View key={t.title} className="flex-row items-start gap-2">
            <View className="pt-0.5">
              <Icon name="check" size={13} color={NAVY} weight="bold" />
            </View>
            <View className="flex-1">
              <Text className="text-[13.5px]" style={{ color: NAVY }} numberOfLines={1}>
                {t.title}
              </Text>
              {/* e.g. the annual service: "available after your third payment". */}
              {t.note ? <Text className="text-[12px] text-[#5B6B82]">{t.note}</Text> : null}
            </View>
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
