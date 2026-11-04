/**
 * Nothing in `src/` may render `react-native`'s `Switch`.
 *
 * Every on/off control in the app is `Toggle`, drawn inside a row whose whole
 * surface is the button. The native switch is bigger (51×31 against 44×26)
 * and keeps its own white knob, which glares in the dark themes, so one on a
 * screen reads as borrowed from a different app. Nine had crept back in, each
 * hand-tinted with `trackColor` to look closer to the rest, which is the tell
 * that a check has to catch it rather than a reviewer.
 *
 * Reads the source rather than the module graph, the same as
 * `noRawModal.test.ts`: there are no component tests, so a JSX tag is only
 * ever text as far as the suite is concerned.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { sourceFiles } from '../testSupport/sourceFiles';

const SRC = join(__dirname, '..');

/** `<Switch` as a tag, never `<SwitchRow` or the like. */
const RAW_TAG = /<Switch[\s/>]/;

/** `Switch` as an exact specifier in a `react-native` import block. */
function importsSwitchFromReactNative(source: string): boolean {
  const blocks = source.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*'react-native';/g);
  for (const block of blocks) {
    if (block[1].split(',').map(s => s.trim()).includes('Switch')) return true;
  }
  return false;
}

const files = sourceFiles(SRC)
  .filter(f => !f.includes('__tests__'))
  .map(f => ({ rel: f.slice(SRC.length + 1), src: readFileSync(f, 'utf8') }));

describe('raw Switch usage', () => {
  it('scans a realistic number of files', () => {
    // Guards the walk itself: a broken path would make every assertion below
    // pass against nothing at all.
    expect(files.length).toBeGreaterThan(200);
  });

  it('matches the patterns it is meant to', () => {
    // Guards the patterns, so a rename can't leave the check quietly vacuous.
    expect(RAW_TAG.test('<Switch value={on} />')).toBe(true);
    expect(RAW_TAG.test('<SwitchRow />')).toBe(false);
    expect(importsSwitchFromReactNative("import { View, Switch, Text } from 'react-native';")).toBe(true);
    expect(importsSwitchFromReactNative("import { View, Text } from 'react-native';")).toBe(false);
  });

  it('renders no raw <Switch>', () => {
    const offenders = files.filter(f => RAW_TAG.test(f.src)).map(f => f.rel);
    expect(offenders).toEqual([]);
  });

  it('imports Switch from react-native nowhere', () => {
    const offenders = files.filter(f => importsSwitchFromReactNative(f.src)).map(f => f.rel);
    expect(offenders).toEqual([]);
  });
});
