/**
 * Nothing in `src/` may spell out the 12-hour clock format `h:mm a`.
 *
 * Settings has a 12/24-hour switch, and a date-fns token written out by hand is
 * a place it silently doesn't reach: the Medications, Mood and Journal screens,
 * the dose-limit alert and quick-search rows all did this, so a 24-hour user saw
 * "5:30 PM" mid-flow. `clockTimeToken(use24Hour)` (`src/utils/clockTime.ts`) is
 * the one place the two spellings live; a screen takes it from
 * `useClockTimeToken()` (`src/hooks/`), and a plain function reads
 * `useSettingsStore.getState().use24HourTime` or is handed the setting.
 *
 * Mechanical for the same reason `noRawModal` is: the wrong spelling typechecks,
 * runs, and looks right to anyone on the default 12-hour setting.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');
const ROOT = join(SRC, '..');

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    // The suite is skipped: this file quotes the pattern, and a test asserting
    // the 12-hour output is checking the format, not choosing one.
    if (entry.isDirectory() && entry.name !== '__tests__') sourceFiles(full, found);
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** Where `h:mm a` may be written, and why. */
const ALLOWED: Record<string, string> = {
  'src/utils/clockTime.ts': 'defines the token every other file takes',
  'src/utils/journalExport.ts': 'a file export, not a screen: the text is read later, outside the app and its setting',
};

/** A string literal holding the format, in any of the three quote styles. */
const CLOCK_FORMAT = /(['"`])[^'"`\n]*h:mm a[^'"`\n]*\1/;

/** Comments quote the token to explain it, so they are not scanned. */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const files = sourceFiles(SRC).map(f => ({ rel: f.slice(ROOT.length + 1), src: readFileSync(f, 'utf8') }));

describe('hard-coded 12-hour clock format', () => {
  it('scans a realistic number of files', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('matches every spelling it is meant to catch', () => {
    // Guards the pattern itself, so the check can't go quietly vacuous.
    expect(CLOCK_FORMAT.test("format(d, 'h:mm a')")).toBe(true);
    expect(CLOCK_FORMAT.test('format(d, "h:mm a")')).toBe(true);
    expect(CLOCK_FORMAT.test("format(d, 'EEE, MMM d · h:mm a')")).toBe(true);
    expect(CLOCK_FORMAT.test('format(d, `MMM d, h:mm a`)')).toBe(true);
    expect(CLOCK_FORMAT.test("format(d, 'HH:mm')")).toBe(false);
    expect(CLOCK_FORMAT.test('format(d, clockTimeToken(use24Hour))')).toBe(false);
  });

  it('is written nowhere but the allowlist (use clockTimeToken)', () => {
    const offenders = files
      .filter(f => !(f.rel in ALLOWED) && CLOCK_FORMAT.test(withoutComments(f.src)))
      .map(f => f.rel);
    expect(offenders).toEqual([]);
  });

  it('keeps the allowlist honest: every entry still writes the format', () => {
    for (const rel of Object.keys(ALLOWED)) {
      const file = files.find(f => f.rel === rel);
      expect(file).toBeDefined();
      expect(CLOCK_FORMAT.test(withoutComments(file!.src))).toBe(true);
    }
  });
});
