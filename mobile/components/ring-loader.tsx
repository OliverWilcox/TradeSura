import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, Easing, View } from "react-native";
import { RingMark } from "@/components/ring-mark";

// The app's loading state: the ring doing the same eased double-turn as the
// post-signup "Building your account" moment, looped. Reduce Motion gets a
// still ring instead of a spinner.
export function RingLoader({ size = 88 }: { size?: number }) {
  const [spin] = useState(() => new Animated.Value(0));

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(spin, {
            toValue: 1,
            duration: 1300,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.delay(150),
          Animated.timing(spin, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      );
      loop.start();
    });
    return () => loop?.stop();
  }, [spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "720deg"] });
  return (
    <View
      className="flex-1 items-center justify-center bg-night"
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
    >
      <Animated.View style={{ transform: [{ rotate }] }}>
        <RingMark size={size} />
      </Animated.View>
    </View>
  );
}
