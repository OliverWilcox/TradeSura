import { Image, StyleSheet, View, useWindowDimensions } from "react-native";

// W0 + sign-in photo (Build Guide v2 Part 4 renders). The asset is composed
// from app/assets/brand/sign-up-bg.jpg by scripts/compose_welcome_bg.py with
// the navy grade baked in, so there's no gradient view to keep in sync. The
// render's 9:16 frame sits at the bottom of the asset, so anchoring it to
// the screen's bottom edge keeps the hand behind the headline on every
// phone height; taller phones reveal more kitchen above.
const BG = require("../assets/brand/welcome-bg.jpg");
const RATIO = 2556 / 1179;

export function AuthBackdrop() {
  const { width, height } = useWindowDimensions();
  const h = width * RATIO;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Image
        source={BG}
        style={{ position: "absolute", left: 0, width, height: h, top: height - h }}
      />
      {/* Extra navy scrim so the headline and copy read cleanly over the
          photo. Tune the alpha here rather than regenerating the asset. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(11,26,46,0.35)" }]} />
    </View>
  );
}
