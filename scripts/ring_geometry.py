"""
Precise geometric definition of the TradeSura sharp-cut ring mark, measured
from the source design (app/assets/brand/logo-transparent.JPG) via OpenCV
contour extraction + least-squares circle fitting (22 Sept rebrand).

This replaces the raster (JPG -> background-removed PNG) pipeline, which
produced visible pixellation/aliasing at real display sizes (hard-threshold
alpha keying has no antialiasing). A true vector definition renders cleanly
at any size — small favicon or large app icon alike — with no source-image
artifacts at all.

Coordinate system: unit circle, center (0,0), outer radius 1.0. Angles in
degrees, standard math convention (0=east/3-o'clock, 90=north/12-o'clock,
increasing = counterclockwise, matching how the shape actually reads on
screen once paired with the SVG/PIL y-flip each renderer below applies.
"""
import math

OUTER_R = 1.0
INNER_R = 490.0 / 800.0  # 0.6125, measured ratio

BRAND_BLUE = (95, 163, 240)   # #5FA3F0
BRAND_GREEN = (61, 214, 140)  # #3DD68C

# Each cut is the 3-vertex zigzag where two arcs meet: inner-circle point ->
# notch tip -> outer-circle point. Measured independently from the blue and
# green side of each cut (there's a small real gap between them in the
# source design) rather than averaged, to preserve that gap faithfully.
CUT_A_BLUE = dict(inner=(99.5, 500.2 / 800), tip=(84.3, 638.7 / 800), outer=(95.5, 784.2 / 800))
CUT_A_GREEN = dict(inner=(93.3, 499.6 / 800), tip=(80.1, 646.2 / 800), outer=(92.3, 784.2 / 800))
CUT_B_GREEN = dict(inner=(332.2, 500.3 / 800), tip=(318.9, 651.3 / 800), outer=(330.9, 784.5 / 800))
CUT_B_BLUE = dict(inner=(326.6, 500.2 / 800), tip=(314.8, 661.1 / 800), outer=(327.5, 784.3 / 800))

# Green runs from CUT_B (~331 deg) counterclockwise through 0 deg to CUT_A
# (~93 deg). Blue runs from CUT_A (~96 deg) counterclockwise through 180 deg
# to CUT_B (~327 deg).
GREEN_START, GREEN_END = CUT_B_GREEN, CUT_A_GREEN
BLUE_START, BLUE_END = CUT_A_BLUE, CUT_B_BLUE


def _pt(angle_deg, radius):
    a = math.radians(angle_deg)
    return (radius * math.cos(a), radius * math.sin(a))


def _arc_points(a0, a1, radius, n=90):
    """Points from angle a0 to a1 (deg), increasing/CCW, at constant radius."""
    if a1 < a0:
        a1 += 360
    return [_pt(a0 + (a1 - a0) * i / n, radius) for i in range(n + 1)]


def segment_polygon(start_cut, end_cut, n_arc=90):
    """One coloured ring segment as a closed polygon: outer arc from
    start_cut.outer to end_cut.outer, in through end_cut's tip/inner vertex,
    inner arc back to start_cut.inner, out through start_cut's tip."""
    poly = []
    poly += _arc_points(start_cut["outer"][0], end_cut["outer"][0], OUTER_R, n_arc)
    poly.append(_pt(*end_cut["tip"]))
    poly.append(_pt(*end_cut["inner"]))
    poly += list(reversed(_arc_points(start_cut["inner"][0], end_cut["inner"][0], INNER_R, n_arc)))
    poly.append(_pt(*start_cut["tip"]))
    return poly


def green_polygon(n_arc=90):
    return segment_polygon(GREEN_START, GREEN_END, n_arc)


def blue_polygon(n_arc=90):
    return segment_polygon(BLUE_START, BLUE_END, n_arc)


def _svg_arc_flag_sweep(a0, a1):
    """SVG 'A' sweep-flag for a CCW arc in a y-down SVG coordinate space
    (where our CCW-in-math-space arc reads as clockwise on screen)."""
    return 1  # sweep=1 with the y-flip applied at path-build time below


def segment_svg_path(start_cut, end_cut, scale=1.0):
    """SVG path 'd' string for one coloured segment, using real elliptical-arc
    commands (exact circles at any zoom) rather than a tessellated polyline.
    Coordinates are in SVG space (y grows downward), so this negates y.
    """
    def sp(angle_deg, radius):
        x, y = _pt(angle_deg, radius * scale)
        return x, -y

    ox0, oy0 = sp(start_cut["outer"][0], OUTER_R)
    ox1, oy1 = sp(end_cut["outer"][0], OUTER_R)
    tx, ty = sp(end_cut["tip"][0], end_cut["tip"][1])
    ix1, iy1 = sp(end_cut["inner"][0], INNER_R)
    ix0, iy0 = sp(start_cut["inner"][0], INNER_R)
    stx, sty = sp(start_cut["tip"][0], start_cut["tip"][1])
    R_out = OUTER_R * scale
    R_in = INNER_R * scale

    # Outer arc start->end: does it cross the 0/360 wrap going CCW in math
    # space? If the end angle (normalised forward from start) exceeds 180,
    # it's the "large arc".
    def large_arc(a0, a1):
        a1n = a1 if a1 >= a0 else a1 + 360
        return 1 if (a1n - a0) > 180 else 0

    large_outer = large_arc(start_cut["outer"][0], end_cut["outer"][0])
    large_inner = large_arc(start_cut["inner"][0], end_cut["inner"][0])

    d = (
        f"M {ox0:.2f} {oy0:.2f} "
        f"A {R_out:.2f} {R_out:.2f} 0 {large_outer} 0 {ox1:.2f} {oy1:.2f} "
        f"L {tx:.2f} {ty:.2f} "
        f"L {ix1:.2f} {iy1:.2f} "
        f"A {R_in:.2f} {R_in:.2f} 0 {large_inner} 1 {ix0:.2f} {iy0:.2f} "
        f"L {stx:.2f} {sty:.2f} Z"
    )
    return d


def green_svg_path(scale=1.0):
    return segment_svg_path(GREEN_START, GREEN_END, scale)


def blue_svg_path(scale=1.0):
    return segment_svg_path(BLUE_START, BLUE_END, scale)
