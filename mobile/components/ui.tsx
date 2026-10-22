import { useEffect, useState, type ReactNode } from "react";
import { View, Text, Pressable, Modal, Animated } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/lib/auth-context";
import { Icon } from "@/components/icon";
import { RingMark } from "@/components/ring-mark";
import { LoadingImage } from "@/components/skeleton";

// Build Guide v2 Part 2.2 — the brand mark, never redrawn as a plain
// circle. Rebrand, 22 Sept — sharp-cut ring replaces the old soft
// rounded-pill ring, on direct instruction. First shipped as a raster PNG
// (JPEG export, background removed) but that looked visibly
// pixellated/jagged at real display sizes — hard-threshold alpha keying
// has no edge antialiasing. Lockup and the ring mark are now real vector
// components (RingMark, components/ring-mark.tsx) instead of flat images:
// crisp at any size, and the wordmark is live Text rather than baked into
// a raster, so it can never end up off-ratio or blurry from scaling either.

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

// Build Guide v2 Part 2: two header shapes and nothing else.
//  - Tab screens: the ring + wordmark lockup top-left ("In-app masthead =
//    ring + wordmark lockup, exact asset, top-left of every tab screen"),
//    avatar top-right.
//  - Pushed pages: back chevron with the title left-aligned beside it
//    (Part 2.4 — "a couple of pictures centre them"; the text wins).
// The retired "TRADESURA ✓" text mark is gone — every header wears the
// final lockup.
export function AppHeader({ title, right }: { title?: string; right?: ReactNode }) {
  if (!title) {
    return (
      <View className="flex-row items-center justify-between border-b border-line bg-bg-deep px-4 py-3">
        <Lockup height={26} />
        {right ?? <Avatar />}
      </View>
    );
  }
  return (
    <View className="flex-row items-center justify-between border-b border-line bg-bg-deep px-3 py-3">
      <View className="flex-1 flex-row items-center gap-1.5">
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="h-8 w-8 items-center justify-center"
        >
          <Icon name="back" size={20} weight="semibold" />
        </Pressable>
        <Text className="shrink text-[17px] font-bold text-ink" numberOfLines={1}>
          {title}
        </Text>
      </View>
      {right}
    </View>
  );
}

export function Lockup({ height = 26 }: { height?: number }) {
  // Ring + live "Trade"/"Sura" text, sized off one prop the same way the
  // old flat image was — callers (AppHeader, sign-in, sign-up, welcome)
  // don't need to change. Proportions (text cap-height vs. ring diameter,
  // the gap between them) matched by eye against the original lockup
  // composition rather than measured, since there's no longer a fixed
  // image aspect ratio to derive them from.
  const fontSize = Math.round(height * 0.72);
  return (
    <View
      className="flex-row items-center"
      style={{ gap: Math.round(height * 0.14) }}
      accessibilityLabel="TradeSura"
    >
      <RingMark size={height} />
      <Text style={{ fontSize, lineHeight: fontSize * 1.05 }} className="font-extrabold">
        <Text className="text-white">Trade</Text>
        <Text style={{ color: "#5FA3F0" }}>Sura</Text>
      </Text>
    </View>
  );
}

// Part 2.4: initials are first + last name ("MW"), not the email's first
// letter. The credential tick (Part 2.1 — the one green thing that isn't a
// £ figure) sits on the avatar once Gas Safe verification has been granted.
export function initials(me: { firstName?: string | null; lastName?: string | null; tradingName?: string | null; email?: string } | null | undefined): string {
  if (!me) return "";
  const fromName = `${me.firstName?.[0] ?? ""}${me.lastName?.[0] ?? ""}`;
  if (fromName) return fromName.toUpperCase();
  const words = (me.tradingName ?? "").split(/\s+/).filter(Boolean);
  if (words.length) return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (me.email?.[0] ?? "").toUpperCase();
}

export function Avatar({ size = 32 }: { size?: number }) {
  const { me } = useAuth();
  const verified = Boolean(me?.gasSafeVerifiedAt);
  return (
    <Pressable
      onPress={() => router.push("/more")}
      accessibilityRole="button"
      accessibilityLabel="Account"
      hitSlop={8}
      style={{ width: size, height: size }}
    >
      <View
        className="items-center justify-center overflow-hidden rounded-full bg-paper-3"
        style={{ width: size, height: size }}
      >
        {me?.logoUrl ? (
          <LoadingImage uri={me.logoUrl} width={size} height={size} />
        ) : (
          <Text className="font-bold text-ink" style={{ fontSize: Math.round(size * 0.36) }}>
            {initials(me)}
          </Text>
        )}
      </View>
      {verified && (
        <View
          className="absolute items-center justify-center rounded-full bg-bg-deep"
          style={{ right: -3, bottom: -3, width: 16, height: 16 }}
        >
          <Icon name="verified" size={13} color="#3dd68c" />
        </View>
      )}
    </Pressable>
  );
}

// Part 2.4: "Plan-benefit list ticks are white ... the small green tick
// belongs to the credential line only." `credential` is the one exception.
export function Tick({ credential = false, size = 14 }: { credential?: boolean; size?: number }) {
  return (
    <Icon
      name={credential ? "verified" : "check"}
      size={size}
      color={credential ? "#3dd68c" : "#f3f7fb"}
      weight="bold"
    />
  );
}

// Chevron for tappable rows.
export function Chevron() {
  return <Icon name="chevron" size={14} color="#6e86a3" weight="semibold" />;
}

// Build Guide v2 Part 3 / 6.5 — the soft-gate pattern. "Rooms are never
// locked; actions are." A gated thing stays visible, muted and tappable;
// the tap opens this short sheet with the reason and the route back. Never
// hidden, never silently dead. Strings come from Part 18, verbatim.
export function GateSheet({
  visible,
  onClose,
  reason,
  cta = "Continue setup",
  onCta,
  amber,
  demo,
}: {
  visible: boolean;
  onClose: () => void;
  reason: string;
  cta?: string;
  onCta: () => void;
  /** Review 3 — the offer lock reads amber ("needs doing"). */
  amber?: boolean;
  /** Review 3 — "Try it in demo mode" while offers are locked. */
  demo?: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/60" onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="rounded-t-3xl border-t border-line-strong bg-paper px-5 pb-10 pt-4"
        >
          <View className="mb-4 h-1 w-10 self-center rounded-full bg-line-strong" />
          <Text className={`text-[16px] font-semibold leading-6 ${amber ? "text-warn" : "text-ink"}`}>{reason}</Text>
          <Button
            className="mt-4"
            onPress={() => {
              onClose();
              onCta();
            }}
          >
            {cta}
          </Button>
          {demo && (
            <Button
              variant="ghost"
              className="mt-2"
              onPress={() => {
                onClose();
                demo();
              }}
            >
              Try it in demo mode
            </Button>
          )}
          <Pressable onPress={onClose} className="mt-2 items-center py-2.5">
            <Text className="text-sm font-semibold text-muted">Not now</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
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

// Build Review 3, §3 — every screen opens with a bold white heading and a
// one-line grey intro saying what to do here.
export function ScreenTitle({ title, intro }: { title: string; intro?: ReactNode }) {
  return (
    <View className="gap-1">
      <Text className="text-[28px] font-extrabold tracking-tight text-ink">{title}</Text>
      {intro ? <Text className="text-[15px] leading-[21px] text-muted">{intro}</Text> : null}
    </View>
  );
}

// Build Review 3, §3 — section headings in light blue #5FA3F0, uppercase,
// larger than the old Micro labels. Micro stays for small in-card labels.
export function SectionHeading({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <Text className={`text-[13px] font-bold uppercase tracking-[0.1em] text-flame ${className}`}>
      {children}
    </Text>
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
// Build Guide v2 Part 2.1: blue = info / live-count chips, amber = pending,
// red = broken or needs-you. `ok` is green and green is money — only a chip
// whose content is a £ figure may use it; status words ("live", "on plan",
// "auto") are `info`.
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
    <Text className={`font-extrabold tabular-nums text-ok ${className}`}>
      {pounds}
      {suffix}
    </Text>
  );
}

// v2 rule: primary is white-on-navy (not a filled brand colour) — it's the
// signature and the brightest object on screen, one per screen. Build Guide
// v2 Part 2.1: green is money, so there is no green button in the engineer
// app — the WhatsApp share is a white primary too (the customer's green
// "Join" lives on the web surface). Disabled is opacity, never a colour swap.
const btnVariants = {
  flame: { container: "bg-white", text: "text-on-light" },
  copper: { container: "bg-white", text: "text-on-light" }, // legacy alias → primary
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

// Build Guide v2 Part 17.1 — the moment between tapping "Set up payments"
// and Stripe's page appearing: "Opening Stripe" + animated blue dots.
export function OpeningStripe() {
  const [dots] = useState(() => [0, 1, 2].map(() => new Animated.Value(0.3)));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.stagger(
        160,
        dots.map((d) =>
          Animated.sequence([
            Animated.timing(d, { toValue: 1, duration: 300, useNativeDriver: true }),
            Animated.timing(d, { toValue: 0.3, duration: 300, useNativeDriver: true }),
          ]),
        ),
      ),
    );
    loop.start();
    return () => loop.stop();
  }, [dots]);
  return (
    <View className="mt-2 flex-row items-center justify-center gap-2" accessibilityLabel="Opening Stripe">
      <Text className="font-sans text-sm text-muted">Opening Stripe</Text>
      <View className="flex-row gap-1">
        {dots.map((d, i) => (
          <Animated.View
            key={i}
            style={{ opacity: d, width: 6, height: 6, borderRadius: 3, backgroundColor: "#5FA3F0" }}
          />
        ))}
      </View>
    </View>
  );
}
