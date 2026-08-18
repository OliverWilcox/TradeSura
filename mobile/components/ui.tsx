import type { ReactNode } from "react";
import { View, Text, Pressable } from "react-native";

// RN port of ../../components/ui.tsx — same primitives, same tokens. Text
// can't contain arbitrary block layout in RN, so RowLine's slots accept
// either a plain string (wrapped in Text) or a pre-composed element.

// RN port of ../../components/shells.tsx's AppShell top bar — rendered
// per-screen (not as the Tabs navigator header) so each tab can supply its
// own `right` content, same as the web version's `topRight` prop.
export function AppHeader({ right }: { right?: ReactNode }) {
  return (
    <View className="flex-row items-center justify-between bg-iron px-4 py-3">
      <Text className="font-disp-bold text-lg uppercase tracking-wide text-white">
        Trade<Text className="text-flame">Sura</Text>
      </Text>
      {right}
    </View>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <View className={`rounded-xl border border-line bg-paper p-4 ${className}`}>{children}</View>;
}

export function Micro({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <Text className={`font-mono-medium text-[10px] uppercase tracking-widest text-faint ${className}`}>
      {children}
    </Text>
  );
}

const pillStyles = {
  ok: "bg-ok-tint text-ok",
  warn: "bg-warn-tint text-[#9A6C0C]",
  info: "bg-flame-tint text-flame-deep",
  off: "border border-line bg-panel text-faint",
  danger: "bg-danger text-white",
} as const;

export function Pill({ tone, children }: { tone: keyof typeof pillStyles; children: ReactNode }) {
  return (
    <Text
      className={`self-start overflow-hidden rounded-full px-2.5 py-1 font-mono-medium text-[10px] ${pillStyles[tone]}`}
    >
      {children}
    </Text>
  );
}

export function RowLine({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <View className="flex-row items-center justify-between gap-2 border-b border-line-soft py-2.5 last:border-b-0">
      <View className="shrink">
        {typeof left === "string" ? <Text className="font-sans text-sm text-ink">{left}</Text> : left}
      </View>
      {right !== undefined && (
        <View>
          {typeof right === "string" ? (
            <Text className="font-sans text-sm text-ink">{right}</Text>
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
    <Text className={`font-mono-semibold text-ink ${className}`}>
      {pounds}
      {suffix}
    </Text>
  );
}

const btnVariants = {
  flame: { container: "bg-flame", text: "text-white" },
  copper: { container: "bg-copper", text: "text-white" },
  ghost: { container: "border-[1.5px] border-flame bg-transparent", text: "text-flame-deep" },
  dangerghost: { container: "border-[1.5px] border-danger-tint bg-transparent", text: "text-danger" },
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
      className={`items-center rounded-[10px] px-4 py-3 ${v.container} ${disabled ? "opacity-50" : ""} ${className}`}
    >
      {typeof children === "string" ? (
        <Text className={`font-sans-semibold text-sm ${v.text}`}>{children}</Text>
      ) : (
        children
      )}
    </Pressable>
  );
}
