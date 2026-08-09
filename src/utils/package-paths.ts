import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolves paths inside the installed package.
 *
 * Gelada ships two ways: as an ESM npm package, and as a single-file binary
 * bundled to CommonJS. `import.meta.url` is the ESM answer; the bundler rewrites
 * it to a CommonJS equivalent (see scripts/build-binary.js), so this module
 * works unchanged in both. What it must not do is trust the working directory —
 * the server runs from whatever directory the MCP client launched it in.
 */

function looksLikePackageRoot(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, 'package.json')) &&
    (fs.existsSync(path.join(dir, 'bin', 'gelada.js')) || fs.existsSync(path.join(dir, 'dist')))
  );
}

/** Walks up from this module until it finds the package root. */
export function packageRoot(): string {
  const candidates: string[] = [];

  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    candidates.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // A packaged binary has no package tree around it; fall back to where the
  // executable itself lives.
  if (process.argv[1]) {
    const execDir = path.dirname(path.resolve(process.argv[1]));
    candidates.push(execDir, path.resolve(execDir, '..'));
  }

  for (const candidate of candidates) {
    if (looksLikePackageRoot(candidate)) return candidate;
  }

  return candidates[0] ?? process.cwd();
}

/** Absolute path to a file shipped with the package. */
export function packagePath(...segments: string[]): string {
  return path.join(packageRoot(), ...segments);
}
