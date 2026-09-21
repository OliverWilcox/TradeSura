import { useEffect, useState } from "react";
import { View, Animated, Easing } from "react-native";
import Svg, { Circle } from "react-native-svg";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Build Guide v2 Part 6.3/12 — "the ring fills through the payout week,
// closing green on Friday." This is a deliberate, explicit exception to
// Part 2.2's LAW ("always place the supplied PNG/SVG — never redraw it as
// a plain circle") — done on direct instruction rather than assumed, so
// it's visible here rather than silently overriding the spec. Everywhere
// else the ring appears (masthead lockup, avatar mark, app icon) stays the
// real asset, untouched; this is the one place — the payout indicator —
// where the guide's own text asks for something the static PNG can't do.
//
// Blue base ring + a green stroke that draws in clockwise from 12 o'clock,
// animated on mount/whenever `progress` changes (a real SVG path-drawing
// animation via strokeDasharray/strokeDashoffset on react-native-svg's
// Circle, not a static reveal).
// The week's fill, 0 (Monday, nothing locked in) → 1 (Friday, fully
// closed) — holds at 1 over the weekend until Monday resets it.
export function payoutWeekProgress(): number {
  const dayIdx = (new Date().getDay() + 6) % 7; // Monday = 0 … Sunday = 6
  return Math.min(1, (Math.min(dayIdx, 4) + 1) / 5);
}

export function RingProgress({
  size = 44,
  strokeWidth = 5,
  progress,
  dormant = false,
}: {
  size?: number;
  strokeWidth?: number;
  /** 0 (Monday, nothing locked in) to 1 (Friday, fully closed). */
  progress: number;
  dormant?: boolean;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, progress));
  // A lazy useState initialiser rather than useRef(...).current — this
  // project's lint rules flag reading a ref's .current during render, even
  // for Animated.Value's usual pattern; a stable value out of state sidesteps
  // that without changing the behaviour (Animated.Value is safe to hold in
  // state and mutate directly, same as the ref pattern would).
  const [anim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(anim, {
      toValue: dormant ? 0 : clamped,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      // strokeDashoffset isn't a native-driver-supported prop — this
      // animates on the JS thread, which is fine for a once-per-screen draw.
      useNativeDriver: false,
    }).start();
  }, [clamped, dormant, anim]);

  const strokeDashoffset = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  });

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#5FA3F0"
          strokeWidth={strokeWidth}
          strokeOpacity={dormant ? 0.35 : 1}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#3DD68C"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${circumference}, ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          fill="none"
          opacity={dormant ? 0 : 1}
          // Circles draw from 3 o'clock by default — rotate so the fill
          // starts at 12 o'clock and sweeps clockwise, matching the brand
          // ring's own green segment position.
          rotation={-90}
          originX={size / 2}
          originY={size / 2}
        />
      </Svg>
    </View>
  );
}
