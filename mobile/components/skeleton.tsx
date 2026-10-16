import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { View, type ImageStyle, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { RingMark } from "@/components/ring-mark";

// Loading states, two shapes and nothing else:
//  - Skeleton + Bone: grey blocks laid out exactly like the content they
//    stand in for, so nothing jumps when the data lands. One Skeleton per
//    container owns the pulse (every bone breathes in sync) and the single
//    "Loading" label screen readers hear — the bones themselves are hidden.
//  - RingSpinner: the brand ring spinning and breathing in scale — the same
//    double turn as the launch overlay (ring-loader.tsx), for images and
//    content whose shape isn't known up front.
// Built on Reanimated directly rather than Moti (whose Skeleton targets
// Reanimated 3). No gradient shimmer: expo-linear-gradient isn't in every
// installed binary yet (see Card in ui.tsx). Reduce Motion gets static
// bones and a still ring.

const BONE = "#213c60"; // paper-3 — reads on paper, paper-2 and the hero card

const PulseContext = createContext<SharedValue<number> | null>(null);

export function Skeleton({
  children,
  label = "Loading",
  className = "",
  style,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const pulse = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) return;
    pulse.value = withRepeat(
      withTiming(1, { duration: 850, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    return () => cancelAnimation(pulse);
  }, [reduceMotion, pulse]);

  return (
    <PulseContext.Provider value={pulse}>
      <View
        className={className}
        style={style}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label}
      >
        <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {children}
        </View>
      </View>
    </PulseContext.Provider>
  );
}

/** One grey block. `width` accepts a number or a percentage string. */
export function Bone({
  width = "100%",
  height = 12,
  radius = 6,
  style,
}: {
  width?: ViewStyle["width"];
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const pulse = useContext(PulseContext);
  const animated = useAnimatedStyle(() => ({
    opacity: pulse ? interpolate(pulse.value, [0, 1], [0.55, 1]) : 0.8,
  }));
  return (
    <Animated.View
      style={[{ width, height, borderRadius: radius, backgroundColor: BONE }, animated, style]}
    />
  );
}

/** A line of text: the bone is as tall as the glyphs, padded to the line height. */
export function TextBone({
  width = "100%",
  size = 14,
  lineHeight,
  style,
}: {
  width?: ViewStyle["width"];
  size?: number;
  lineHeight?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const lh = lineHeight ?? Math.round(size * 1.35);
  return (
    <View style={[{ height: lh, justifyContent: "center" }, style]}>
      <Bone width={width} height={Math.round(size * 0.8)} radius={4} />
    </View>
  );
}

export function RingSpinner({
  size = 40,
  label = "Loading",
  accessible = true,
}: {
  size?: number;
  label?: string;
  /** false when a surrounding Skeleton/container already announces loading. */
  accessible?: boolean;
}) {
  const turn = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) return;
    // 0→1 is a full double turn, so the jump back to 0 lands on the same
    // angle and the loop is seamless.
    turn.value = withRepeat(
      withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.cubic) }),
      -1,
      false,
    );
    return () => cancelAnimation(turn);
  }, [reduceMotion, turn]);

  const animated = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${turn.value * 720}deg` },
      // Breathes in as it picks up speed, back out as it settles.
      { scale: interpolate(turn.value, [0, 0.5, 1], [1, 0.82, 1]) },
    ],
  }));

  return (
    <View
      accessible={accessible}
      accessibilityRole={accessible ? "progressbar" : undefined}
      accessibilityLabel={accessible ? label : undefined}
      importantForAccessibility={accessible ? "yes" : "no-hide-descendants"}
    >
      <Animated.View style={[{ width: size, height: size }, animated]}>
        <RingMark size={size} />
      </Animated.View>
    </View>
  );
}

/** Centred ring for a region (or whole screen) whose layout isn't known yet. */
export function CenteredSpinner({ size = 44, label }: { size?: number; label?: string }) {
  return (
    <View className="flex-1 items-center justify-center py-10">
      <RingSpinner size={size} label={label} />
    </View>
  );
}

/**
 * A remote image that holds its box with a bone-coloured panel and the ring
 * spinner until the pixels arrive, then fades them in. Needs a fixed size.
 */
export function LoadingImage(props: LoadingImageProps) {
  // Keyed by source, so a new image starts again from the placeholder.
  return <LoadingImageInner key={props.uri} {...props} />;
}

type LoadingImageProps = {
  uri: string;
  width: number;
  height: number;
  radius?: number;
  spinnerSize?: number;
  style?: StyleProp<ImageStyle>;
  resizeMode?: "cover" | "contain";
  blurRadius?: number;
  accessibilityLabel?: string;
};

function LoadingImageInner({
  uri,
  width,
  height,
  radius = 0,
  spinnerSize,
  style,
  resizeMode,
  blurRadius,
  accessibilityLabel,
}: LoadingImageProps) {
  const [loaded, setLoaded] = useState(false);
  const fade = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  const imageStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  const ring = spinnerSize ?? Math.max(16, Math.min(44, Math.round(Math.min(width, height) * 0.3)));

  return (
    <View
      style={{ width, height, borderRadius: radius, overflow: "hidden" }}
      accessibilityLabel={accessibilityLabel}
    >
      {!loaded && (
        <View
          style={{ position: "absolute", inset: 0, backgroundColor: BONE }}
          className="items-center justify-center"
        >
          <RingSpinner size={ring} accessible={false} />
        </View>
      )}
      <Animated.Image
        source={{ uri }}
        style={[{ width, height }, style, imageStyle]}
        resizeMode={resizeMode}
        blurRadius={blurRadius}
        onLoad={() => {
          // .set() rather than .value = — the React Compiler lint treats a
          // shared value from a hook as immutable inside render callbacks.
          fade.set(reduceMotion ? 1 : withTiming(1, { duration: 220 }));
          setLoaded(true);
        }}
        onError={() => setLoaded(true)}
      />
    </View>
  );
}


/** RowLine (ui.tsx) in bone form: a label on the left, a value on the right. */
export function RowBone({
  left = 140,
  right = 60,
  last = false,
}: {
  left?: ViewStyle["width"];
  right?: ViewStyle["width"] | null;
  last?: boolean;
}) {
  return (
    <View
      className={`flex-row items-center justify-between gap-2 py-2.5 ${last ? "" : "border-b border-line-soft"}`}
    >
      <TextBone width={left} size={14} />
      {right !== null && <TextBone width={right} size={14} />}
    </View>
  );
}

/** A list row in bone form: bold name over a small status line, pill on the right. */
export function ListRowBone({
  title = 130,
  subtitle = 170,
  pill = 72,
  last = false,
}: {
  title?: ViewStyle["width"];
  subtitle?: ViewStyle["width"];
  pill?: number | null;
  last?: boolean;
}) {
  return (
    <View
      className={`flex-row items-center justify-between gap-2 py-2.5 ${last ? "" : "border-b border-line-soft"}`}
    >
      <View className="flex-1">
        <TextBone width={title} size={14} />
        <TextBone width={subtitle} size={11} />
      </View>
      {pill !== null && <Bone width={pill} height={22} radius={11} />}
    </View>
  );
}
