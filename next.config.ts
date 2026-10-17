import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Separate build dirs let e2e builds run while a dev server is up.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Classic (non-Cache-Components) model: every API route is a dynamic, uncached POST/GET handler.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/models/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/mediapipe/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
