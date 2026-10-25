/**
 * Nothing in `src/` may `await` a haptic, outside the one deliberate pause.
 *
 * A haptic's native call is on its way the moment it's made; awaiting its
 * promise only holds back whatever comes next by a bridge round trip, so the
 * buzz lands ahead of the visual it belongs to (see the rule in haptics.ts).
 * It reads as harmless in review and typechecks, and it had spread to 18 row
 * buttons in TaskItem before anyone noticed, so the check is mechanical.
 *
 * `TaskCheckbox` is the exception: its sheet-opening branches await on purpose,
 * as the window its `busyRef` guards against a second tap (see the note above
 * `busyRef` there).
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');
/** The one file whose awaits are a deliberate pause. */
const ALLOWED = join('components', 'TaskCheckbox.tsx');

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    // The suite itself is skipped: this file quotes the pattern as a literal.
    if (entry.isDirectory() && entry.name !== '__tests__') sourceFiles(full, found);
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

const AWAITED = /\bawait\s+haptics\./;

const files = sourceFiles(SRC).map(f => ({ rel: f.slice(SRC.length + 1), src: readFileSync(f, 'utf8') }));

describe('awaited haptics', () => {
  it('scans a realistic number of files', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('still finds the deliberate awaits in TaskCheckbox', () => {
    // Guards the pattern: if it stopped matching, the check below would pass
    // against nothing.
    const allowed = files.find(f => f.rel === ALLOWED);
    expect(allowed).toBeDefined();
    expect(AWAITED.test(allowed!.src)).toBe(true);
  });

  it('awaits a haptic nowhere else', () => {
    const offenders = files
      .filter(f => f.rel !== ALLOWED)
      .flatMap(f => f.src.split('\n')
        .map((line, i) => ({ line, at: `${f.rel}:${i + 1}` }))
        .filter(({ line }) => AWAITED.test(line))
        .map(({ at }) => at));
    expect(offenders).toEqual([]);
  });
});
