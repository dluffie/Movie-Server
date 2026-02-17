import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow large responses for streaming video segments
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
  },
  webpack: (config, { dev, isServer }) => {
    if (dev) {
      config.watchOptions = {
        poll: 1500,             // Slower polling = less CPU
        aggregateTimeout: 500,
        ignored: ['**/movies/**', '**/node_modules/**', '**/.git/**', '**/.next/**']
      }
    }
    return config
  },
  // Reduce build memory
  poweredByHeader: false,
  generateEtags: false,
};

export default nextConfig;
