// Mirrors the design tokens in ../app/globals.css (Tailwind v4 @theme, web app).
// Kept as a separate v3-style config here because NativeWind v4 (stable) targets
// Tailwind v3 — see mobile/CLAUDE.md for why v5/Tailwind v4 wasn't used.
//
// Design system: TradeSura Build Spec v1 §1 — TS Blue #1966CC, money-green
// #0E9F5B (pounds only), system font, light chrome. Semantic keys are kept so
// screens don't churn: `flame`=primary blue, `copper`/`ok`=money green,
// `iron`=light surface (was dark), `warn`=amber, `panel`=wash.
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // surfaces
        iron: "#ffffff", // was dark chrome — now a light header surface
        "iron-2": "#f5f8fb",
        ink: "#14202e",
        muted: "#5b6b7c",
        faint: "#8b95a1",
        paper: "#ffffff",
        bg: "#e9eef4",
        panel: "#f5f8fb",
        // primary — TS Blue
        flame: "#1966cc",
        "flame-deep": "#0f4c9e",
        "flame-tint": "#eaf2fc",
        // money — green, pounds only
        copper: "#0e9f5b",
        "copper-deep": "#0a7a46",
        "copper-tint": "#e7f7ef",
        ok: "#0e9f5b",
        "ok-tint": "#e7f7ef",
        // attention / failure
        warn: "#b7791f",
        "warn-tint": "#fcf3e3",
        danger: "#c0392b",
        "danger-tint": "#fbeae7",
        line: "#e1e8f0",
        "line-soft": "#ebeff3",
        // auth surface — now light like the rest
        night: "#f5f8fb",
        "night-card": "#ffffff",
        "brand-blue": "#1966cc",
        "brand-blue-lift": "#4c8bde",
        "brand-copper": "#0e9f5b",
        "night-text": "#14202e",
        "night-muted": "#5b6b7c",
      },
      fontFamily: {
        // System font (Build Spec §1: "No custom webfonts"). Weight comes from
        // the font-{normal,medium,semibold,bold} utilities; these family keys
        // all resolve to the platform UI font. Money/IDs keep a monospace
        // fallback so figures stay column-aligned.
        sans: ["System"],
        "sans-medium": ["System"],
        "sans-semibold": ["System"],
        "sans-bold": ["System"],
        disp: ["System"],
        "disp-bold": ["System"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        "mono-medium": ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        "mono-semibold": ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
