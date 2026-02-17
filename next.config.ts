import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output: creates a self-contained server folder
  // Build on PC, copy .next/standalone to Termux — no build needed on phone
  output: 'standalone',
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        poll: 1500,
        aggregateTimeout: 500,
        ignored: ['**/movies/**', '**/node_modules/**', '**/.git/**', '**/.next/**']
      }
    }
    return config
  },
  poweredByHeader: false,
  generateEtags: false,
};

export default nextConfig;
