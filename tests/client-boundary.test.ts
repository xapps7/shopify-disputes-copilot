import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Catches the build break that `npm test` and `tsc` both miss.
 *
 * Polaris builds its components on React context. `createContext` does not
 * exist on the server, so importing even one Polaris component into a server
 * component fails `next build` with:
 *
 *   Failed to collect configuration for /settings
 *   TypeError: (0 , f.createContext) is not a function
 *
 * That message names the page and says nothing about the cause. Types pass.
 * Tests pass. It only shows up in a build, which takes minutes and is the
 * slowest gate we have - so it has already been discovered twice by pushing.
 *
 * This test is the same check in the fast gate. It is a static approximation,
 * not a build: it follows one level of `@/` imports out of every server file.
 * That is exactly the depth at which the bug happens, because the fix is always
 * to move the Polaris usage behind a "use client" boundary.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const SERVER_FILES = new Set([
  "page.tsx",
  "layout.tsx",
  "route.ts",
  "error.tsx",
  "loading.tsx",
  "not-found.tsx"
]);

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) {
      continue;
    }
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...walk(full));
    } else if (SERVER_FILES.has(entry)) {
      found.push(full);
    }
  }
  return found;
}

function isClientComponent(file: string): boolean {
  const first = readFileSync(file, "utf8").split("\n")[0].trim();
  return first.replace(/;$/, "").replace(/^["']|["']$/g, "") === "use client";
}

/** `@/components/plan-card` -> the file on disk, or null if it is not ours. */
function resolveAlias(spec: string): string | null {
  if (!spec.startsWith("@/")) {
    return null;
  }
  const base = path.join(ROOT, spec.slice(2));
  for (const candidate of [`${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx"), path.join(base, "index.ts")]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** A stylesheet import is harmless. A component import is not. */
const IMPORTS_POLARIS_COMPONENTS = /from "@shopify\/polaris"/;

test("no server component imports Polaris directly", () => {
  const offenders: string[] = [];

  for (const file of walk(path.join(ROOT, "app"))) {
    if (isClientComponent(file)) {
      continue;
    }
    if (IMPORTS_POLARIS_COMPONENTS.test(readFileSync(file, "utf8"))) {
      offenders.push(path.relative(ROOT, file));
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `These run on the server and import Polaris, which will fail the build:\n  ${offenders.join("\n  ")}\n` +
      `Move the Polaris usage into a component marked "use client".`
  );
});

test("no server component pulls Polaris in through one of ours", () => {
  const offenders: string[] = [];

  for (const file of walk(path.join(ROOT, "app"))) {
    if (isClientComponent(file)) {
      continue;
    }

    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/from "(@\/[^"]+)"/g)) {
      const target = resolveAlias(match[1]);
      if (!target) {
        continue;
      }
      if (IMPORTS_POLARIS_COMPONENTS.test(readFileSync(target, "utf8")) && !isClientComponent(target)) {
        offenders.push(`${path.relative(ROOT, file)} -> ${path.relative(ROOT, target)}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `A server file imports one of ours that uses Polaris without "use client":\n  ${offenders.join("\n  ")}`
  );
});

test("the check itself still sees the files it is meant to guard", () => {
  // A refactor that moves or renames the app directory would otherwise make the
  // two tests above pass by scanning nothing at all.
  const serverFiles = walk(path.join(ROOT, "app")).filter((f) => !isClientComponent(f));
  assert.ok(serverFiles.length > 20, `only found ${serverFiles.length} server files - the walk is probably broken`);
});
