/**
 * The file walk behind the source-scanning guard tests (`src/__tests__/no*.test.ts`).
 *
 * Those suites fail the build on a pattern rather than on a behaviour (a raw
 * `Modal`, a day key cut out of `toISOString()`), so each one reads source text
 * instead of importing modules. Every one of them used to carry its own copy of
 * this walk; a new guard now costs its pattern and nothing else.
 *
 * It lives outside `__tests__` because Jest treats every file in there as a
 * suite, and a file with no test in it fails the run.
 */
import { readdirSync } from 'fs';
import { join } from 'path';

/** `src/`. */
export const SRC = join(__dirname, '..');
/** The repo root, for a guard that also reads `mcp/src`, `modules/` or `App.tsx`. */
export const ROOT = join(SRC, '..');

/** TypeScript source, `.ts` and `.tsx`. The default. */
export const TS = /\.tsx?$/;
/** Components and screens only. */
export const TSX = /\.tsx$/;

/**
 * Never descended into. A suite quotes the very pattern it bans as a literal, so
 * scanning `__tests__` would only ever find the guards themselves.
 */
export const DEFAULT_SKIP_DIRS: readonly string[] = ['__tests__', 'node_modules'];

export interface SourceFileOptions {
  /** Which file names to keep. Defaults to `TS`. Declaration files (`.d.ts`) are always left out. */
  match?: RegExp;
  /** Directory names never descended into. Defaults to `DEFAULT_SKIP_DIRS`; pass a full list to replace it. */
  skipDirs?: readonly string[];
  /** File names (not paths) left out wherever they are. */
  skipFiles?: readonly string[];
}

/** Every matching file under `dir`, as an absolute path, in directory order. */
export function sourceFiles(dir: string, options: SourceFileOptions = {}): string[] {
  const match = options.match ?? TS;
  const skipDirs = options.skipDirs ?? DEFAULT_SKIP_DIRS;
  const skipFiles = options.skipFiles ?? [];
  const found: string[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirs.includes(entry.name)) walk(full);
      } else if (
        entry.isFile() &&
        match.test(entry.name) &&
        !entry.name.endsWith('.d.ts') &&
        !skipFiles.includes(entry.name)
      ) {
        found.push(full);
      }
    }
  };
  walk(dir);
  return found;
}
