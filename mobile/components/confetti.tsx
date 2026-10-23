import { useEffect, useState } from "react";
import { View, Animated, Easing } from "react-native";

// A moment of confetti around the ring on the celebration screens (plan
// live, first customer). Static when reduce motion is on.
const CONFETTI = [
  { x: 0.08, y: 0.1, r: 30, c: "#5FA3F0" },
  { x: 0.26, y: 0.05, r: -20, c: "#5FA3F0" },
  { x: 0.2, y: 0.4, r: 40, c: "#3DD68C" },
  { x: 0.1, y: 0.62, r: -35, c: "#5FA3F0" },
  { x: 0.24, y: 0.82, r: 20, c: "#5FA3F0" },
  { x: 0.72, y: 0.08, r: -30, c: "#5FA3F0" },
  { x: 0.88, y: 0.12, r: 25, c: "#3DD68C" },
  { x: 0.92, y: 0.52, r: -25, c: "#3DD68C" },
  { x: 0.78, y: 0.56, r: 35, c: "#5FA3F0" },
  { x: 0.88, y: 0.74, r: -15, c: "#5FA3F0" },
  { x: 0.74, y: 0.86, r: 45, c: "#3DD68C" },
];

export function Confetti({ width, height, reduceMotion }: { width: number; height: number; reduceMotion: boolean }) {
  const [fall] = useState(() => new Animated.Value(reduceMotion ? 1 : 0));
  useEffect(() => {
    if (reduceMotion) return;
    Animated.timing(fall, {
      toValue: 1,
      duration: 1100,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [fall, reduceMotion]);
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width, height }}>
      {CONFETTI.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: "absolute",
            left: p.x * width,
            top: p.y * height,
            width: 16,
            height: 10,
            borderRadius: 2,
            backgroundColor: p.c,
            opacity: fall.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 1] }),
            transform: [
              { translateY: fall.interpolate({ inputRange: [0, 1], outputRange: [-40, 0] }) },
              { rotate: `${p.r}deg` },
            ],
          }}
        />
      ))}
    </View>
  );
}
