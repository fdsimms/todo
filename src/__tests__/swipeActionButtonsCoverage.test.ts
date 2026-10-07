/**
 * Every file that renders a `SwipeableRow` also renders `SwipeActionButtons`.
 *
 * In iPhone Mirroring (`mirroringMode`) the buttons are the row's swipe
 * actions for someone with a pointer, and for most rows the select swipe is
 * the only way into bulk editing. A new swipeable row that leaves them out
 * typechecks and passes every other test, and is simply unselectable from a
 * Mac, which nobody notices until they try it there.
 *
 * Reads the source rather than the module graph, the same as
 * `noRawModal.test.ts`: with no renderer in the suite, a JSX tag is only ever
 * text. Per file rather than per row, so it can't tell a file with two rows
 * and one button apart from a complete one; it catches the case that
 * actually happens, a new row in a new file.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');
/** Defines the row; renders neither. */
const DEFINITION = join('components', 'SwipeableRow.tsx');

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    // The suite is skipped: this file quotes both tags as literals.
    if (entry.isDirectory() && entry.name !== '__tests__') sourceFiles(full, found);
    else if (entry.isFile() && /\.tsx$/.test(entry.name)) found.push(full);
  }
  return found;
}

const ROW_TAG = /<SwipeableRow[\s>]/;
const BUTTONS_TAG = /<SwipeActionButtons[\s/>]/;

const files = sourceFiles(SRC).map(f => ({ rel: f.slice(SRC.length + 1), src: readFileSync(f, 'utf8') }));
const swipeable = files.filter(f => f.rel !== DEFINITION && ROW_TAG.test(f.src));

describe('SwipeActionButtons coverage', () => {
  it('finds the swipeable rows it is meant to check', () => {
    // Guards the walk and the pattern: a broken path or a renamed tag would
    // make the check below pass against nothing.
    expect(swipeable.length).toBeGreaterThan(10);
    expect(swipeable.map(f => f.rel)).toContain(join('components', 'TaskItem.tsx'));
  });

  it('pairs every SwipeableRow with SwipeActionButtons', () => {
    const missing = swipeable.filter(f => !BUTTONS_TAG.test(f.src)).map(f => f.rel);
    expect(missing).toEqual([]);
  });
});
