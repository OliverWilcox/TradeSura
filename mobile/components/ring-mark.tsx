import { useEffect, useState } from "react";
import { Animated, Easing } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

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
 * The Getting started hub's "n of 7": a plain blue ring with the logo's
 * green arrow growing clockwise from 12 o'clock as steps are done (tail
 * notch and arrow head cut like the logo's own green arc). At 7 of 7 the
 * head meets its tail and the ring is all green.
 */
export function RingMarkProgress({ size = 80, progress }: { size?: number; progress: number }) {
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
      {/* All done: a plain green ring (no blue edge peeking out). */}
      <Circle
        cx={0}
        cy={0}
        r={MID_R}
        stroke={shown >= 0.999 ? BRAND_GREEN : BRAND_BLUE}
        strokeWidth={OUTER_R - INNER_R}
        fill="none"
      />
      {shown > 0.005 && shown < 0.999 && <Path d={greenArrow(shown)} fill={BRAND_GREEN} />}
    </Svg>
  );
}

// The logo's ring proportions (outer 50, inner 30.63) and its arrow cut:
// the head's point and the tail's notch sit 12° on, at mid-radius.
const OUTER_R = 50;
const INNER_R = 30.63;
const MID_R = (OUTER_R + INNER_R) / 2;
const ARROW_DEG = 12;
const START_DEG = -2;
const MIN_SPAN = ARROW_DEG + 4;

function pt(r: number, deg: number): string {
  const a = (deg * Math.PI) / 180;
  return `${(r * Math.sin(a)).toFixed(2)} ${(-r * Math.cos(a)).toFixed(2)}`;
}

function greenArrow(p: number): string {
  // Span of the body (tail edge → head base); at 1 the head's point lands
  // in the tail's notch and the ring closes.
  const span = MIN_SPAN + p * (360 - MIN_SPAN);
  const a0 = START_DEG;
  const a1 = START_DEG + Math.min(span, 359.9);
  const large = a1 - a0 > 180 ? 1 : 0;
  return [
    `M ${pt(OUTER_R, a0)}`,
    `A ${OUTER_R} ${OUTER_R} 0 ${large} 1 ${pt(OUTER_R, a1)}`,
    `L ${pt(MID_R, a1 + ARROW_DEG)}`,
    `L ${pt(INNER_R, a1)}`,
    `A ${INNER_R} ${INNER_R} 0 ${large} 0 ${pt(INNER_R, a0)}`,
    `L ${pt(MID_R, a0 + ARROW_DEG)}`,
    "Z",
  ].join(" ");
}
