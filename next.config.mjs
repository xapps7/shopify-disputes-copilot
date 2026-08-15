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
          // NOTE: frame-ancestors is set PER SHOP in middleware.ts. Shopify's
          // docs require it to name the specific shop, not a wildcard, so it
          // cannot live in static headers. Everything else below is static.
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
