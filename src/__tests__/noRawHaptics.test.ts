/**
 * Nothing in `src/` may reach the haptic engine except through `utils/haptics.ts`.
 *
 * That file is the single gate for the Haptic feedback setting: switching it
 * off there switches off every vibration in the app, with no call site aware
 * of it. A raw `expo-haptics` import, or `Vibration` from `react-native`,
 * would vibrate regardless, and nothing about that is visible in review: it
 * typechecks, runs, and only betrays itself to someone who turned haptics off.
 * It also skips the vocabulary, which is what keeps one meaning to one buzz.
 *
 * Read from the source rather than the module graph, the same as
 * `noRawModal.test.ts`.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');
/** The one file allowed to reach for the real thing. */
const GATE = join('utils', 'haptics.ts');

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    // The suite is skipped: this file quotes both patterns as literals.
    if (entry.isDirectory() && entry.name !== '__tests__') sourceFiles(full, found);
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** Any import or require of expo-haptics. */
const EXPO_HAPTICS = /(?:from\s*|require\(\s*)['"]expo-haptics['"]/;

/** `Vibration` as an exact specifier in a `react-native` import block. */
function importsVibration(source: string): boolean {
  for (const block of source.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*'react-native';/g)) {
    if (block[1].split(',').map(s => s.trim()).includes('Vibration')) return true;
  }
  return false;
}

const files = sourceFiles(SRC).map(f => ({ rel: f.slice(SRC.length + 1), src: readFileSync(f, 'utf8') }));

describe('raw haptics usage', () => {
  it('scans a realistic number of files', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('still finds expo-haptics inside the gate', () => {
    // Guards the pattern: if it stopped matching, the check below would pass
    // against nothing.
    const gate = files.find(f => f.rel === GATE);
    expect(gate).toBeDefined();
    expect(EXPO_HAPTICS.test(gate!.src)).toBe(true);
  });

  it('imports expo-haptics nowhere but utils/haptics.ts', () => {
    const offenders = files.filter(f => f.rel !== GATE && EXPO_HAPTICS.test(f.src)).map(f => f.rel);
    expect(offenders).toEqual([]);
  });

  it('never imports Vibration from react-native', () => {
    expect(importsVibration("import { View, Vibration } from 'react-native';")).toBe(true);
    const offenders = files.filter(f => importsVibration(f.src)).map(f => f.rel);
    expect(offenders).toEqual([]);
  });
});
