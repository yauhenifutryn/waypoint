import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingExcludes: {
    "*": ["./samples/**", "./artifacts/**", "./.data/**"],
  },
};

export default nextConfig;
