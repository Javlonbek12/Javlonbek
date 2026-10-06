import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Content-plan visuals (up to 20 MB) are uploaded through a server action.
  experimental: { serverActions: { bodySizeLimit: "21mb" } },
  async headers() {
    return [
      {
        // The service worker must always be fetched fresh so updates reach users.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
