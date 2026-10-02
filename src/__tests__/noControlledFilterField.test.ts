/**
 * A search/filter field may not be a *controlled* TextInput.
 *
 * `useFilterField` explains the bug at length; the short version is that
 * `value={query}` round-trips every character through React state, and a
 * commit that lands late makes iOS restore the caret by counting back from the
 * end of the text it just replaced. Typing "protein shake" into the meal
 * picker came out as "Potein shakr". These fields are the ones it bites,
 * because they are the ones whose every keystroke re-renders a whole list.
 *
 * It is checked mechanically for the same reason `noRawModal` is: the wrong
 * version is invisible in review and typechecks perfectly. `value={query}` is
 * what anyone writing the next picker will reach for, and nothing but this
 * will stop them.
 *
 * This reads the source rather than the module graph — Jest runs in `node`
 * with no renderer, so a JSX prop is only ever text as far as the suite is
 * concerned.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== '__tests__') sourceFiles(full, found);
    else if (entry.isFile() && /\.tsx$/.test(entry.name)) found.push(full);
  }
  return found;
}

/**
 * The names this app gives a field that narrows a list. It is the naming
 * convention rather than a definition of one, which is the point: a new picker
 * written the old way will call its state one of these, and that is exactly
 * the moment to catch it.
 */
const FILTER_NAMES = [
  'query', 'search', 'searchText', 'searchQuery', 'filter', 'filterText',
  'existingSearch', 'linkSearch', 'categoryText',
];

const CONTROLLED = new RegExp(`value=\\{(${FILTER_NAMES.join('|')})\\}`);

const files = sourceFiles(SRC).map(f => ({
  rel: f.slice(SRC.length + 1),
  src: readFileSync(f, 'utf8'),
}));

it('scans the components and screens', () => {
  expect(files.length).toBeGreaterThan(100);
});

it('has no filter field wired as a controlled TextInput', () => {
  const offenders = files
    .filter(f => CONTROLLED.test(f.src))
    .map(f => `${f.rel}: ${f.src.match(CONTROLLED)![0]}`);

  expect(offenders).toEqual([]);
});

it('routes every SearchField through the hook rather than a value prop', () => {
  const offenders = files
    .filter(f => /<SearchField[\s\S]{0,400}?\bvalue=\{/.test(f.src))
    .map(f => f.rel);

  expect(offenders).toEqual([]);
});
