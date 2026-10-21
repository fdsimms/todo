/**
 * Nothing in `src/` may render `Animated.Text`; `AnimatedText` (`theme/AppFont`)
 * is the one that renders in the selected font.
 *
 * `Animated.Text` is created from the original `Text` before the font patch
 * runs, so it draws in the system font beside a plain `Text` in the chosen one.
 * It typechecks and looks right in the default font, and only shows as a
 * different typeface once someone has picked another one. Source is read as
 * text for the reason `noRawModal.test.ts` gives.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');
/** The one file that wraps the patched `Text`, and so names the pattern. */
const WRAPPER = join('theme', 'AppFont.tsx');

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== '__tests__') sourceFiles(full, found);
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

const RAW = /Animated\.Text\b|createAnimatedComponent\(\s*Text\b/;

const files = sourceFiles(SRC).map(f => ({ rel: f.slice(SRC.length + 1), src: readFileSync(f, 'utf8') }));

describe('raw Animated.Text usage', () => {
  it('scans a realistic number of files', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('still finds the wrapper building AnimatedText from the patched Text', () => {
    const wrapper = files.find(f => f.rel === WRAPPER);
    expect(wrapper).toBeDefined();
    expect(/createAnimatedComponent\(\s*Text\b/.test(wrapper!.src)).toBe(true);
  });

  it('uses no raw Animated.Text outside AppFont', () => {
    const offenders = files.filter(f => f.rel !== WRAPPER && RAW.test(f.src)).map(f => f.rel);
    expect(offenders).toEqual([]);
  });
});
