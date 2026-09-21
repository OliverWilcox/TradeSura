import { ScrollViewStyleReset } from "expo-router/html";

// Build Guide v2 Part 2.2 — "App icon, favicon, avatar mark" are all the
// same ring asset. Expo Router's default web HTML shell (used when no
// +html.tsx exists) has no <link rel="icon"> at all — app.json's
// web.favicon is only read by a static `expo export -p web`, never by the
// Metro dev server that `expo start --web` runs — so the browser tab
// showed no custom icon regardless of what assets/favicon.png contained.
// This file is Expo Router's documented way to own that HTML shell; the
// favicon it points at (public/favicon.png, Metro's static-file folder,
// served as-is at the site root) is a plain downscale of assets/icon.png —
// same ring, same navy square, not a separately drawn approximation.
export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <link rel="icon" href="/favicon.png" />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
