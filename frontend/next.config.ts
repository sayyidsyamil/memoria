import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/brain/:path*",
        destination: "http://127.0.0.1:8000/api/:path*",
      },
      {
        source: "/api/memory/:path*",
        destination: "http://127.0.0.1:8000/api/memory/:path*",
      },
      {
        source: "/api/connect",
        destination: "http://127.0.0.1:8000/api/connect",
      },
      {
        source: "/api/connect",
        destination: "http://127.0.0.1:8000/api/connect",
      },
    ];
  },
};

export default nextConfig;
