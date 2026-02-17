import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
};

export default nextConfig;
