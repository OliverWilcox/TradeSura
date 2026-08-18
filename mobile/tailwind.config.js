// Mirrors the design tokens in ../app/globals.css (Tailwind v4 @theme, web app).
// Kept as a separate v3-style config here because NativeWind v4 (stable) targets
// Tailwind v3 — see mobile/CLAUDE.md for why v5/Tailwind v4 wasn't used.
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        iron: "#232a33",
        "iron-2": "#2c3540",
        ink: "#1b222b",
        muted: "#5e6975",
        faint: "#8b95a1",
        paper: "#ffffff",
        bg: "#eef1f4",
        panel: "#f7f9fb",
        flame: "#0e7fd0",
        "flame-deep": "#0a62a3",
        "flame-tint": "#e3f0fb",
        copper: "#c2622e",
        "copper-deep": "#9c4c20",
        "copper-tint": "#f9ede4",
        ok: "#1e9e5a",
        "ok-tint": "#e4f5ec",
        warn: "#dd9a14",
        "warn-tint": "#fbf2dc",
        danger: "#d64545",
        "danger-tint": "#fbe9e9",
        line: "#d9dee4",
        "line-soft": "#e7ebef",
        night: "#0b0f14",
        "night-card": "#121a24",
        "brand-blue": "#1966cc",
        "brand-blue-lift": "#4d94f0",
        "brand-copper": "#c9803f",
        "night-text": "#f2f5f8",
        "night-muted": "#96a3b1",
      },
      fontFamily: {
        // RN can't do CSS font-weight synthesis on a single variable font, so
        // each weight the web design uses is its own loaded font family here.
        sans: ["Barlow_400Regular"],
        "sans-medium": ["Barlow_500Medium"],
        "sans-semibold": ["Barlow_600SemiBold"],
        "sans-bold": ["Barlow_700Bold"],
        disp: ["BarlowCondensed_600SemiBold"],
        "disp-bold": ["BarlowCondensed_700Bold"],
        mono: ["IBMPlexMono_400Regular"],
        "mono-medium": ["IBMPlexMono_500Medium"],
        "mono-semibold": ["IBMPlexMono_600SemiBold"],
      },
    },
  },
  plugins: [],
};
