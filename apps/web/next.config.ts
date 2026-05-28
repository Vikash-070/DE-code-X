import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@decode-x/ui",
    "@decode-x/repo-intelligence",
    "@decode-x/security-engine",
    "@decode-x/ai-orchestrator",
    "@decode-x/mcp",
    "@decode-x/config"
  ]
};

export default nextConfig;
