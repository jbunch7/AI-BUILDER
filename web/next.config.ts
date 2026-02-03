import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    // Optional clickjacking protection: set who can embed this app.
    // - In development, we skip this header for convenience.
    // - In production, set FRAME_ANCESTORS to a space-separated list of origins.
    //   Example: "https://yourdomain.com https://www.yourdomain.com"
    const frameAncestors = process.env.FRAME_ANCESTORS;
    if (process.env.NODE_ENV !== "production" || !frameAncestors) {
      return [];
    }

    return [
      {
        source: "/(.*)",
        headers: [
          // Allow only specified embedding origins.
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors ${frameAncestors};`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
