import {
  SIMPLE_QUICK_ADD_CHIPS,
  SIMPLE_EDITOR_PRIMARY_ROWS,
  isSimpleChip,
  simplePrimaryRow,
} from '../utils/simpleTaskForm';
import { QUICK_ADD_CHIP_LABELS, type QuickAddChip } from '../utils/taskKinds';

const ALL_CHIPS = Object.keys(QUICK_ADD_CHIP_LABELS) as QuickAddChip[];

describe('simple task form', () => {
  describe('off', () => {
    it('keeps every chip', () => {
      for (const chip of ALL_CHIPS) {
        expect(isSimpleChip(chip, false)).toBe(true);
      }
    });

    it('leaves a row\'s declared primary flag alone', () => {
      expect(simplePrimaryRow('priority', true, false)).toBe(true);
      expect(simplePrimaryRow('waitingOn', undefined, false)).toBe(false);
      // The one that would break the default if the flag were dropped: a row
      // the editor calls primary but this module doesn't list.
      expect(simplePrimaryRow('deadline', true, false)).toBe(true);
    });
  });

  describe('on', () => {
    it('keeps exactly Date, Time of day and Repeat', () => {
      const kept = ALL_CHIPS.filter(c => isSimpleChip(c, true));
      expect(kept).toEqual(['date', 'repeat', 'segment']);
    });

    it('demotes every row it does not list', () => {
      expect(simplePrimaryRow('date', true, true)).toBe(true);
      expect(simplePrimaryRow('timeOfDay', true, true)).toBe(true);
      expect(simplePrimaryRow('repeat', true, true)).toBe(true);
      for (const key of ['deadline', 'remindMe', 'category', 'project', 'tags', 'priority', 'effort']) {
        expect(simplePrimaryRow(key, true, true)).toBe(false);
      }
    });

    it('promotes nothing that was not primary already', () => {
      // The trim only ever subtracts. A row this module happened to list but
      // the editor never marked primary would be a field appearing *because*
      // the user asked for fewer of them.
      for (const key of SIMPLE_EDITOR_PRIMARY_ROWS) {
        expect(simplePrimaryRow(key, true, false)).toBe(true);
      }
    });
  });

  it('names the same three fields on both sides', () => {
    // Quick add's chip keys and the editor's row keys spell two of these
    // differently ('segment' / 'timeOfDay'), so they can't just be compared —
    // what has to hold is that both lists are the same length and that each
    // chip's label matches its row's field.
    expect(SIMPLE_QUICK_ADD_CHIPS).toHaveLength(SIMPLE_EDITOR_PRIMARY_ROWS.length);
    expect(SIMPLE_QUICK_ADD_CHIPS.map(c => QUICK_ADD_CHIP_LABELS[c]).sort())
      .toEqual(['Date', 'Repeat', 'Time of day']);
  });

  it('only lists chips the toolbar actually has', () => {
    for (const chip of SIMPLE_QUICK_ADD_CHIPS) {
      expect(ALL_CHIPS).toContain(chip);
    }
  });
});
