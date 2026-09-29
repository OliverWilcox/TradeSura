import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet } from "react-native";
import { RingMark } from "@/components/ring-mark";

const SIZE = 88; // matches the native splash's imageWidth (app.json) for a seamless hand-off

// The entering-the-app moment. The native splash shows this same ring, still;
// this overlay takes over in the same spot and spins it (the Building-your-
// account double turn, looped) until `ready`. Then it "closes": the ring
// spins out its last turn while shrinking to nothing, and the navy lifts
// away to reveal the screen underneath. Unmounts itself when done. Reduce
// Motion: no spin, just a short fade.
export function LaunchOverlay({ ready }: { ready: boolean }) {
  const [spin] = useState(() => new Animated.Value(0));
  const [close] = useState(() => new Animated.Value(0));
  const [done, setDone] = useState(false);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const loop = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  useEffect(() => {
    if (reduceMotion !== false) return;
    loop.current = Animated.loop(
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
    loop.current.start();
    return () => loop.current?.stop();
  }, [reduceMotion, spin]);

  useEffect(() => {
    if (!ready || reduceMotion === null) return;
    loop.current?.stop();
    Animated.timing(close, {
      toValue: 1,
      duration: reduceMotion ? 220 : 560,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start(() => setDone(true));
  }, [ready, reduceMotion, close]);

  if (done) return null;

  // The closing turn continues from wherever the loop stopped.
  const rotate = Animated.add(spin, close.interpolate({ inputRange: [0, 1], outputRange: [0, 0.5] })).interpolate({
    inputRange: [0, 2],
    outputRange: ["0deg", "1440deg"],
  });
  const ringScale = close.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 0.15, 0] });
  const ringOpacity = close.interpolate({ inputRange: [0, 0.7, 0.9], outputRange: [1, 1, 0] });
  const backdrop = close.interpolate({ inputRange: [0, 0.45, 1], outputRange: [1, 1, 0] });

  return (
    <Animated.View
      pointerEvents={ready ? "none" : "auto"}
      style={[StyleSheet.absoluteFill, styles.center, { opacity: backdrop }]}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading TradeSura"
    >
      <Animated.View
        style={{ opacity: ringOpacity, transform: [{ rotate }, { scale: ringScale }] }}
      >
        <RingMark size={SIZE} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center", backgroundColor: "#0B1A2E" },
});
