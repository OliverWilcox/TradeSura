// Web counterpart of mobile/components/ring-mark.tsx — same measured path
// data (see scripts/ring_geometry.py), plain SVG instead of react-native-svg
// since this runs in the DOM. Kept in sync by hand; both are small and
// change only if the mark itself is redesigned again.
const GREEN_D =
  "M 43.69 24.32 A 50.00 50.00 0 0 0 -2.01 -49.96 L 6.94 -39.79 L -1.76 -30.57 A 30.63 30.63 0 0 1 27.09 14.28 L 30.67 26.76 Z";
const BLUE_D =
  "M -4.79 -49.77 A 50.00 50.00 0 1 0 42.17 26.86 L 29.11 29.32 L 25.57 16.86 A 30.63 30.63 0 1 1 -5.05 -30.20 L 3.96 -39.72 Z";

export function RingMark({ size = 22, color }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="-50 -50 100 100" aria-hidden="true">
      <path d={BLUE_D} fill={color ?? "#5FA3F0"} />
      <path d={GREEN_D} fill={color ?? "#3DD68C"} />
    </svg>
  );
}
