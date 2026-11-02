/**
 * Nothing in `src/` may spell out the discard alert's title itself.
 *
 * `confirmDiscard` is the one place its wording lives. A hand-written copy
 * typechecks and reads right, but it is a second place to edit the next time
 * the copy changes, and the sheets drift apart one at a time (it took 39 edits
 * to change a single sentence). This reads the source, as `noRawModal.test.ts`
 * does, because there are no component tests to catch it any other way.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { sourceFiles } from '../testSupport/sourceFiles';

const SRC = join(__dirname, '..');
/** The one file that owns the wording. */
const HELPER = join('utils', 'confirmDiscard.ts');

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
