import type { ReactNode } from "react";
import { View, Text, Pressable } from "react-native";
import * as Haptics from "expo-haptics";

// RN throws "Text strings must be rendered within a <Text> component" the
// moment JSX text is a *sibling* of an interpolation (e.g. `Text {n} more`
// compiles to multiple children, not one string) rather than a single
// `{...}` expression — Button used to only wrap children in <Text> when
// `typeof children === "string"`, which misses exactly that case. This
// checks every child instead, so any plain-text-shaped children get wrapped
// regardless of how many pieces they came in as.
function isTextLike(node: ReactNode): boolean {
  if (node === null || node === undefined || typeof node === "boolean") return true;
  if (typeof node === "string" || typeof node === "number") return true;
  if (Array.isArray(node)) return node.every(isTextLike);
  return false;
}

// RN port of ../../components/ui.tsx — same primitives, same tokens.
// Design system: TradeSura Screen Designs v2 · Full Dark (navy depth, brand
// blue, money-green, system font — see CLAUDE.md's [DECISION] for the switch
// from the earlier light system). Text can't contain arbitrary block layout
// in RN, so RowLine's slots accept a plain string (wrapped in Text) or a
// composed node.

// Home shows the wordmark; every other screen shows a plain bold title
// (matches the interactive prototype's appbars).
export function AppHeader({ title, right }: { title?: string; right?: ReactNode }) {
  return (
    <View className="flex-row items-center justify-between border-b border-line bg-bg-deep px-4 py-3">
      {title ? (
        <Text className="text-[17px] font-bold text-ink">{title}</Text>
      ) : (
        <Text className="text-lg font-extrabold tracking-tight text-white">
          TRADE<Text className="text-flame">SURA</Text>
          <Text className="text-copper">✓</Text>
        </Text>
      )}
      {right}
    </View>
  );
}

// `variant` picks the card treatment from v2: `flat` (default, most cards),
// `raised` (surface-2→surface gradient + shadow, for the active/highlighted
// item in a list), `hero` (the deep navy gradient reserved for money cards
// and celebration moments — the screen's one big money moment).
export function Card({
  children,
  className = "",
  variant = "flat",
}: {
  children: ReactNode;
  className?: string;
  variant?: "flat" | "raised" | "hero";
}) {
  // Plain solid-colour Views, not a gradient — expo-linear-gradient needs a
  // native rebuild to work (it showed as "Unimplemented component" on a
  // binary built before the dependency was added), so this uses each
  // gradient's midpoint colour as a flat approximation that works in any
  // already-built binary. Revisit once a fresh dev/production build exists.
  if (variant === "hero") {
    return (
      <View
        style={{ backgroundColor: "#152e52" }}
        className={`rounded-2xl border border-line-strong p-4 ${className}`}
      >
        {children}
      </View>
    );
  }
  if (variant === "raised") {
    return (
      <View
        style={{ backgroundColor: "#1b2d48" }}
        className={`rounded-2xl border border-line-strong p-4 ${className}`}
      >
        {children}
      </View>
    );
  }
  return (
    <View className={`rounded-2xl border border-line bg-paper p-4 ${className}`}>{children}</View>
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

// Status pills always carry text, never colour alone (v2 legibility rule) —
// every tone below is a tinted background + matching-hue text, never a solid
// fill (the old solid `danger` fill is replaced with the same tint pattern).
const pillStyles = {
  ok: "bg-ok-tint text-ok",
  warn: "bg-warn-tint text-warn",
  info: "bg-flame-tint text-flame",
  off: "border border-line bg-line-soft text-muted",
  danger: "bg-danger-tint text-danger",
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
    <Text className={`font-mono font-extrabold text-ok ${className}`}>
      {pounds}
      {suffix}
    </Text>
  );
}

// v2 rule: primary is white-on-navy (not a filled brand colour) — it's the
// signature and the brightest object on screen, one per screen. Green is
// reserved for the customer's "Join" and the engineer's WhatsApp share, the
// only two green buttons in the app. Disabled is opacity, never a colour swap.
const btnVariants = {
  flame: { container: "bg-white", text: "text-on-light" },
  copper: { container: "bg-white", text: "text-on-light" }, // legacy alias → primary
  green: { container: "bg-ok", text: "text-[#052614]" },
  ghost: { container: "border-[1.5px] border-white/55 bg-transparent", text: "text-white" },
  dangerghost: { container: "border-[1.5px] border-danger bg-transparent", text: "text-danger" },
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
  // v2: "Haptics: light on primary taps" — the white primary button only,
  // not every ghost/secondary action.
  const isPrimary = variant === "flame" || variant === "copper";
  function handlePress() {
    if (isPrimary) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress?.();
  }
  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      className={`items-center rounded-xl px-4 py-3.5 ${v.container} ${disabled ? "opacity-50" : ""} ${className}`}
    >
      {isTextLike(children) ? (
        <Text className={`text-sm font-bold ${v.text}`}>{children}</Text>
      ) : (
        children
      )}
    </Pressable>
  );
}
