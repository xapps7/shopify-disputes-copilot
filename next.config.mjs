import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: true,
  output: "standalone",
  outputFileTracingRoot: path.join(process.cwd()),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            // Shopify requires frame-ancestors on embedded apps; its absence is
            // an explicit App Store rejection reason and allows clickjacking.
            key: "Content-Security-Policy",
            value: "frame-ancestors https://*.myshopify.com https://admin.shopify.com;"
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
        ]
      }
    ];
  }
};

export default nextConfig;
