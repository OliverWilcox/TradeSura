import Svg, { Path } from "react-native-svg";

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
