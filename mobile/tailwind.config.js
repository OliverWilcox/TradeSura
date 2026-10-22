// Mirrors the design tokens in ../app/globals.css (Tailwind v4 @theme, web app).
// Kept as a separate v3-style config here because NativeWind v4 (stable) targets
// Tailwind v3 — see mobile/CLAUDE.md for why v5/Tailwind v4 wasn't used.
//
// Brand kit: TradeSura Build Guide v2 Part 2 (tokens unchanged from the
// Screen Designs v2 dark system; the guide adds the usage LAWs — green is
// money only, blue = info/links/active tab, amber = pending, red = broken).
// Design system: TradeSura Screen Designs v2 · Full Dark (supersedes Build
// Spec v1 §1's light system — see CLAUDE.md's [DECISION] for the switch).
// Navy depth, brand blue #5FA3F0, money-green #3DD68C (pounds only), system
// font. Semantic keys are kept so screens don't churn: `flame`=brand blue,
// `copper`/`ok`=money green, `iron`=dark chrome, `warn`=amber, `panel`=surface-2.
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  // NativeWind 4.2 web: with the default "media" dark mode, react-native-css-
  // interop's own MutationObserver calls colorScheme.set() on boot and
  // throws ("Cannot manually set color scheme, as dark mode is type 'media'"),
  // freezing the web preview. "class" is inert here — there is no light
  // variant (one-way navy palette) — and unblocks `expo start --web`.
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // surfaces
        iron: "#081321", // bg-deep — nav/header chrome
        "iron-2": "#122540", // surface — secondary chrome
        ink: "#f3f7fb",
        muted: "#9fb6d0",
        faint: "#6e86a3",
        paper: "#122540", // surface — cards, headers
        "paper-2": "#193150", // surface-2 — inputs, tiles, raised cards
        "paper-3": "#213c60", // surface-3
        bg: "#0b1a2e",
        "bg-deep": "#081321",
        panel: "#193150",
        // brand — light blue
        flame: "#5fa3f0",
        "flame-deep": "#1966cc",
        "flame-tint": "rgba(95,163,240,0.16)",
        // money — green, pounds only
        copper: "#3dd68c",
        "copper-deep": "#2fb877",
        "copper-tint": "rgba(61,214,140,0.14)",
        ok: "#3dd68c",
        "ok-tint": "rgba(61,214,140,0.14)",
        // attention / failure
        warn: "#f5b544",
        "warn-tint": "rgba(242,184,75,0.14)",
        danger: "#ff6b6b",
        "danger-tint": "rgba(255,107,107,0.14)",
        line: "rgba(255,255,255,0.10)",
        "line-soft": "rgba(255,255,255,0.06)",
        "line-strong": "rgba(255,255,255,0.18)",
        // hero card gradient stops (money cards, celebration moments)
        "hero-from": "#1a3a66",
        "hero-via": "#122540",
        "hero-to": "#0f2140",
        // auth surface — matches the app background
        night: "#0b1a2e",
        "night-card": "#122540",
        "brand-blue": "#5fa3f0",
        "brand-blue-lift": "#8cc0f7",
        "brand-copper": "#3dd68c",
        "night-text": "#f3f7fb",
        "night-muted": "#9fb6d0",
        // Dark navy text for the white primary button / white FAB — the
        // inverse of `ink`/`night-text` (light text for dark surfaces).
        // Bug fix: those were wrongly reused for this and rendered as
        // white-on-white.
        "on-light": "#0f2140",
      },
      fontFamily: {
        // System font (Build Spec §1: "No custom webfonts"). Weight comes from
        // the font-{normal,medium,semibold,bold} utilities; these family keys
        // all resolve to the platform UI font. Build Review 3 §3: no monospace
        // anywhere — the `mono*` keys are kept only so stray `font-mono`
        // classes still resolve, and they map to the app font too. Use
        // `tabular-nums` where figures need to line up.
        sans: ["System"],
        "sans-medium": ["System"],
        "sans-semibold": ["System"],
        "sans-bold": ["System"],
        disp: ["System"],
        "disp-bold": ["System"],
        mono: ["System"],
        "mono-medium": ["System"],
        "mono-semibold": ["System"],
      },
    },
  },
  plugins: [],
};
