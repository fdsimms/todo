/**
 * Nothing in `src/` may render `react-native`'s `Modal` directly.
 *
 * `SheetModal` is the one that dismisses the keyboard before it closes, and
 * the freeze it exists to prevent (see that file) is invisible in review: a
 * raw `Modal` looks exactly right, typechecks, passes every test, and freezes
 * the app only when somebody closes it with a field focused. The bug has
 * shipped five times, each in a sheet whose other close paths were already
 * correct, so the check that catches the sixth has to be mechanical rather
 * than a reviewer noticing.
 *
 * This reads the source rather than the module graph on purpose: there are no
 * component tests here (Jest runs in `node` with no renderer), so a JSX tag is
 * only ever text as far as the suite is concerned.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');
/** The one file allowed to reach for the real thing. */
const WRAPPER = join('components', 'SheetModal.tsx');

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    // The suite itself is skipped: it renders nothing, and this file quotes
    // both patterns as literals, so scanning it would only ever match itself.
    if (entry.isDirectory() && entry.name !== '__tests__') sourceFiles(full, found);
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** `<Modal` / `</Modal>` as a tag, never `<SheetModal` or a `QuickAddModal`. */
const RAW_TAG = /<\/?Modal[\s/>]/;

/** `Modal` as an exact specifier in a `react-native` import block. */
function importsModalFromReactNative(source: string): boolean {
  const block = source.match(/import\s*\{([\s\S]*?)\}\s*from\s*'react-native';/);
  if (!block) return false;
  return block[1].split(',').map(s => s.trim()).includes('Modal');
}

const files = sourceFiles(SRC).map(f => ({ path: f, rel: f.slice(SRC.length + 1), src: readFileSync(f, 'utf8') }));

describe('raw Modal usage', () => {
  it('scans a realistic number of files', () => {
    // Guards the walk itself: a broken path would make every assertion below
    // pass against nothing at all.
    expect(files.length).toBeGreaterThan(200);
  });

  it('still finds the raw Modal inside SheetModal', () => {
    // Guards both patterns. If a react-native rename or a refactor stopped
    // these matching, the whole check would go quietly vacuous.
    const wrapper = files.find(f => f.rel === WRAPPER);
    expect(wrapper).toBeDefined();
    expect(RAW_TAG.test(wrapper!.src)).toBe(true);
    expect(importsModalFromReactNative(wrapper!.src)).toBe(true);
  });

  it('renders no raw <Modal> outside SheetModal', () => {
    const offenders = files.filter(f => f.rel !== WRAPPER && RAW_TAG.test(f.src)).map(f => f.rel);
    expect(offenders).toEqual([]);
  });

  it('imports Modal from react-native nowhere but SheetModal', () => {
    const offenders = files
      .filter(f => f.rel !== WRAPPER && importsModalFromReactNative(f.src))
      .map(f => f.rel);
    expect(offenders).toEqual([]);
  });

  it('has every SheetModal user importing it', () => {
    // A `<SheetModal>` with no import is a typecheck failure rather than a
    // freeze, but catching it here names the file instead of the symbol.
    const missing = files
      .filter(f => f.rel !== WRAPPER && /<SheetModal[\s/>]/.test(f.src))
      .filter(f => !/from '[^']*SheetModal';/.test(f.src))
      .map(f => f.rel);
    expect(missing).toEqual([]);
  });
});
