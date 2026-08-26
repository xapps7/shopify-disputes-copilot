import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function readBuildId() {
  const candidates = [
    path.join(process.cwd(), ".next", "BUILD_ID"),
    path.join(process.cwd(), ".next", "standalone", ".next", "BUILD_ID")
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }

    try {
      return readFileSync(candidate, "utf8").trim();
    } catch {
      // Fall through to the next candidate.
    }
  }

  return null;
}

const buildId = readBuildId();

/**
 * `APP_BUILD_COMMIT` and `APP_BUILT_AT` are inlined by next.config.mjs at build
 * time. They describe the code that was compiled, which is the question worth
 * answering: a runtime environment variable can be edited without a rebuild, so
 * it can claim a commit the running bundle was never built from.
 *
 * A runtime `APP_COMMIT` still wins, because it is the deliberate override an
 * operator sets on purpose. Everything after it is a narrowing guess, ending at
 * the per-build `BUILD_ID`, which proves a deploy happened without naming it.
 */
export const APP_COMMIT =
  process.env.APP_COMMIT?.trim() ||
  process.env.APP_BUILD_COMMIT?.trim() ||
  process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
  process.env.CODEBUILD_RESOLVED_SOURCE_VERSION?.trim() ||
  buildId ||
  "unknown";

export const APP_RELEASE =
  process.env.APP_RELEASE?.trim() ||
  process.env.APP_VERSION?.trim() ||
  buildId ||
  APP_COMMIT;

/** ISO timestamp of the build, or "unknown" if it was not inlined. */
export const APP_BUILT_AT = process.env.APP_BUILT_AT?.trim() || "unknown";
