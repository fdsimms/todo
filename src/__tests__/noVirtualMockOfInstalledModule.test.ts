/**
 * A test may not mock an installed package with `{ virtual: true }`.
 *
 * A virtual mock is registered under the bare module name. A `require` of the
 * same package from a file the test did not mock is keyed by its resolved
 * path, and a worker's resolver caches that key per requiring file and shares
 * it across test files. So when a test that mocks nothing reaches a shared
 * module first (`calendarEventLink.ts` lazily requires `todo-eventkit-bridge`),
 * a later test's virtual mock sits under an ID that module never looks up, the
 * real native module loads instead, and its parse failure reads as "no
 * bridge". Which file a worker runs first depends on timing, so the suite
 * failed about one run in three while every file passed alone.
 *
 * Without `virtual`, both sides resolve to the same path and the mock holds
 * whatever ran before it. `virtual` is only for a module that isn't there to
 * resolve, which is the one thing this does not flag.
 *
 * Reads the test sources as text, like `noRawModal.test.ts`: there is no way to
 * observe run order from inside a single test file.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const TEST_DIRS = [join(ROOT, 'src', '__tests__'), join(ROOT, 'mcp', 'src', '__tests__')];
const SELF = __filename;

function testFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && /\.tsx?$/.test(e.name))
      .map(e => join(dir, e.name));
  } catch {
    return [];
  }
}

/** Every `jest.mock('name', ...)` / `jest.doMock('name', ...)` carrying `virtual: true`. */
function virtualMocks(source: string): string[] {
  const starts = [...source.matchAll(/jest\.(?:do)?[mM]ock\(\s*['"]([^'"]+)['"]/g)];
  return starts.flatMap((m, i) => {
    // A call runs to the start of the next one. A heuristic rather than a
    // parse, and enough: a `virtual: true` in between belongs to this call.
    const end = i + 1 < starts.length ? starts[i + 1].index! : source.length;
    return /virtual:\s*true/.test(source.slice(m.index!, end)) ? [m[1]] : [];
  });
}

/** Whether `name` is installed, which is what makes `virtual` unnecessary. */
function resolves(name: string): boolean {
  // Package-relative or absolute paths aren't what this is about; a relative
  // path to a file that exists is resolved by the test's own location.
  if (name.startsWith('.')) return false;
  try {
    require.resolve(name, { paths: [ROOT] });
    return true;
  } catch {
    return false;
  }
}

describe('virtual mocks of installed modules', () => {
  const files = TEST_DIRS.flatMap(testFiles).filter(f => f !== SELF);

  it('finds the test files', () => {
    // A scan that quietly found nothing would pass the check below.
    expect(files.length).toBeGreaterThan(100);
  });

  it('flags a virtual mock of a module that is installed', () => {
    const source = "jest.mock('expo-speech', () => ({}), { virtual: true });\njest.mock('expo-contacts', () => ({}));";
    expect(virtualMocks(source)).toEqual(['expo-speech']);
    expect(resolves('expo-speech')).toBe(true);
    expect(resolves('a-package-nobody-installed')).toBe(false);
  });

  it('has none', () => {
    const offenders = files.flatMap(file =>
      virtualMocks(readFileSync(file, 'utf8'))
        .filter(resolves)
        .map(name => `${file.slice(ROOT.length + 1)}: ${name}`),
    );
    // Drop `{ virtual: true }` from each: the package is installed, so the mock
    // needs no help finding it, and a virtual one can lose to run order.
    expect(offenders).toEqual([]);
  });
});
