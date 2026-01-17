import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { dev, isServer }) => {
    if (dev) {
      config.watchOptions = {
        poll: 800, // Slightly reduced polling
        aggregateTimeout: 300,
        // Ignore the movies folder strictly to prevent "Unable to snapshot" errors
        ignored: ['**/movies/**', '**/node_modules/**', '**/.git/**']
      }
    }
    return config
  },
};

export default nextConfig;
