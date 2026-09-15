/**
 * The settings load's `set({ … })` list stays sorted by field name.
 *
 * That list is ~190 names restating the locals above it, and it is the single
 * most conflict-prone place in the repo: essentially every feature adds a
 * setting, so any two branches in flight at once both touch it. Putting it one
 * name per line was the first attempt and was not enough on its own — with no
 * order, every feature appended to the same tail, so two branches inserted on
 * the identical line and git still reported a conflict. It happened between
 * `dailyAgendaSpoken` and `weeklyReviewTasks`, which have nothing to do with
 * each other.
 *
 * Sorted, a new field lands at its own letter, so two features touch different
 * lines and the merge is clean. Nothing about that is self-enforcing: appending
 * to the end is the natural thing to do and reads fine in review, which is
 * exactly why it needs a test rather than a convention.
 *
 * This reads the source as text on purpose. The property order of an object
 * literal is not observable from the store at runtime in any way that would
 * fail, and the thing being protected is the shape of the diff rather than the
 * behaviour of the code.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SOURCE = join(__dirname, '..', 'store', 'useSettingsStore.ts');

/**
 * The field names in the load's `set({ … })` call, in the order written.
 *
 * Anchored on the comment above the call rather than on `set({` alone, since
 * the store makes that call in every action.
 */
function loadedFields(): string[] {
  const lines = readFileSync(SOURCE, 'utf8').split('\n');
  const anchor = lines.findIndex(l => l.includes('One field per line and sorted'));
  expect(anchor).toBeGreaterThan(-1);

  const open = lines.findIndex((l, i) => i > anchor && l.trim() === 'set({');
  expect(open).toBeGreaterThan(anchor);

  const close = lines.findIndex((l, i) => i > open && l.trim() === '});');
  expect(close).toBeGreaterThan(open);

  return lines.slice(open + 1, close).map(l => l.trim().split(':')[0].replace(/,$/, ''));
}

describe('the settings load field list', () => {
  it('is sorted by field name, so two branches adding settings touch different lines', () => {
    const fields = loadedFields();
    // `initialized` closes the call rather than sitting under its own letter:
    // it is the "and now we are loaded" line, not one of the loaded values.
    expect(fields[fields.length - 1]).toBe('initialized');

    const values = fields.slice(0, -1);
    const sorted = [...values].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    // Named so a failure says which entry is out of place rather than printing
    // both 189-item lists and leaving the reader to diff them.
    const misplaced = values.filter((name, i) => name !== sorted[i]);
    expect({ misplaced: misplaced.slice(0, 5) }).toEqual({ misplaced: [] });
  });

  it('holds one field per line, which is what makes the sort worth anything', () => {
    // Two names on one line would merge as one hunk again, sorted or not.
    const fields = loadedFields();
    expect(fields.length).toBeGreaterThan(150);
    for (const name of fields) expect(name).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
  });
});
