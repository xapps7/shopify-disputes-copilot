import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * The deployed commit, resolved at BUILD time and inlined into the bundle.
 *
 * Why this exists: `/api/health` used to fall back to `.next/BUILD_ID`, an
 * opaque hash that changes on every build. That answers "did something
 * deploy?" but not "did MY commit deploy?" - and this project has more than
 * once debugged a fix against a runtime serving older code.
 *
 * Order matters. An explicitly injected value always wins over anything we
 * work out ourselves, so a platform that knows its own source version is
 * never second-guessed. `git` is the last resort and is allowed to fail:
 * a build environment with no `.git` directory and no `git` binary must
 * still build.
 */
function resolveBuildCommit() {
  const injected = [
    process.env.APP_COMMIT,
    process.env.CODEBUILD_RESOLVED_SOURCE_VERSION,
    process.env.VERCEL_GIT_COMMIT_SHA,
    process.env.GITHUB_SHA
  ];

  for (const value of injected) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8"
    }).trim();
  } catch {
    // No git, no .git, or a shallow checkout without HEAD. Not fatal - the
    // BUILD_ID fallback in lib/version.ts still gives a per-build marker.
    return "";
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: true,
  output: "standalone",
  outputFileTracingRoot: path.join(process.cwd()),
  // Inlined at build time, so the running server reports the commit it was
  // built from rather than whatever the runtime environment happens to say.
  env: {
    APP_BUILD_COMMIT: resolveBuildCommit(),
    APP_BUILT_AT: new Date().toISOString()
  },
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
