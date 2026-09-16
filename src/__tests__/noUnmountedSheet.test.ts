/**
 * No sheet in `src/` is mounted only while it is open.
 *
 * `SheetModal` closes by keeping the real `Modal` open for one more commit, so
 * the keyboard's dismissal is queued ahead of the native dismissal (see that
 * file for the freeze this prevents and the five times it shipped). A
 * component torn out of the tree cannot hold anything back: the hold is
 * skipped, and the race is back. That shipped as the log-a-meal prompt
 * freezing Today, which returned `null` when nothing was pending rather than
 * lowering `visible` — and the commit that fixed it called that sheet "the
 * only SheetModal user in the app" doing so, when there were fourteen.
 *
 * Which is the same lesson as the one above it: counting the call sites by
 * hand is not a check. This is.
 *
 * The rule a sheet has to follow is that `visible` is always an expression —
 * `visible={open}`, never a bare `visible` and never `visible={true}`, both of
 * which are constants and so leave unmounting as the only way the sheet can
 * close. Staying in the tree costs one idle component; `useSheetMount` and
 * `useSheetSubject` are the two ways to pay it, and both explain when a sheet
 * should be mounted lazily rather than always (an unopened picker on a list
 * row is not free).
 *
 * This reads the source rather than the module graph on purpose: there are no
 * component tests here (Jest runs in `node` with no renderer), so a JSX tag is
 * only ever text as far as the suite is concerned.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    // The suite itself is skipped: it renders nothing, and this file quotes
    // the patterns as literals, so scanning it would only ever match itself.
    if (entry.isDirectory() && entry.name !== '__tests__') sourceFiles(full, found);
    else if (entry.isFile() && /\.tsx$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** `visible` alone on its own line, which is how every one of the fourteen read. */
const BARE_LINE = /^[ \t]*visible[ \t]*$/m;

/** The same prop written inline: `<WhenPicker visible value={null} />`. */
const BARE_INLINE = /<[A-Z][\w.]*[^>\n]*\svisible(?=[\s/>])(?!=)/;

/** `visible={true}` — a constant by another spelling, same missing close path. */
const LITERAL_TRUE = /\bvisible=\{\s*true\s*\}/;

const files = sourceFiles(SRC).map(f => ({
  rel: f.slice(SRC.length + 1),
  src: readFileSync(f, 'utf8'),
}));

function offenders(pattern: RegExp): string[] {
  return files.filter(f => pattern.test(f.src)).map(f => f.rel);
}

describe('sheets mounted only while open', () => {
  it('scans a realistic number of files', () => {
    // Guards the walk itself: a broken path would make every assertion below
    // pass against nothing at all.
    expect(files.length).toBeGreaterThan(150);
  });

  it('recognises each spelling of a constant visible', () => {
    // Guards the patterns. A regex that stopped matching would make the whole
    // check go quietly vacuous, which is the failure mode these files have.
    expect(BARE_LINE.test('  <WhenPicker\n    visible\n    value={null}\n  />')).toBe(true);
    expect(BARE_INLINE.test('  <WhenPicker visible value={null} />')).toBe(true);
    expect(LITERAL_TRUE.test('  <WhenPicker visible={true} />')).toBe(true);
  });

  it('leaves a real visible expression alone', () => {
    // The other half: a check that matched everything would be just as
    // useless, and would make the fix look impossible.
    for (const pattern of [BARE_LINE, BARE_INLINE, LITERAL_TRUE]) {
      expect(pattern.test('  <WhenPicker\n    visible={pickerOpen}\n  />')).toBe(false);
      expect(pattern.test('  <WhenPicker visible={pickerOpen} />')).toBe(false);
      expect(pattern.test('  const visible = !!pending && !!figures;')).toBe(false);
    }
  });

  it('passes no bare visible on its own line', () => {
    expect(offenders(BARE_LINE)).toEqual([]);
  });

  it('passes no bare visible inline on a tag', () => {
    expect(offenders(BARE_INLINE)).toEqual([]);
  });

  it('passes no visible={true}', () => {
    expect(offenders(LITERAL_TRUE)).toEqual([]);
  });
});
