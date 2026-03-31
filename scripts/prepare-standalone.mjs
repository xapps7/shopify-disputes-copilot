import { cp, mkdir, access } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const standaloneDir = path.join(root, ".next", "standalone");
const standaloneNextDir = path.join(standaloneDir, ".next");
const standaloneStaticDir = path.join(standaloneNextDir, "static");
const sourceStaticDir = path.join(root, ".next", "static");
const sourcePublicDir = path.join(root, "public");
const standalonePublicDir = path.join(standaloneDir, "public");

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await pathExists(standaloneDir))) {
    throw new Error("Standalone output is missing. Run next build before preparing standalone assets.");
  }

  await mkdir(standaloneNextDir, { recursive: true });

  if (await pathExists(sourceStaticDir)) {
    await cp(sourceStaticDir, standaloneStaticDir, {
      force: true,
      recursive: true
    });
  }

  if (await pathExists(sourcePublicDir)) {
    await cp(sourcePublicDir, standalonePublicDir, {
      force: true,
      recursive: true
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
