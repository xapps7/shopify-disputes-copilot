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

export const APP_COMMIT =
  process.env.APP_COMMIT?.trim() ||
  process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
  process.env.CODEBUILD_RESOLVED_SOURCE_VERSION?.trim() ||
  buildId ||
  "unknown";

export const APP_RELEASE =
  process.env.APP_RELEASE?.trim() ||
  process.env.APP_VERSION?.trim() ||
  buildId ||
  APP_COMMIT;
