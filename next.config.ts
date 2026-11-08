import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Excel plans are uploaded through server actions (post files go through an API route).
  experimental: { serverActions: { bodySizeLimit: "21mb" } },
  // The AI help button reads the user guide at run time (modules/ai/help.ts); keep it in the
  // server's file traces in case the build ever becomes standalone.
  outputFileTracingIncludes: { "/*": ["./docs/USER-GUIDE.md"] },
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
