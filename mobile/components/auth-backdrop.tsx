import { Image, StyleSheet, View, useWindowDimensions } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

// W0 + sign-in photo (Build Guide v2 Part 4 renders). The asset is composed
// from app/assets/brand/sign-up-bg.jpg by scripts/compose_welcome_bg.py with
// the navy grade baked in, so there's no gradient view to keep in sync. The
// render's 9:16 frame sits at the bottom of the asset, so anchoring it to
// the screen's bottom edge keeps the hand behind the headline on every
// phone height; taller phones reveal more kitchen above.
const BG = require("../assets/brand/welcome-bg.jpg");
const RATIO = 2556 / 1179;

// `fadeToNavy` (W0, 4 Oct notes 3.3): the photo fades into solid navy before
// the headline, so every line of copy sits on a clean background. Sign-in
// keeps the lighter scrim it passed review with.
// [offset, opacity] pairs for the navy scrim.
// 8 Oct (client): let the tablet (≈47–65% down) show through a little —
// 80% navy over it instead of solid, still dark enough for the copy.
const W0_STOPS: [string, string][] = [
  ["0.12", "0"],
  ["0.24", "0.8"],
  ["0.66", "0.8"],
  ["0.74", "1"],
  ["1", "1"],
];
const SIGN_IN_STOPS: [string, string][] = [
  ["0.38", "0"],
  ["0.62", "0.5"],
  ["1", "0.6"],
];

export function AuthBackdrop({ fadeToNavy = false }: { fadeToNavy?: boolean }) {
  const { width, height } = useWindowDimensions();
  const h = width * RATIO;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Image
        source={BG}
        style={{ position: "absolute", left: 0, width, height: h, top: height - h }}
      />
      {/* Scrim only behind the headline and copy (W0 changes, 30 Sept:
          "keep the darker gradient only behind the headline") — the upper
          half stays clear so the engineer, tablet and kitchen read. An SVG
          gradient, not expo-linear-gradient, which not every installed
          binary has (see Card in ui.tsx). */}
      <Svg style={StyleSheet.absoluteFill} width={width} height={height}>
        <Defs>
          <LinearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
            {(fadeToNavy ? W0_STOPS : SIGN_IN_STOPS).map(([offset, opacity]) => (
              <Stop key={offset} offset={offset} stopColor="#0B1A2E" stopOpacity={opacity} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={width} height={height} fill="url(#scrim)" />
      </Svg>
    </View>
  );
}
