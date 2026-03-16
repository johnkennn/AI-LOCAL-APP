import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "http://10.159.71.3:3001",
    "http://10.159.71.3:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
  ],
};

export default nextConfig;
