/**
 * Nothing may defer work with `InteractionManager`.
 *
 * In this React Native it is a deprecated stub: `runAfterInteractions` runs its
 * task as a microtask, in the same JS task as the commit it was meant to
 * follow, so a "wait for the transition" written with it waits for nothing and
 * still reads as correct in review. `utils/afterPaint.ts` (`runAfterPaint`,
 * `runAfterTransition`) is what actually waits.
 *
 * Read from the source rather than the module graph, the same as
 * `noRawModal.test.ts`.
 */
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(__dirname, '..');
const APP = join(SRC, '..', 'App.tsx');

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    // The suite is skipped: this file quotes the pattern as a literal.
    if (entry.isDirectory() && entry.name !== '__tests__') sourceFiles(full, found);
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** `InteractionManager` as an exact specifier in a `react-native` import block. */
function importsInteractionManager(source: string): boolean {
  for (const block of source.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*'react-native';/g)) {
    if (block[1].split(',').map(s => s.trim()).includes('InteractionManager')) return true;
  }
  return false;
}

const files = [...sourceFiles(SRC), APP].map(f => ({ rel: relative(SRC, f), src: readFileSync(f, 'utf8') }));

describe('InteractionManager usage', () => {
  it('scans a realistic number of files', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('imports InteractionManager from react-native nowhere', () => {
    expect(importsInteractionManager("import { View, InteractionManager } from 'react-native';")).toBe(true);
    const offenders = files.filter(f => importsInteractionManager(f.src)).map(f => f.rel);
    expect(offenders).toEqual([]);
  });

  it('calls runAfterInteractions nowhere', () => {
    const offenders = files.filter(f => /\.runAfterInteractions\(/.test(f.src)).map(f => f.rel);
    expect(offenders).toEqual([]);
  });
});
