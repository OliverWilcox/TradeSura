import type { ReactNode } from "react";
import { View, Text, Pressable } from "react-native";

// RN port of ../../components/ui.tsx — same primitives, same tokens.
// Design system: TradeSura Build Spec v1 §1 (TS Blue, money-green, light
// chrome, system font). Text can't contain arbitrary block layout in RN, so
// RowLine's slots accept a plain string (wrapped in Text) or a composed node.

// Home shows the wordmark; every other screen shows a plain bold title
// (matches the interactive prototype's appbars).
export function AppHeader({ title, right }: { title?: string; right?: ReactNode }) {
  return (
    <View className="flex-row items-center justify-between border-b border-line bg-paper px-4 py-3">
      {title ? (
        <Text className="text-[17px] font-bold text-ink">{title}</Text>
      ) : (
        <Text className="text-lg font-extrabold tracking-tight text-flame">
          TradeSura<Text className="text-copper">✓</Text>
        </Text>
      )}
      {right}
    </View>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <View className={`rounded-[14px] border border-line bg-paper p-4 ${className}`}>{children}</View>
  );
}

export function Micro({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <Text
      className={`text-[11px] font-bold uppercase tracking-[0.08em] text-muted ${className}`}
    >
      {children}
    </Text>
  );
}

const pillStyles = {
  ok: "bg-ok-tint text-ok",
  warn: "bg-warn-tint text-warn",
  info: "bg-flame-tint text-flame-deep",
  off: "border border-line bg-panel text-muted",
  danger: "bg-danger text-white",
} as const;

export function Pill({ tone, children }: { tone: keyof typeof pillStyles; children: ReactNode }) {
  return (
    <Text
      className={`self-start overflow-hidden rounded-full px-2.5 py-1 text-[10px] font-extrabold tracking-[0.04em] ${pillStyles[tone]}`}
    >
      {children}
    </Text>
  );
}

export function RowLine({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <View className="flex-row items-center justify-between gap-2 border-b border-line-soft py-2.5 last:border-b-0">
      <View className="shrink">
        {typeof left === "string" ? <Text className="text-sm text-ink">{left}</Text> : left}
      </View>
      {right !== undefined && (
        <View>
          {typeof right === "string" ? (
            <Text className="text-sm text-ink">{right}</Text>
          ) : (
            right
          )}
        </View>
      )}
    </View>
  );
}

export function Money({
  pence,
  suffix = "",
  className = "",
}: {
  pence: number;
  suffix?: string;
  className?: string;
}) {
  const pounds = pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`;
  return (
    <Text className={`font-mono font-extrabold text-ink ${className}`}>
      {pounds}
      {suffix}
    </Text>
  );
}

const btnVariants = {
  flame: { container: "bg-flame", text: "text-white" },
  copper: { container: "bg-flame", text: "text-white" }, // legacy alias → primary blue
  green: { container: "bg-ok", text: "text-white" },
  ghost: { container: "border-[1.5px] border-flame bg-paper", text: "text-flame-deep" },
  dangerghost: { container: "border-[1.5px] border-danger-tint bg-paper", text: "text-danger" },
} as const;

export function Button({
  children,
  onPress,
  variant = "flame",
  disabled,
  className = "",
}: {
  children: ReactNode;
  onPress?: () => void;
  variant?: keyof typeof btnVariants;
  disabled?: boolean;
  className?: string;
}) {
  const v = btnVariants[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`items-center rounded-xl px-4 py-3.5 ${v.container} ${disabled ? "opacity-50" : ""} ${className}`}
    >
      {typeof children === "string" ? (
        <Text className={`text-sm font-bold ${v.text}`}>{children}</Text>
      ) : (
        children
      )}
    </Pressable>
  );
}
