import { useRef, useState } from "react";
import { View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import * as Haptics from "expo-haptics";

const THUMB = 28;

// A plain-RN slider (the View responder system, no native module), so it
// works in any already-built dev client — a community slider package would
// need a rebuild.
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  accessibilityLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  accessibilityLabel?: string;
}) {
  const [width, setWidth] = useState(0);
  // Where the drag started: the touch's x inside the track, and on screen.
  const origin = useRef({ x: 0, pageX: 0 });

  const frac = max > min ? (value - min) / (max - min) : 0;
  const thumbLeft = frac * Math.max(0, width - THUMB);

  function set(x: number) {
    const usable = Math.max(1, width - THUMB);
    const f = Math.min(1, Math.max(0, (x - THUMB / 2) / usable));
    const v = Math.round((min + f * (max - min)) / step) * step;
    if (v === value) return;
    Haptics.selectionAsync().catch(() => {});
    onChange(v);
  }

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      // Keep the drag when the finger drifts vertically inside a ScrollView.
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e: GestureResponderEvent) => {
        origin.current = { x: e.nativeEvent.locationX, pageX: e.nativeEvent.pageX };
        set(e.nativeEvent.locationX);
      }}
      onResponderMove={(e: GestureResponderEvent) =>
        set(origin.current.x + e.nativeEvent.pageX - origin.current.pageX)
      }
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "increment") onChange(Math.min(max, value + step));
        if (e.nativeEvent.actionName === "decrement") onChange(Math.max(min, value - step));
      }}
      style={{ height: 40, justifyContent: "center" }}
    >
      {/* pointerEvents none so locationX is always measured on the outer view. */}
      <View
        pointerEvents="none"
        className="h-1.5 rounded-full bg-line-strong"
        style={{ marginHorizontal: THUMB / 2 }}
      >
        <View className="h-full rounded-full bg-flame" style={{ width: `${frac * 100}%` }} />
      </View>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: thumbLeft,
          width: THUMB,
          height: THUMB,
          borderRadius: THUMB / 2,
          backgroundColor: "#ffffff",
          shadowColor: "#000",
          shadowOpacity: 0.3,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 2 },
        }}
      />
    </View>
  );
}
