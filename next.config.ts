import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the dev overlay badge out of handover screenshots and demo recordings.
  devIndicators: false,
  // Quick tunnels (cloudflared) get a new random *.trycloudflare.com subdomain
  // each run; without this the dev server blocks hydration for that origin.
  allowedDevOrigins: ["*.trycloudflare.com"],
  // mobile/ has its own package-lock.json (separate Expo app, no workspaces);
  // without this Turbopack guesses at the workspace root from the two lockfiles.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
