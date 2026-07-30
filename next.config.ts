import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the dev overlay badge out of handover screenshots and demo recordings.
  devIndicators: false,
};

export default nextConfig;
