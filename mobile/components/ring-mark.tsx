import { useEffect, useState } from "react";
import { Animated, Easing } from "react-native";
import Svg, { ClipPath, Defs, G, Path } from "react-native-svg";

// The TradeSura ring mark, as real vector geometry rather than a raster
// image. 22 Sept rebrand: the sharp-cut ring replaced the old soft
// rounded-pill ring (on direct instruction), first shipped as a
// background-removed JPEG export — which looked visibly pixellated/jagged
// at real display sizes (hard-threshold alpha keying has no antialiasing,
// so every edge was a hard staircase, worse the more the image was scaled).
// This replaces that raster pipeline entirely: the two path `d` strings
// below are the exact shape, measured from the original design via OpenCV
// contour extraction + least-squares circle fitting on the source JPG
// (scripts/ring_geometry.py has the full derivation and can regenerate
// these), then re-expressed as true SVG elliptical-arc commands — exact
// circles at any zoom, not a tessellated polygon. Renders crisply from a
// favicon up to a full-bleed app icon with zero source-image artifacts.
const GREEN_D =
  "M 43.69 24.32 A 50.00 50.00 0 0 0 -2.01 -49.96 L 6.94 -39.79 L -1.76 -30.57 A 30.63 30.63 0 0 1 27.09 14.28 L 30.67 26.76 Z";
const BLUE_D =
  "M -4.79 -49.77 A 50.00 50.00 0 1 0 42.17 26.86 L 29.11 29.32 L 25.57 16.86 A 30.63 30.63 0 1 1 -5.05 -30.20 L 3.96 -39.72 Z";

export const BRAND_BLUE = "#5FA3F0";
export const BRAND_GREEN = "#3DD68C";

/**
 * The ring mark on its own — masthead icon, avatar fallback, app-icon
 * source. `color` overrides both arcs to a single flat colour (for the
 * white/monochrome variants); omit it for the real two-tone brand mark.
 */
export function RingMark({ size = 32, color }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="-50 -50 100 100">
      <Path d={BLUE_D} fill={color ?? BRAND_BLUE} />
      <Path d={GREEN_D} fill={color ?? BRAND_GREEN} />
    </Svg>
  );
}

/**
 * The ring mark as a progress indicator — the Getting started hub's
 * "n of 7". The real logo shape (arrow cuts and all), dimmed as the track,
 * with the two-tone mark revealed clockwise from 12 o'clock as steps are
 * done. Same geometry as RingMark, so it reads as the logo, not a circle.
 */
export function RingMarkProgress({ size = 96, progress }: { size?: number; progress: number }) {
  const target = Math.max(0, Math.min(1, progress));
  const [shown, setShown] = useState(0);
  const [anim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const id = anim.addListener(({ value }) => setShown(value));
    Animated.timing(anim, {
      toValue: target,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    return () => anim.removeListener(id);
  }, [target, anim]);

  return (
    <Svg width={size} height={size} viewBox="-50 -50 100 100">
      <Defs>
        <ClipPath id="ringmark-progress">
          <Path d={wedge(shown)} />
        </ClipPath>
      </Defs>
      <Path d={BLUE_D} fill="#ffffff" fillOpacity={0.14} />
      <Path d={GREEN_D} fill="#ffffff" fillOpacity={0.14} />
      {shown > 0 && (
        <G clipPath="url(#ringmark-progress)">
          <Path d={BLUE_D} fill={BRAND_BLUE} />
          <Path d={GREEN_D} fill={BRAND_GREEN} />
        </G>
      )}
    </Svg>
  );
}

// A pie slice, clockwise, big enough to cover the ring. It starts just past
// the blue arrow head at 12 o'clock, so the fill doesn't open with a stray
// blue sliver; the arrow head fills in last, when the ring completes.
const START_DEG = 7;
function wedge(p: number): string {
  if (p >= 0.999) return "M -60 -60 H 60 V 60 H -60 Z";
  const r = 60;
  const at = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return `${(r * Math.sin(a)).toFixed(2)} ${(-r * Math.cos(a)).toFixed(2)}`;
  };
  const sweep = p * 360;
  return `M 0 0 L ${at(START_DEG)} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${at(START_DEG + sweep)} Z`;
}
