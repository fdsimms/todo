/**
 * Nothing in `src/` may spell out the discard alert's title itself.
 *
 * `confirmDiscard` is the one place its wording lives. A hand-written copy
 * typechecks and reads right, but it is a second place to edit the next time
 * the copy changes, and the sheets drift apart one at a time (it took 39 edits
 * to change a single sentence). This reads the source, as `noRawModal.test.ts`
 * does, because there are no component tests to catch it any other way.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');
/** The one file that owns the wording. */
const HELPER = join('utils', 'confirmDiscard.ts');

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    // The suites are skipped: they quote the title as a literal to assert it.
    if (entry.isDirectory() && entry.name !== '__tests__') sourceFiles(full, found);
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

const files = sourceFiles(SRC).map(f => ({ rel: f.slice(SRC.length + 1), src: readFileSync(f, 'utf8') }));

describe('hand-written discard alert', () => {
  it('scans a realistic number of files', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('is only ever written in confirmDiscard.ts', () => {
    const offenders = files
      .filter(f => f.rel !== HELPER && /'Discard changes\?'/.test(f.src))
      .map(f => f.rel);
    expect(offenders).toEqual([]);
  });
});
