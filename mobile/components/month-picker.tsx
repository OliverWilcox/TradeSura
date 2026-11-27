import { View, Text, Pressable } from "react-native";

// Build Guide v2 Part 9.3 — "Last boiler service (optional) — a month
// picker." No date-picker library is installed here yet, so this is a
// minimal month/year stepper rather than a native calendar widget; good
// enough for a month-level date that only ever feeds the reminder engine.
export function MonthPicker({
  value,
  onChange,
}: {
  value: Date | null;
  onChange: (next: Date | null) => void;
}) {
  const now = new Date();

  function step(delta: number) {
    const base = value ?? now;
    const next = new Date(base.getFullYear(), base.getMonth() + delta, 1);
    if (next.getTime() > new Date(now.getFullYear(), now.getMonth(), 1).getTime()) return;
    onChange(next);
  }

  return (
    <View className="gap-1.5">
      <View className="flex-row items-center justify-between rounded-[10px] border border-line bg-paper px-3 py-2.5">
        <Pressable
          onPress={() => step(-1)}
          hitSlop={8}
          className="h-8 w-8 items-center justify-center rounded-lg border border-line"
        >
          <Text className="text-lg font-bold text-flame">−</Text>
        </Pressable>
        <Text className="font-sans text-sm text-ink">
          {value ? value.toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : "Not sure — skip"}
        </Text>
        {value ? (
          <Pressable onPress={() => step(1)} hitSlop={8} className="h-8 w-8 items-center justify-center rounded-lg border border-line">
            <Text className="text-lg font-bold text-flame">＋</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => onChange(now)} hitSlop={8} className="h-8 min-w-8 items-center justify-center px-1">
            <Text className="font-semibold text-sm text-flame">Set</Text>
          </Pressable>
        )}
      </View>
      {value && (
        <Pressable onPress={() => onChange(null)} hitSlop={8} className="self-start">
          <Text className="font-sans text-[13px] text-muted">Clear</Text>
        </Pressable>
      )}
    </View>
  );
}
