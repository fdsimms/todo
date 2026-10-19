/**
 * Nothing in `src/` may read the window's size once, at module load.
 *
 * `Dimensions.get('window')` at the top of a file freezes whatever the window
 * was when the app launched. On a phone that never changes, which is why it
 * looks right. On an iPad in Split View or a Mac window being resized it goes
 * stale: a month grid sized for a 393pt window, left-aligned in a 720pt column.
 * A read inside a component or a gesture is fine, and `useWindowDimensions`
 * (or `useFrameWidth`) is what a component wants, since it re-renders on a
 * resize.
 *
 * Source text rather than the module graph, as `noRawModal.test.ts` does: there
 * are no component tests, so a file is only ever text to this suite.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');

/**
 * Files that still read it at load, and why that is acceptable. A new entry
 * needs a reason a resize can't hurt.
 */
const ALLOWED: Record<string, string> = {
  [join('components', 'PantryReviewSheet.tsx')]:
    'a swipe distance for a responder built once; a stale quarter-of-the-screen threshold only moves where a flick counts as an answer',
};

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== '__tests__') sourceFiles(full, found);
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** A top-level `const … = Dimensions.get(…)`: column 0, so never inside a function. */
const MODULE_LEVEL_READ = /^const\s[^\n]*Dimensions\.get\(/m;

describe('window size read at module load', () => {
  const files = sourceFiles(SRC).map(f => ({ rel: f.slice(SRC.length + 1), src: readFileSync(f, 'utf8') }));

  it('scans a realistic number of files', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('only happens in files that say why a resize is harmless', () => {
    const offenders = files
      .filter(f => MODULE_LEVEL_READ.test(f.src))
      .map(f => f.rel)
      .filter(rel => !(rel in ALLOWED));
    expect(offenders).toEqual([]);
  });

  it('keeps the allowlist honest', () => {
    for (const rel of Object.keys(ALLOWED)) {
      const file = files.find(f => f.rel === rel);
      expect(file && MODULE_LEVEL_READ.test(file.src)).toBe(true);
    }
  });
});
