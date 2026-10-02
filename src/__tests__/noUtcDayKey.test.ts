/**
 * Nothing in `src/` may cut a day key out of `toISOString()`.
 *
 * `toISOString()` is UTC, and every day key in the app (`dayKeyOf`,
 * `getLogicalDayKey`, the `YYYY-MM-DD` columns) is local. The two agree only
 * while the device's offset is small enough that the instant being keyed stays
 * on the same calendar date in both, so the bug is invisible in CI (which runs
 * in UTC) and in most of the Americas and Europe, and shows up only far from
 * Greenwich. `snoozeEngine` keyed its candidate days this way and, in UTC+13
 * and +14 (New Zealand's summer, Tonga, Kiribati), read each day's projected
 * recurring load off the day before it.
 *
 * A behavioural test can't hold the line here: Jest's sandbox doesn't pick up a
 * `process.env.TZ` written at runtime, so a suite run in UTC can never see the
 * difference. This check is mechanical for the same reason `noRawModal` is.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    // The suite is skipped: this file quotes the pattern, and a test building
    // a UTC timestamp fixture is not keying a day.
    if (entry.isDirectory() && entry.name !== '__tests__') sourceFiles(full, found);
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** `.toISOString().slice(0, 10)` and its `substring`/`substr`/`split('T')` spellings. */
const UTC_DAY_KEY = /toISOString\(\)\s*\.(?:(?:slice|substring|substr)\(\s*0\s*,\s*10\s*\)|split\(\s*['"]T['"]\s*\))/;

const files = sourceFiles(SRC).map(f => ({ rel: f.slice(SRC.length + 1), src: readFileSync(f, 'utf8') }));

describe('UTC day keys', () => {
  it('scans a realistic number of files', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('matches every spelling it is meant to catch', () => {
    // Guards the pattern itself, so the check can't go quietly vacuous.
    expect(UTC_DAY_KEY.test('d.toISOString().slice(0, 10)')).toBe(true);
    expect(UTC_DAY_KEY.test('d.toISOString().substring(0,10)')).toBe(true);
    expect(UTC_DAY_KEY.test("d.toISOString().split('T')[0]")).toBe(true);
    expect(UTC_DAY_KEY.test('d.toISOString()')).toBe(false);
  });

  it('keys no day off a UTC timestamp (use dayKeyOf or getLogicalDayKey)', () => {
    const offenders = files.filter(f => UTC_DAY_KEY.test(f.src)).map(f => f.rel);
    expect(offenders).toEqual([]);
  });
});
