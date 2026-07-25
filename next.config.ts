import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb", // Set to 10MB or higher depending on video length
    },
  },
};

export default nextConfig;
