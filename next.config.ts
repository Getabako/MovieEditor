import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(__dirname),
  // Remotion / esbuild はサーバー側でのみ使う（バンドルに含めない）
  serverExternalPackages: [
    "@remotion/bundler",
    "@remotion/renderer",
    "@remotion/cli",
    "remotion",
    "esbuild",
  ],
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
